// Module 2: the four tools Ask Copper can use. Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getPlans, getProducts } from "@/lib/copper/catalog";
import type { Plan, ProductId } from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: {
    id: Plan["id"];
    name: string;
    monthlyUsd: number;
    annualUsd: number;
  }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

const PRODUCT_IDS = ["copper-home", "copper-notes"] as const;

/** Round to whole cents. */
const toCents = (usd: number) => Math.round(usd * 100) / 100;

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map(({ id, name, type, priceUsd, colors }) => ({
      id,
      name,
      type,
      priceUsd,
      colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map(({ id, name, priceUsd }) => ({
      id,
      name,
      priceUsd,
    })),
    plans: getPlans().map(({ id, name, monthlyUsd, annualUsd }) => ({
      id,
      name,
      monthlyUsd,
      annualUsd,
    })),
  };
}

export const calculateCostInput: z.ZodType<CalculateCostInput> = z
  .object({
    products: z.array(z.enum(PRODUCT_IDS)).max(5),
    plan: z.enum(["free", "copper-plus"]),
    billing: z.enum(["monthly", "annual"]),
    years: z.number().int().min(1).max(5),
  })
  .strict();

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const catalog = getProducts();
  const lines: CostBreakdown["lines"] = input.products.map((id) => {
    const product = catalog.find((p) => p.id === id);
    if (!product) throw new Error(`Unknown product: ${id}`);
    return { item: product.name, usd: toCents(product.priceUsd) };
  });

  // Copper Plus covers the whole household, so it's one line however many
  // devices there are. The free plan costs nothing, so it gets no line.
  const plan = getPlans().find((p) => p.id === input.plan);
  if (!plan) throw new Error(`Unknown plan: ${input.plan}`);
  if (plan.id !== "free") {
    const usd =
      input.billing === "monthly"
        ? plan.monthlyUsd * 12 * input.years
        : plan.annualUsd * input.years;
    const term = `${input.years} ${input.years === 1 ? "year" : "years"}`;
    lines.push({
      item: `${plan.name}, ${input.billing === "monthly" ? "monthly" : "yearly"} billing, ${term}`,
      usd: toCents(usd),
    });
  }

  return {
    lines,
    totalUsd: toCents(lines.reduce((sum, line) => sum + line.usd, 0)),
  };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> = z
  .object({
    product: z.enum(PRODUCT_IDS),
    color: z.string().optional(),
  })
  .strict();

function stockOf(units: number): Stock {
  if (units <= 0) return "backordered";
  return units < 10 ? "low_stock" : "in_stock";
}

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product);
  if (!product) throw new Error(`Unknown product: ${input.product}`);

  // A color the product doesn't come in is a catalog fact, so it's answered
  // before stock is read, even when stock can't be.
  let wanted = product.colors;
  if (input.color !== undefined) {
    const asked = input.color.trim().toLowerCase();
    wanted = product.colors.filter((c) => c.toLowerCase() === asked);
    if (wanted.length === 0) {
      return {
        status: "not_a_color",
        product: product.name,
        color: input.color,
        colors: product.colors,
      };
    }
  }

  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message: "Stock can't be checked right now. Please try again later.",
    };
  }

  const colors = wanted.flatMap((color) => {
    const row = rows.find(
      (r) => r.product === product.name && r.color === color,
    );
    if (!row) return [];
    const stock = stockOf(row.units_in_stock);
    return [
      {
        color,
        stock,
        restockDate: stock === "backordered" ? row.next_shipment : null,
      },
    ];
  });
  return { status: "ok", product: product.name, colors };
}

export type ShippingEstimate =
  | {
      status: "ok";
      product: string;
      colors: {
        color: string;
        ships: "now" | "after_restock";
        shipsAfter: string | null;
      }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

/**
 * estimate_shipping: when an order for a product color can ship. In stock (or
 * low stock) ships now; back-ordered ships after the next shipment lands. It
 * never promises transit days, because the Product Bible has no such policy.
 */
export async function estimateShipping(
  input: CheckAvailabilityInput,
): Promise<ShippingEstimate> {
  const result = await checkAvailability(input);
  if (result.status !== "ok") return result;
  return {
    status: "ok",
    product: result.product,
    colors: result.colors.map(({ color, stock, restockDate }) => ({
      color,
      ships: stock === "backordered" ? "after_restock" : "now",
      shipsAfter: stock === "backordered" ? restockDate : null,
    })),
  };
}

export const copperTools: ToolSet = {
  get_products: tool({
    description:
      "List every Copper product with its type, price and the colors it comes in; says nothing about stock.",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description:
      "Get the current price of every Copper product and the monthly and annual price of every plan.",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Work out the total cost of up to 5 devices plus a plan, billed monthly or annually, over 1 to 5 years.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Check today's stock for a Copper product, for every color or one color, including restock dates for back-ordered ones.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
  estimate_shipping: tool({
    description:
      "Say when an order for a Copper product (every color or one color) can ship: now if it's in stock, or after the restock date if it's back-ordered. Gives no delivery-day promises.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => estimateShipping(input),
  }),
};
