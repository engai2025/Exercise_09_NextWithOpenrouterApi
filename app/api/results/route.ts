import { getComparisonByRunId, getDB, serializeComparison } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");

    if (runId) {
      const result = await getComparisonByRunId(runId);
      return Response.json({
        results: result ? [result] : [],
      });
    }

    const db = await getDB();
    const docs = await db
      .collection("price_comparisons")
      .find({})
      .sort({ "dealsData.lowestPrice": 1 })
      .toArray();

    return Response.json({
      results: docs.map(serializeComparison),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load price comparisons";
    return Response.json({ results: [], error: message }, { status: 500 });
  }
}
