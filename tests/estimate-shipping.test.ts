// The fifth Ask Copper tool: estimate_shipping. Uses a fake stock list, so it
// needs no database or AI key.
import { describe, expect, it, vi } from "vitest";

let inventory: Record<string, unknown>[] = [];
let up = true;

vi.mock("@/lib/copper/inventory", () => ({
  readInventory: async () => (up ? structuredClone(inventory) : null),
}));

import { copperTools, estimateShipping } from "@/lib/copper/assistant/tools";

const row = (product: string, color: string, units: number, next: string) => ({
  sku: "X",
  product,
  color,
  units_in_stock: units,
  next_shipment: next,
});

describe("estimate_shipping", () => {
  it("is offered to the model as a fifth tool", () => {
    expect(Object.keys(copperTools)).toContain("estimate_shipping");
    expect(Object.keys(copperTools)).toHaveLength(5);
  });

  it("ships now when a color is in stock or low on stock", async () => {
    up = true;
    inventory = [
      row("Copper Notes", "Desert Sand", 92, "2026-11-13"),
      row("Copper Home", "Patina Teal", 6, "2026-11-06"),
    ];
    expect(
      await estimateShipping({ product: "copper-notes", color: "Desert Sand" }),
    ).toMatchObject({
      status: "ok",
      colors: [{ color: "Desert Sand", ships: "now", shipsAfter: null }],
    });
    expect(
      await estimateShipping({ product: "copper-home", color: "Patina Teal" }),
    ).toMatchObject({ colors: [{ ships: "now" }] });
  });

  it("ships after the next shipment date when back-ordered", async () => {
    up = true;
    inventory = [row("Copper Notes", "Night Sky", 0, "2026-11-14")];
    expect(
      await estimateShipping({ product: "copper-notes", color: "Night Sky" }),
    ).toMatchObject({
      status: "ok",
      colors: [
        { color: "Night Sky", ships: "after_restock", shipsAfter: "2026-11-14" },
      ],
    });
  });

  it("says so for a color that doesn't exist, and when stock can't be read", async () => {
    up = true;
    inventory = [];
    expect(
      await estimateShipping({ product: "copper-notes", color: "Purple" }),
    ).toMatchObject({ status: "not_a_color" });
    up = false;
    expect(
      await estimateShipping({ product: "copper-notes" }),
    ).toMatchObject({ status: "unavailable" });
  });
});
