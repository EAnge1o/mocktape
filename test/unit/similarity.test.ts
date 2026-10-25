import { describe, expect, it } from "vitest";
import { pathSimilarity, querySimilarity, requestSimilarity } from "../../src/util/similarity.js";

describe("pathSimilarity", () => {
  it("is 1 for identical paths", () => {
    expect(pathSimilarity("/users/42", "/users/42")).toBe(1);
  });

  it("degrades gracefully for near misses", () => {
    const oneSegmentOff = pathSimilarity("/users/42", "/users/43");
    const completelyDifferent = pathSimilarity("/users/42", "/orders/7");
    expect(oneSegmentOff).toBeGreaterThan(completelyDifferent);
    expect(completelyDifferent).toBeGreaterThanOrEqual(0);
  });
});

describe("querySimilarity", () => {
  it("is 1 for two empty queries", () => {
    expect(querySimilarity({}, {})).toBe(1);
  });

  it("is 0 with no overlap and partial with some", () => {
    expect(querySimilarity({ a: "1" }, { b: "2" })).toBe(0);
    expect(querySimilarity({ a: "1", b: "2" }, { a: "1" })).toBeGreaterThan(0);
    expect(querySimilarity({ a: "1" }, { a: "1" })).toBe(1);
  });
});

describe("requestSimilarity", () => {
  const served = { method: "GET", path: "/users/42", query: { page: "1" }, body: undefined };

  it("scores a perfect match at 1", () => {
    const result = requestSimilarity(served, { ...served });
    expect(result.score).toBe(1);
  });

  it("penalizes a method mismatch", () => {
    const same = requestSimilarity(served, { ...served });
    const different = requestSimilarity(served, { ...served, method: "POST" });
    expect(different.score).toBeLessThan(same.score);
    expect(different.breakdown.method).toBe(0);
  });

  it("ranks a body mismatch lower than a full match", () => {
    const withBody = { method: "POST", path: "/pay", query: {}, body: { amount: 1 } };
    const same = requestSimilarity(withBody, { ...withBody });
    const diff = requestSimilarity(withBody, { ...withBody, body: { amount: 2 } });
    expect(diff.score).toBeLessThan(same.score);
    expect(diff.breakdown.body).toBe(0);
  });
});
