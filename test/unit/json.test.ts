import { describe, expect, it } from "vitest";
import { deepGet, deepIncludes, fingerprint, stableStringify } from "../../src/util/json.js";

describe("stableStringify", () => {
  it("is independent of key order", () => {
    expect(stableStringify({ a: 1, b: { x: 1, y: 2 } })).toBe(
      stableStringify({ b: { y: 2, x: 1 }, a: 1 }),
    );
  });

  it("sorts nested arrays element-wise and drops undefined", () => {
    expect(stableStringify({ a: undefined, b: [1, { z: 1, c: 2 }] })).toBe(
      stableStringify({ b: [1, { c: 2, z: 1 }] }),
    );
  });
});

describe("fingerprint", () => {
  it("matches same payloads regardless of order and treats undefined as null", () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint(undefined)).toBe(fingerprint(null));
  });
});

describe("deepGet", () => {
  const value = { user: { name: "ada", tags: ["a", "b"] } };

  it("reads dotted paths including array indexes", () => {
    expect(deepGet(value, "user.name")).toBe("ada");
    expect(deepGet(value, "user.tags.1")).toBe("b");
  });

  it("returns undefined for missing paths without throwing", () => {
    expect(deepGet(value, "user.missing.deep")).toBeUndefined();
    expect(deepGet(undefined, "user.name")).toBeUndefined();
  });
});

describe("deepIncludes", () => {
  it("matches structural subsets of objects", () => {
    expect(deepIncludes({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } })).toBe(true);
    expect(deepIncludes({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("requires arrays to have equal length and matching elements", () => {
    expect(deepIncludes({ items: [1, 2] }, { items: [1, 2] })).toBe(true);
    expect(deepIncludes({ items: [1, 2] }, { items: [1] })).toBe(false);
  });

  it("handles nested arrays inside expected objects", () => {
    expect(
      deepIncludes(
        { cart: { items: [{ id: 1 }, { id: 2 }] } },
        { cart: { items: [{ id: 1 }, { id: 2 }] } },
      ),
    ).toBe(true);
    expect(deepIncludes({ cart: { items: [{ id: 1 }] } }, { cart: { items: [{ id: 2 }] } })).toBe(
      false,
    );
  });
});
