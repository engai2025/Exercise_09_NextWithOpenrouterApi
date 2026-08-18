import { createComparisonRun } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { productName?: unknown };
    const productName =
      typeof body.productName === "string" ? body.productName.trim() : "";

    if (!productName) {
      return Response.json(
        { success: false, error: "productName is required" },
        { status: 400 },
      );
    }

    const runId = crypto.randomUUID();
    await createComparisonRun({ runId, productName });

    await inngest.send({
      name: "agent/compare.prices",
      data: { productName, runId },
    });

    return Response.json({ success: true, runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start comparison";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
