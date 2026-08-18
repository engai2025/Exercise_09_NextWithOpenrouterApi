"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Database,
  ExternalLink,
  History,
  Lightbulb,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentStep, PriceComparisonRecord, ProductDeal } from "@/lib/types";
import { cn, formatPrice, sortDealsByPrice } from "@/lib/utils";

const AGENT_PHASES = [
  {
    id: "search" as const,
    label: "Search Agent",
    detail: "Searching Serper API",
    icon: Search,
  },
  {
    id: "analyze" as const,
    label: "Price Analyzer Agent",
    detail: "Comparing deals",
    icon: BarChart3,
  },
  {
    id: "recommend" as const,
    label: "Recommendation Agent",
    detail: "Generating advice",
    icon: Lightbulb,
  },
  {
    id: "persist" as const,
    label: "DB Persistence Agent",
    detail: "Saving to MongoDB Compass",
    icon: Database,
  },
] as const;

type AgentPhaseId = (typeof AGENT_PHASES)[number]["id"];
type AgentBadgeStatus = "idle" | "running" | "complete" | "error";

function agentStatus(step: AgentStep | undefined, phase: AgentPhaseId): AgentBadgeStatus {
  if (step === "error") {
    return "error";
  }

  const order: AgentStep[] = ["queued", "search", "analyze", "recommend", "persist", "complete"];
  const currentIndex = order.indexOf(step ?? "queued");
  const phaseIndex = order.indexOf(phase);

  if (currentIndex > phaseIndex || step === "complete") {
    return "complete";
  }

  if (currentIndex === phaseIndex) {
    return "running";
  }

  return "idle";
}

function statusStyles(status: AgentBadgeStatus) {
  if (status === "running") {
    return "border-primary bg-primary text-primary-foreground animate-pulse-soft";
  }

  if (status === "complete") {
    return "border-emerald-600 bg-emerald-600 text-white";
  }

  if (status === "error") {
    return "border-destructive bg-destructive text-destructive-foreground";
  }

  return "border-border bg-muted text-muted-foreground";
}

function priceRankLabel(rank: number) {
  if (rank === 1) {
    return "Cheapest Deal";
  }

  if (rank === 2) {
    return "2nd Best Price";
  }

  if (rank === 3) {
    return "3rd Best Price";
  }

  return `${rank}th Best Price`;
}

function DealCard({
  deal,
  rank,
}: {
  deal: ProductDeal;
  rank: number;
}) {
  const isCheapest = rank === 1;

  return (
    <Card
      className={cn(
        "w-full max-w-3xl text-center",
        isCheapest && "border-emerald-600/40 bg-[linear-gradient(180deg,#f4fbf7,var(--card))]",
      )}
    >
      <CardHeader className="items-center">
        <Badge variant={isCheapest ? "success" : rank === 2 ? "warning" : "secondary"}>
          {priceRankLabel(rank)}
        </Badge>
        <CardTitle className={cn("mt-2", isCheapest ? "text-2xl" : "text-base")}>
          {deal.store}
        </CardTitle>
        <CardDescription className="line-clamp-2 max-w-xl">{deal.title}</CardDescription>
        <p
          className={cn(
            "pt-2 font-semibold tracking-tight",
            isCheapest ? "text-3xl text-emerald-700" : "text-xl",
          )}
        >
          {formatPrice(deal.price, deal.currency)}
        </p>
      </CardHeader>
      <CardContent className="flex justify-center">
        {deal.url ? (
          <a
            href={deal.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            {isCheapest ? "Open listing" : "View deal"} <ExternalLink className="size-4" />
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">No store link available</p>
        )}
      </CardContent>
    </Card>
  );
}

function ComparisonResults({ record }: { record: PriceComparisonRecord }) {
  const sortedDeals = useMemo(
    () => sortDealsByPrice(record.deals.length > 0 ? record.deals : record.cheapestDeal ? [record.cheapestDeal] : []),
    [record],
  );

  return (
    <div className="grid w-full justify-items-center gap-6">
      {record.status === "error" ? (
        <Card className="w-full max-w-3xl border-destructive/40 text-center">
          <CardHeader className="items-center">
            <CardTitle>Run failed</CardTitle>
            <CardDescription>{record.error || "The agent network reported an error."}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {sortedDeals.map((deal, index) => (
        <DealCard
          key={`${deal.store}-${deal.url}-${deal.price}`}
          deal={deal}
          rank={index + 1}
        />
      ))}

      {record.recommendation ? (
        <Card className="w-full max-w-3xl text-center">
          <CardHeader className="items-center">
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <CardTitle>AI Buying Recommendation</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7 text-foreground/90">{record.recommendation}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function Home() {
  const [productName, setProductName] = useState("iPhone 15 Pro");
  const [runId, setRunId] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<PriceComparisonRecord | null>(null);
  const [history, setHistory] = useState<PriceComparisonRecord[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const response = await fetch("/api/results");
    const payload = (await response.json()) as { results?: PriceComparisonRecord[]; error?: string };

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load saved comparisons");
    }

    setHistory(payload.results ?? []);
  }, []);

  useEffect(() => {
    loadHistory().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load history");
    });
  }, [loadHistory]);

  useEffect(() => {
    if (!runId) {
      return;
    }

    const isDone =
      activeRecord?.status === "complete" ||
      activeRecord?.status === "error" ||
      activeRecord?.currentStep === "complete";

    if (isDone) {
      loadHistory().catch(() => undefined);
      return;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/results?runId=${runId}`);
      const payload = (await response.json()) as { results?: PriceComparisonRecord[] };
      const next = payload.results?.[0];

      if (next) {
        setActiveRecord(next);
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [activeRecord?.currentStep, activeRecord?.status, loadHistory, runId]);

  async function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = productName.trim();

    if (!query) {
      setError("Enter a product name first.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setActiveRecord({
      runId: "pending",
      productName: query,
      currentStep: "queued",
      status: "running",
      listings: [],
      deals: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: query }),
      });
      const payload = (await response.json()) as { success?: boolean; runId?: string; error?: string };

      if (!response.ok || !payload.runId) {
        throw new Error(payload.error || "Failed to start the agent network");
      }

      setRunId(payload.runId);
      setActiveRecord((current) =>
        current
          ? { ...current, runId: payload.runId as string, currentStep: "search" }
          : current,
      );
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to start comparison";
      setError(message);
      setActiveRecord((current) =>
        current
          ? { ...current, status: "error", currentStep: "error", error: message }
          : current,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const currentStep = activeRecord?.currentStep;

  return (
    <div className="flex min-h-full w-full flex-col items-center bg-[radial-gradient(circle_at_top,#efe4cc_0%,transparent_42%),linear-gradient(180deg,#f7f3ea,var(--background))]">
      <main className="flex w-full max-w-6xl flex-col items-center gap-8 px-6 py-10">
        <header className="flex flex-col items-center gap-3 text-center">
          <Badge variant="secondary" className="w-fit">
            4-agent Inngest network
          </Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-stone-900">
            Multi-agent price comparison
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            Search a product, watch Serper search, price analysis, buying advice,
            then review historical comparisons from Compass.
          </p>
        </header>

        <Card className="w-full">
          <CardContent className="pt-6">
            <form onSubmit={onSearch} className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder='Try "iPhone 15 Pro" or "Samsung S24 Ultra"'
                aria-label="Product name"
              />
              <Button type="submit" size="lg" disabled={isSubmitting} className="sm:w-44">
                {isSubmitting ? <Loader2 className="animate-spin" /> : <Search />}
                Search Prices
              </Button>
            </form>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card>

        <section className="grid w-full gap-3 md:grid-cols-4">
          {AGENT_PHASES.map((phase) => {
            const status = agentStatus(currentStep, phase.id);
            const Icon = phase.icon;

            return (
              <Card
                key={phase.id}
                className={cn(
                  "transition-shadow",
                  status === "running" && "ring-2 ring-primary/40",
                )}
              >
                <CardContent className="flex h-full flex-col gap-3 pt-6">
                  <div className={cn("w-fit rounded-full border px-2.5 py-1 text-xs font-semibold", statusStyles(status))}>
                    {status === "running" ? "Running" : status === "complete" ? "Done" : status === "error" ? "Error" : "Idle"}
                  </div>
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 size-5 text-primary" />
                    <div>
                      <p className="font-semibold">{phase.label}</p>
                      <p className="text-sm text-muted-foreground">{phase.detail}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <Tabs defaultValue="live" className="w-full items-center">
          <TabsList>
            <TabsTrigger value="live">
              <Sparkles className="size-4" />
              Live comparison
            </TabsTrigger>
            <TabsTrigger value="history" onClick={() => loadHistory().catch(() => undefined)}>
              <History className="size-4" />
              Saved history
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="grid w-full justify-items-center gap-6">
            {!activeRecord ? (
              <Card className="w-full max-w-3xl text-center">
                <CardHeader className="items-center">
                  <CardTitle>Waiting for a search</CardTitle>
                  <CardDescription>
                    Start with a product name to trigger the four-agent Inngest network.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <>
                <div className="flex w-full max-w-3xl flex-col items-center gap-2 text-center">
                  <p className="text-sm text-muted-foreground">Now comparing</p>
                  <h2 className="text-xl font-semibold">{activeRecord.productName}</h2>
                  {activeRecord.status === "running" ? (
                    <Badge variant="warning" className="gap-1">
                      <Loader2 className="size-3 animate-spin" />
                      Agents working
                    </Badge>
                  ) : null}
                </div>
                <ComparisonResults record={activeRecord} />
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="grid w-full justify-items-center gap-4">
            {history.length === 0 ? (
              <Card className="w-full max-w-3xl text-center">
                <CardHeader className="items-center">
                  <CardTitle>No saved comparisons yet</CardTitle>
                  <CardDescription>
                    Completed runs are stored in the `price_comparisons` MongoDB collection.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              history.map((item) => (
                <Card key={item.runId} className="w-full max-w-3xl text-center">
                  <CardHeader className="items-center">
                    <CardTitle>{item.productName}</CardTitle>
                    <CardDescription>
                      {new Date(item.createdAt).toLocaleString()} · {item.status}
                    </CardDescription>
                    {item.cheapestDeal ? (
                      <Badge variant="success">
                        {item.cheapestDeal.store} {formatPrice(item.cheapestDeal.price, item.cheapestDeal.currency)}
                      </Badge>
                    ) : null}
                  </CardHeader>
                  <CardContent className="grid justify-items-center gap-4">
                    {item.recommendation ? (
                      <p className="text-sm leading-6 text-muted-foreground">{item.recommendation}</p>
                    ) : null}
                    {item.deals.length > 0 ? (
                      <div className="flex flex-wrap justify-center gap-2">
                        {sortDealsByPrice(item.deals).map((deal, index) => (
                          <Badge
                            key={`${item.runId}-${deal.store}-${deal.url}`}
                            variant={index === 0 ? "success" : "outline"}
                          >
                            {priceRankLabel(index + 1)} · {deal.store}: {formatPrice(deal.price, deal.currency)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
