/** Normalized view of an incoming HTTP request, parsed once and shared. */
export interface RequestContext {
  method: string;
  /** Path without the query string, e.g. `/users/42`. */
  path: string;
  query: Record<string, string>;
  /** Header names lowercased. */
  headers: Record<string, string>;
  /** Parsed JSON body, if the request had one and it was valid JSON. */
  body?: unknown;
  rawBody: Buffer | undefined;
  /** Path params captured by the matched route, e.g. `{ id: "42" }`. */
  params?: Record<string, string>;
}

export type RequestSource = "route" | "resource" | "replay" | "proxy" | "admin" | "miss";

export interface ServedRequest {
  id: string;
  time: number;
  method: string;
  path: string;
  query: Record<string, string>;
  status: number | undefined;
  durationMs: number;
  source: RequestSource;
  /** Route name, resource name or cassette interaction id that produced it. */
  origin?: string;
  /** Present when the request missed; populated by replay/closest-match. */
  miss?: {
    closest?: { method: string; path: string; score: number; breakdown: unknown };
  };
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
}
