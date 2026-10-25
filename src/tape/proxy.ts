import type { RequestContext } from "../http/types.js";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
]);

export interface ProxiedResponse {
  status: number;
  headers: Record<string, string>;
  raw: Buffer;
}

/**
 * Forwards requests to an upstream API using global fetch. Hop-by-hop headers
 * are stripped and content-length is re-derived from the forwarded body.
 */
export class UpstreamProxy {
  constructor(private readonly upstream: string) {}

  async forward(request: RequestContext): Promise<ProxiedResponse> {
    const url = new URL(this.upstream);
    const target = `${url.protocol}//${url.host}${joinPaths(url.pathname, request.path)}${serializeQuery(request.query)}`;

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (HOP_BY_HOP.has(name)) continue;
      headers[name] = value;
    }

    const method = request.method;
    const init: RequestInit = { method, headers, redirect: "manual" };
    if (
      request.rawBody !== undefined &&
      request.rawBody.length > 0 &&
      method !== "GET" &&
      method !== "HEAD"
    ) {
      init.body = request.rawBody;
    }

    let response: Response;
    try {
      response = await fetch(target, init);
    } catch (error) {
      throw new UpstreamError(
        `upstream ${this.upstream} unreachable: ${(error as Error).message}`,
        error as Error,
      );
    }

    const raw = Buffer.from(await response.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (name === "content-length" || name === "transfer-encoding" || name === "content-encoding")
        return;
      responseHeaders[name] = value;
    });
    return { status: response.status, headers: responseHeaders, raw };
  }
}

export class UpstreamError extends Error {
  constructor(message: string, cause: Error) {
    super(message, { cause });
    this.name = "UpstreamError";
  }
}

function joinPaths(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

function serializeQuery(query: Record<string, string>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) return "";
  const search = new URLSearchParams();
  for (const [key, value] of entries) {
    for (const part of value.split(",")) search.append(key, part);
  }
  return `?${search.toString()}`;
}
