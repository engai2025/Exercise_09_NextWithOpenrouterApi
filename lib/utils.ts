import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `$${price.toFixed(2)}`;
  }
}

export function parsePrice(raw: string | number | undefined | null): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (!raw && raw !== 0) {
    return null;
  }

  const cleaned = String(raw)
    .replace(/[^0-9.,]/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const value = Number.parseFloat(cleaned);

  return Number.isFinite(value) ? value : null;
}

export function sortDealsByPrice<T extends { price: string | number }>(deals: T[]): Array<T & { price: number }> {
  return [...deals]
    .map((deal) => ({
      ...deal,
      price: parsePrice(deal.price) ?? Number.NaN,
    }))
    .filter((deal) => Number.isFinite(deal.price))
    .sort((a, b) => a.price - b.price);
}

export function listingsToDeals(
  listings: Array<{
    title?: string;
    source?: string;
    link?: string;
    price?: string | number;
    imageUrl?: string;
  }>,
) {
  return listings
    .map((listing) => {
      const price = parsePrice(listing.price);

      if (price === null) {
        return null;
      }

      return {
        store: listing.source || "Unknown store",
        title: listing.title || "Untitled listing",
        price,
        currency: "USD",
        url: listing.link || "",
        imageUrl: listing.imageUrl,
      };
    })
    .filter((deal): deal is NonNullable<typeof deal> => deal !== null)
    .sort((a, b) => a.price - b.price);
}
