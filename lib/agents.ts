import { createAgent, createNetwork, createState, openai, type Message } from "@inngest/agent-kit";
import {
  saveDealsTool,
  saveRecommendationTool,
  saveToMongoTool,
  searchWebTool,
} from "@/lib/tools";
import { updateComparisonProgress } from "@/lib/db";
import type { PriceComparisonState } from "@/lib/types";

function getOpenRouterModel() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  return openai({
    model: "openai/gpt-4o-mini",
    apiKey,
    baseUrl: "https://openrouter.ai/api/v1",
    defaultParameters: {
      temperature: 0.2,
    },
  });
}

const freshTurn = {
  onStart: ({ prompt }: { prompt: Message[] }) => ({
    prompt,
    history: [] as Message[],
    stop: false,
  }),
};

export function createPriceComparisonNetwork() {
  const model = getOpenRouterModel();

  const searchAgent = createAgent<PriceComparisonState>({
    name: "Search Agent",
    description: "Finds live product listings via the Serper API",
    system: ({ network }) => {
      const productName = network?.state.data.productName ?? "the requested product";
      return [
        "You are the Search Agent in a price-comparison network.",
        `Find current store listings for: ${productName}.`,
        "Always call the search_web tool exactly once with a precise shopping query.",
        "Do not invent listings. After the tool returns, briefly confirm how many results were found.",
      ].join(" ");
    },
    model,
    tools: [searchWebTool],
    tool_choice: "search_web",
    lifecycle: freshTurn,
  });

  const priceAnalyzerAgent = createAgent<PriceComparisonState>({
    name: "Price Analyzer Agent",
    description: "Normalizes listing prices and extracts the cheapest deal",
    system: ({ network }) => {
      const listings = JSON.stringify(network?.state.data.listings ?? [], null, 2);
      return [
        "You are the Price Analyzer Agent.",
        "Normalize the listings below into comparable USD prices.",
        "Ignore incomplete rows. Convert price strings like '$1,299.00' into numbers.",
        "Call save_deals with a ranked deals array. Every deal must include store, title, price, currency, and url.",
        "Listings JSON:",
        listings,
      ].join("\n");
    },
    model,
    tools: [saveDealsTool],
    tool_choice: "save_deals",
    lifecycle: freshTurn,
  });

  const recommendationAgent = createAgent<PriceComparisonState>({
    name: "Recommendation Agent",
    description: "Writes concise buying advice from the analyzed deals",
    system: ({ network }) => {
      const deals = JSON.stringify(network?.state.data.deals ?? [], null, 2);
      const cheapest = JSON.stringify(network?.state.data.cheapestDeal ?? null, null, 2);
      const productName = network?.state.data.productName ?? "this product";
      return [
        `You are the Recommendation Agent helping someone buy ${productName}.`,
        "Write 2-4 sentences of practical buying advice.",
        "Mention the cheapest store, the price, and any trade-off versus other listings.",
        "Then call save_recommendation with that advice.",
        `Cheapest deal: ${cheapest}`,
        `All deals: ${deals}`,
      ].join("\n");
    },
    model,
    tools: [saveRecommendationTool],
    tool_choice: "save_recommendation",
    lifecycle: freshTurn,
  });

  const dbPersistenceAgent = createAgent<PriceComparisonState>({
    name: "DB Persistence Agent",
    description: "Saves the completed comparison into MongoDB",
    system:
      "You are the DB Persistence Agent. Persist the completed comparison by calling save_to_mongo with confirm=true. Do not skip this tool.",
    model,
    tools: [saveToMongoTool],
    tool_choice: "save_to_mongo",
    lifecycle: freshTurn,
  });

  return createNetwork<PriceComparisonState>({
    name: "price-comparison-network",
    description: "Sequential 4-agent shopping price comparison pipeline",
    agents: [searchAgent, priceAnalyzerAgent, recommendationAgent, dbPersistenceAgent],
    defaultModel: model,
    maxIter: 8,
    defaultRouter: async ({ network }) => {
      const data = network.state.data;

      if (data.saved || data.currentStep === "complete") {
        return undefined;
      }

      if (!data.searchComplete) {
        data.currentStep = "search";
        await updateComparisonProgress(data.runId, {
          currentStep: "search",
          status: "running",
        });
        return searchAgent;
      }

      if (!data.listings?.length) {
        data.currentStep = "error";
        data.error = "No product listings were found.";
        await updateComparisonProgress(data.runId, {
          currentStep: "error",
          status: "error",
          error: data.error,
        });
        return undefined;
      }

      if (!data.deals?.length || !data.cheapestDeal) {
        data.currentStep = "analyze";
        await updateComparisonProgress(data.runId, {
          currentStep: "analyze",
          status: "running",
        });
        return priceAnalyzerAgent;
      }

      if (!data.recommendation) {
        data.currentStep = "recommend";
        await updateComparisonProgress(data.runId, {
          currentStep: "recommend",
          status: "running",
        });
        return recommendationAgent;
      }

      data.currentStep = "persist";
      await updateComparisonProgress(data.runId, {
        currentStep: "persist",
        status: "running",
      });
      return dbPersistenceAgent;
    },
  });
}

export function createComparisonState(input: { runId: string; productName: string }) {
  return createState<PriceComparisonState>({
    runId: input.runId,
    productName: input.productName,
    currentStep: "queued",
  });
}
