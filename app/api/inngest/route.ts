import { serve } from "inngest/next";
import { createComparisonState, createPriceComparisonNetwork } from "@/lib/agents";
import { updateComparisonProgress } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const comparePrices = inngest.createFunction(
  {
    id: "compare-prices",
    name: "Compare product prices",
    retries: 1,
    triggers: { event: "agent/compare.prices" },
  },
  async ({ event }) => {
    const { productName, runId } = event.data as {
      productName: string;
      runId: string;
    };

    try {
      await updateComparisonProgress(runId, {
        productName,
        currentStep: "search",
        status: "running",
      });

      const network = createPriceComparisonNetwork();
      const result = await network.run(
        `Compare current store prices for "${productName}" and recommend the best buy.`,
        {
          state: createComparisonState({ runId, productName }),
        },
      );

      const data = result.state.data;

      await updateComparisonProgress(runId, {
        currentStep: data.saved || data.recommendation ? "complete" : data.currentStep,
        status: data.saved || Boolean(data.recommendation && data.deals?.length)
          ? "complete"
          : "running",
        listings: data.listings,
        deals: data.deals,
        cheapestDeal: data.cheapestDeal,
        recommendation: data.recommendation,
      });

      return {
        runId,
        currentStep: data.currentStep,
        dealCount: data.deals?.length ?? 0,
        saved: Boolean(data.saved),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent network failed";
      await updateComparisonProgress(runId, {
        currentStep: "error",
        status: "error",
        error: message,
      });
      throw error;
    }
  },
);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [comparePrices],
});
