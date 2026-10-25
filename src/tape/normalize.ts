import { fingerprint } from "../util/json.js";

/**
 * Headers that change between requests and would break replay matching if
 * compared. They are excluded from cassettes entirely — replay is about the
 * API contract, not the exact bytes on the wire.
 */
const VOLATILE_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "accept-encoding",
  "date",
  "server",
  "user-agent",
  "cookie",
  "authorization",
  "x-request-id",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-mocktape-scenario",
]);

export function isVolatileHeader(name: string): boolean {
  return VOLATILE_HEADERS.has(name.toLowerCase());
}

export function filterHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => !isVolatileHeader(name))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

export function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** Query params canonicalized: keys sorted, deterministic serialization. */
export function canonicalQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** Exact-match key: method + normalized path + canonical query + body fingerprint. */
export function interactionKey(
  request: Pick<RecordedRequestShape, "method" | "path" | "query" | "body">,
): string {
  return [
    request.method.toUpperCase(),
    normalizePath(request.path),
    canonicalQuery(request.query),
    fingerprint(request.body ?? null),
  ].join(" ");
}

export interface RecordedRequestShape {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
}
