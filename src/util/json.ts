import { createHash } from "node:crypto";

/**
 * JSON.stringify with object keys sorted recursively, so two requests with the
 * same payload always produce the same fingerprint regardless of key order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stabilize);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, stabilize(v)]));
  }
  return value;
}

export function fingerprint(value: unknown): string {
  return createHash("sha1")
    .update(stableStringify(value ?? null))
    .digest("hex");
}

/** Deep-read a value from an object with a dotted path: `a.b.0.c`. */
export function deepGet(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) {
      const index = Number(key);
      return Number.isInteger(index) ? acc[index] : undefined;
    }
    if (typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

/**
 * Structural "actual contains expected" check. Objects require every expected
 * key to be present and compatible; arrays must have the same length and match
 * element-wise; primitives compare with === (plus loose number/string for query params).
 */
export function deepIncludes(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) return actual === expected;
  if (typeof expected === "object" && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      deepIncludes((actual as Record<string, unknown>)[key], value),
    );
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, index) => deepIncludes(actual[index], item));
  }
  return actual === expected;
}

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
