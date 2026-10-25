import { fingerprint } from "./json.js";

export interface SimilarityBreakdown {
  method: number;
  path: number;
  query: number;
  body: number;
}

export interface SimilarityResult {
  /** Overall score in [0, 1]. */
  score: number;
  breakdown: SimilarityBreakdown;
}

const WEIGHTS: SimilarityBreakdown = { method: 0.2, path: 0.45, query: 0.15, body: 0.2 };

/**
 * Score how close a served request is to a recorded one, used to answer the
 * most important replay question: "why did this request miss?" Each component
 * is normalized to [0, 1] and combined with fixed weights.
 */
export function requestSimilarity(
  served: { method: string; path: string; query: Record<string, string>; body: unknown },
  recorded: { method: string; path: string; query: Record<string, string>; body: unknown },
): SimilarityResult {
  const method = served.method === recorded.method ? 1 : 0;
  const path = pathSimilarity(served.path, recorded.path);
  const query = querySimilarity(served.query, recorded.query);
  const body =
    served.body === undefined && recorded.body === undefined
      ? 1
      : fingerprint(served.body) === fingerprint(recorded.body)
        ? 1
        : 0;

  const score =
    method * WEIGHTS.method + path * WEIGHTS.path + query * WEIGHTS.query + body * WEIGHTS.body;
  return { score, breakdown: { method, path, query, body } };
}

/** Levenshtein distance over path segments, normalized to [0, 1]. */
export function pathSimilarity(a: string, b: string): number {
  const sa = splitPath(a);
  const sb = splitPath(b);
  const distance = levenshtein(sa, sb);
  const longest = Math.max(sa.length, sb.length, 1);
  return 1 - distance / longest;
}

function splitPath(path: string): string[] {
  return path.replace(/^\//, "").split("/").filter(Boolean);
}

function levenshtein(a: string[], b: string[]): number {
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** Jaccard similarity over "key=value" pairs; treats missing query as one item. */
export function querySimilarity(a: Record<string, string>, b: Record<string, string>): number {
  const setA = new Set(Object.entries(a).map(([k, v]) => `${k}=${v}`));
  const setB = new Set(Object.entries(b).map(([k, v]) => `${k}=${v}`));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}
