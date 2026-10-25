import type { IncomingMessage } from "node:http";
import type { RequestContext } from "./types.js";

export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds 10MB limit");
    this.name = "BodyTooLargeError";
  }
}

/** Normalize an IncomingMessage into the shared RequestContext shape. */
export async function parseContext(req: IncomingMessage): Promise<RequestContext> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const query: Record<string, string> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0]! : values.join(",");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }

  const context: RequestContext = {
    method: (req.method ?? "GET").toUpperCase(),
    path:
      url.pathname.length > 1 && url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname,
    query,
    headers,
    rawBody: undefined,
  };

  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    context.rawBody = await readBody(req);
    const contentType = headers["content-type"] ?? "";
    if (context.rawBody.length > 0 && contentType.includes("json")) {
      try {
        context.body = JSON.parse(context.rawBody.toString("utf8"));
      } catch {
        // Leave body undefined; handlers decide how to treat malformed JSON.
      }
    }
  }

  return context;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
