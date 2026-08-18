export type AgentStep =
  | "queued"
  | "search"
  | "analyze"
  | "recommend"
  | "persist"
  | "complete"
  | "error";

export type ComparisonStatus = "running" | "complete" | "error";

export interface ProductDeal {
  store: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl?: string;
}

export interface DealsData {
  lowestPrice: number;
}

export interface SerperListing {
  title: string;
  source?: string;
  link?: string;
  price?: string | number;
  imageUrl?: string;
  rating?: number;
  ratingCount?: number;
}

export interface PriceComparisonState {
  runId: string;
  productName: string;
  currentStep: AgentStep;
  searchComplete?: boolean;
  listings?: SerperListing[];
  deals?: ProductDeal[];
  cheapestDeal?: ProductDeal;
  recommendation?: string;
  saved?: boolean;
  error?: string;
}

export interface PriceComparisonRecord {
  runId: string;
  productName: string;
  currentStep: AgentStep;
  status: ComparisonStatus;
  listings: SerperListing[];
  deals: ProductDeal[];
  cheapestDeal?: ProductDeal;
  dealsData?: DealsData;
  recommendation?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
