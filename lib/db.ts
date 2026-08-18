import { MongoClient, type Db, type Document } from "mongodb";
import type {
  AgentStep,
  ComparisonStatus,
  DealsData,
  PriceComparisonRecord,
  ProductDeal,
  SerperListing,
} from "@/lib/types";
import { sortDealsByPrice } from "@/lib/utils";

const COLLECTION_NAME = "price_comparisons";

type MongoGlobal = typeof globalThis & {
  _priceComparisonClient?: MongoClient;
  _priceComparisonClientPromise?: Promise<MongoClient>;
};

function getMongoUri() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;

  if (!uri) {
    throw new Error("MONGODB_URI (or MONGODB_URL) is not set");
  }

  return uri;
}

async function getClient() {
  const globalStore = globalThis as MongoGlobal;
  const uri = getMongoUri();

  if (!globalStore._priceComparisonClientPromise) {
    const client = new MongoClient(uri);
    globalStore._priceComparisonClientPromise = client.connect().then((connected) => {
      globalStore._priceComparisonClient = connected;
      return connected;
    });
  }

  return globalStore._priceComparisonClientPromise;
}

export async function getDB(): Promise<Db> {
  const client = await getClient();
  return client.db();
}

function comparisonsCollection(db: Db) {
  return db.collection<Document>(COLLECTION_NAME);
}

function toIso(value: unknown, fallback = new Date().toISOString()) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value) {
    return value;
  }

  return fallback;
}

export function serializeComparison(doc: Document): PriceComparisonRecord {
  const deals = sortDealsByPrice(
    Array.isArray(doc.deals) ? (doc.deals as ProductDeal[]) : [],
  );
  const cheapestDeal = (doc.cheapestDeal as ProductDeal | undefined) ?? deals[0];
  const dealsData = (doc.dealsData as DealsData | undefined) ??
    (deals[0] ? { lowestPrice: deals[0].price } : undefined);

  return {
    runId: String(doc.runId ?? ""),
    productName: String(doc.productName ?? ""),
    currentStep: (doc.currentStep as AgentStep) ?? "queued",
    status: (doc.status as ComparisonStatus) ?? "running",
    listings: Array.isArray(doc.listings) ? (doc.listings as SerperListing[]) : [],
    deals,
    cheapestDeal,
    dealsData,
    recommendation: typeof doc.recommendation === "string" ? doc.recommendation : undefined,
    error: typeof doc.error === "string" ? doc.error : undefined,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

export async function createComparisonRun(input: {
  runId: string;
  productName: string;
}) {
  const db = await getDB();
  const now = new Date();

  await comparisonsCollection(db).updateOne(
    { runId: input.runId },
    {
      $setOnInsert: {
        runId: input.runId,
        productName: input.productName,
        currentStep: "queued",
        status: "running",
        listings: [],
        deals: [],
        createdAt: now,
      },
      $set: {
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}

export async function updateComparisonProgress(
  runId: string,
  patch: Partial<
    Pick<
      PriceComparisonRecord,
      | "currentStep"
      | "status"
      | "listings"
      | "deals"
      | "cheapestDeal"
      | "dealsData"
      | "recommendation"
      | "error"
      | "productName"
    >
  >,
) {
  const db = await getDB();
  const deals = patch.deals ? sortDealsByPrice(patch.deals) : undefined;
  const cheapestDeal = deals?.[0] ?? patch.cheapestDeal;
  const dealsData =
    patch.dealsData ??
    (cheapestDeal ? { lowestPrice: cheapestDeal.price } : undefined);

  await comparisonsCollection(db).updateOne(
    { runId },
    {
      $set: {
        ...patch,
        ...(deals ? { deals } : {}),
        ...(cheapestDeal ? { cheapestDeal } : {}),
        ...(dealsData ? { dealsData } : {}),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function getComparisonByRunId(runId: string) {
  const db = await getDB();
  const doc = await comparisonsCollection(db).findOne({ runId });
  return doc ? serializeComparison(doc) : null;
}

export async function getAllComparisons() {
  const db = await getDB();
  const docs = await comparisonsCollection(db)
    .find({})
    .sort({ "dealsData.lowestPrice": 1, createdAt: -1 })
    .limit(50)
    .toArray();

  return docs.map(serializeComparison);
}
