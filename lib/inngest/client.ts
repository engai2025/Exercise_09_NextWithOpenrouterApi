import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "price-comparison",
  name: "AI Price Comparison",
  isDev: process.env.NODE_ENV !== "production",
});
