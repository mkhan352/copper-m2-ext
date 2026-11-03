// The fifth Ask Copper tool: compare_products. Reads only the catalog, so it
// needs no database or AI key.
import { describe, expect, it } from "vitest";
import { getProducts } from "@/lib/copper/catalog";
import { compareProducts, copperTools } from "@/lib/copper/assistant/tools";

describe("compare_products", () => {
  it("is offered to the model as a fifth tool", () => {
    expect(Object.keys(copperTools)).toContain("compare_products");
    expect(Object.keys(copperTools)).toHaveLength(5);
  });

  it("compares Home and Notes using the catalog's prices and colors", () => {
    const [home, notes] = [
      getProducts().find((p) => p.id === "copper-home")!,
      getProducts().find((p) => p.id === "copper-notes")!,
    ];
    const result = compareProducts({ first: "copper-home", second: "copper-notes" });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.products.map((p) => p.name)).toEqual([home.name, notes.name]);
    expect(result.products.map((p) => p.priceUsd)).toEqual([home.priceUsd, notes.priceUsd]);
    expect(result.cheaper).toBe(home.priceUsd < notes.priceUsd ? home.name : notes.name);
    expect(result.priceDifferenceUsd).toBeCloseTo(Math.abs(home.priceUsd - notes.priceUsd), 2);
    expect(result.sharedColors).toEqual(
      home.colors.filter((c) => notes.colors.includes(c)),
    );
  });

  it("gives the same answer whichever product is named first", () => {
    const ab = compareProducts({ first: "copper-home", second: "copper-notes" });
    const ba = compareProducts({ first: "copper-notes", second: "copper-home" });
    if (ab.status !== "ok" || ba.status !== "ok") throw new Error("expected ok");
    expect(ba.cheaper).toBe(ab.cheaper);
    expect(ba.priceDifferenceUsd).toBe(ab.priceDifferenceUsd);
  });

  it("says so when asked to compare a product with itself", () => {
    expect(
      compareProducts({ first: "copper-home", second: "copper-home" }),
    ).toMatchObject({ status: "same_product" });
  });
});
