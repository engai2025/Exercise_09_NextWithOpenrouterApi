import { createTool } from "@inngest/agent-kit";
import { z } from "zod";
import { updateComparisonProgress } from "@/lib/db";
import type { PriceComparisonState, ProductDeal, SerperListing } from "@/lib/types";
import { listingsToDeals, parsePrice } from "@/lib/utils";

function disableStrict<T extends { strict?: boolean }>(tool: T): T {
  tool.strict = false;
  return tool;
}

function requireSerperKey() {
  const key = process.env.SERPER_API_KEY;

  if (!key) {
    throw new Error("SERPER_API_KEY is not set");
  }

  return key;
}

async function serperRequest(path: "shopping" | "search", query: string) {
  const response = await fetch(`https://google.serper.dev/${path}`, {
    method: "POST",
    headers: {
      "X-API-KEY": requireSerperKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: "us",
      hl: "en",
      num: 10,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Serper ${path} failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

function normalizeListings(payload: Record<string, unknown>): SerperListing[] {
  const shopping = Array.isArray(payload.shopping) ? payload.shopping : [];
  const organic = Array.isArray(payload.organic) ? payload.organic : [];
  const source = shopping.length > 0 ? shopping : organic;

  const listings: SerperListing[] = [];

  for (const item of source) {
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? row.name ?? "").trim();
    const link = String(row.link ?? row.url ?? "").trim();

    if (!title) {
      continue;
    }

    listings.push({
      title,
      source: String(row.source ?? row.sitename ?? row.domain ?? "Unknown store"),
      link,
      price: (row.price ?? row.extracted_price) as string | number | undefined,
      imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : undefined,
      rating: typeof row.rating === "number" ? row.rating : undefined,
      ratingCount: typeof row.ratingCount === "number" ? row.ratingCount : undefined,
    });
  }

  return listings.slice(0, 12);
}

export const searchWebTool = disableStrict(
  createTool({
    name: "search_web",
    description:
      "Search the live web and shopping results via Serper API for current product listings and prices.",
    parameters: z.object({
      query: z.string().describe("Product name or shopping search query"),
    }),
    handler: async ({ query }, { network }) => {
      const state = network.state.data as PriceComparisonState;
      state.currentStep = "search";
      await updateComparisonProgress(state.runId, {
        currentStep: "search",
        status: "running",
        productName: state.productName,
      });

      let listings = normalizeListings(await serperRequest("shopping", query));

      if (listings.length === 0) {
        listings = normalizeListings(await serperRequest("search", `${query} buy price`));
      }

      state.listings = listings;
      state.searchComplete = true;
      await updateComparisonProgress(state.runId, {
        listings,
        currentStep: "search",
      });

      return {
        query,
        count: listings.length,
        listings,
      };
    },
  }),
);

export const saveDealsTool = disableStrict(
  createTool({
    name: "save_deals",
    description:
      "Save normalized store deals and the cheapest option into shared network state.",
    parameters: z.object({
      deals: z.array(
        z.object({
          store: z.string(),
          title: z.string(),
          price: z.union([z.number(), z.string()]),
          currency: z.string(),
          url: z.string(),
        }),
      ),
      cheapestStore: z.string(),
    }),
    handler: async ({ deals }, { network }) => {
      const state = network.state.data as PriceComparisonState;
      const input = {
        deals: deals.length > 0 ? deals : listingsToDeals(state.listings ?? []),
      };

      const cleanedDeals: ProductDeal[] = input.deals
        .map((deal) => ({
          store: deal.store,
          title: deal.title,
          price: parsePrice(deal.price) ?? Number.NaN,
          currency: deal.currency || "USD",
          url: deal.url,
        }))
        .filter((deal) => Number.isFinite(deal.price));

      const sortedDeals = cleanedDeals.sort((a, b) => a.price - b.price);
      const cheapestStore = sortedDeals[0];

      if (!cheapestStore) {
        throw new Error("No priced deals could be extracted from listings");
      }

      state.deals = sortedDeals;
      state.cheapestDeal = cheapestStore;
      state.currentStep = "analyze";

      await updateComparisonProgress(state.runId, {
        currentStep: "analyze",
        deals: sortedDeals,
        cheapestDeal: cheapestStore,
        dealsData: { lowestPrice: cheapestStore.price },
      });

      return {
        dealCount: sortedDeals.length,
        cheapestStore,
        lowestPrice: cheapestStore.price,
      };
    },
  }),
);

export const saveRecommendationTool = disableStrict(
  createTool({
    name: "save_recommendation",
    description: "Save the final buying recommendation for the shopper.",
    parameters: z.object({
      recommendation: z
        .string()
        .describe("Clear buying advice including why the cheapest deal is or is not worth it"),
    }),
    handler: async ({ recommendation }, { network }) => {
      const state = network.state.data as PriceComparisonState;
      state.recommendation = recommendation;
      state.currentStep = "recommend";

      await updateComparisonProgress(state.runId, {
        currentStep: "recommend",
        recommendation,
      });

      return { saved: true, recommendation };
    },
  }),
);

export const saveToMongoTool = disableStrict(
  createTool({
    name: "save_to_mongo",
    description:
      "Persist the completed price comparison, deals, and recommendation into MongoDB.",
    parameters: z.object({
      confirm: z
        .boolean()
        .describe("Set true to confirm writing the final comparison document"),
    }),
    handler: async ({ confirm }, { network }) => {
      const state = network.state.data as PriceComparisonState;

      if (!confirm) {
        return { saved: false, reason: "Confirmation was false" };
      }

      state.currentStep = "persist";
      await updateComparisonProgress(state.runId, {
        currentStep: "persist",
        deals: state.deals ?? [],
        cheapestDeal: state.cheapestDeal,
        recommendation: state.recommendation,
        listings: state.listings ?? [],
        dealsData: state.cheapestDeal
          ? { lowestPrice: state.cheapestDeal.price }
          : undefined,
      });

      await updateComparisonProgress(state.runId, {
        currentStep: "complete",
        status: "complete",
        deals: state.deals ?? [],
        cheapestDeal: state.cheapestDeal,
        recommendation: state.recommendation,
        listings: state.listings ?? [],
        dealsData: state.cheapestDeal
          ? { lowestPrice: state.cheapestDeal.price }
          : undefined,
      });

      state.saved = true;
      state.currentStep = "complete";

      return {
        saved: true,
        runId: state.runId,
        collection: "price_comparisons",
      };
    },
  }),
);
