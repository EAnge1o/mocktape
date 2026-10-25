import { randomUUID } from "node:crypto";
import { deepGet } from "../util/json.js";
import type { RequestContext } from "../http/types.js";

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Substitute `{{ ... }}` expressions inside a response body (or header value).
 *
 * Built-ins: `$uuid`, `$timestamp`, `$isoTimestamp`, `$randomInt`, `$randomFloat`,
 * `$randomBoolean`. Request values: `request.path.<param>`, `request.query.<key>`,
 * `request.header.<name>`, `request.body.<dotted.path>`.
 *
 * Unknown expressions resolve to an empty string rather than leaking into
 * responses — typos show up in the dashboard, not in your API consumers.
 */
export function renderTemplate(value: unknown, request: RequestContext): unknown {
  if (typeof value === "string") return renderString(value, request);
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, request));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        renderTemplate(v, request),
      ]),
    );
  }
  return value;
}

function renderString(input: string, request: RequestContext): unknown {
  // A string that is exactly one expression keeps the resolved value's type
  // (numbers stay numbers), while mixed strings interpolate as text.
  const exact = input.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (exact !== null) return resolveExpression(exact[1]!, request);
  return input.replace(TEMPLATE, (_, expression: string) =>
    String(resolveExpression(expression, request)),
  );
}

function resolveExpression(expression: string, request: RequestContext): unknown {
  const builtin = resolveBuiltin(expression);
  if (builtin !== undefined) return builtin;
  if (expression.startsWith("request.")) return resolveRequestValue(expression.slice(8), request);
  return "";
}

function resolveBuiltin(expression: string): unknown {
  switch (expression) {
    case "$uuid":
      return randomUUID();
    case "$timestamp":
      return Math.floor(Date.now() / 1000);
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$randomInt":
      return Math.floor(Math.random() * 1000);
    case "$randomFloat":
      return Math.round(Math.random() * 10000) / 100;
    case "$randomBoolean":
      return Math.random() < 0.5;
    default:
      return undefined;
  }
}

function resolveRequestValue(path: string, request: RequestContext): unknown {
  const [section, ...rest] = path.split(".");
  const key = rest.join(".");
  switch (section) {
    case "path":
      return request.params?.[key];
    case "query":
      return request.query[key];
    case "header":
      return request.headers[key.toLowerCase()];
    case "body":
      return deepGet(request.body, key);
    default:
      return "";
  }
}
