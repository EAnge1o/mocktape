import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FaultSpec, MocktapeConfig, ResponseSpec } from "../config/schema.js";
import type { RequestContext } from "../http/types.js";
import { renderTemplate } from "../template/template.js";
import type { PreparedRoute } from "./matcher.js";

export interface ResolvedResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  raw?: Buffer;
  delayMs: number;
  /** Present when a fault rolled true and the server must apply it. */
  appliedFault?: FaultSpec;
  /** Scenario state the response came from ("" when the route has none). */
  scenario: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export function randomInRange(range: number | [number, number]): number {
  if (typeof range === "number") return range;
  const [min, max] = range;
  return min + Math.random() * (max - min);
}

const GARBAGE_SAMPLES = [
  '{"a":',
  "<xml><unclosed>",
  "~~\x00\x01not-json~~",
  '{"status":"ok" "missingColon":true}',
];

/**
 * Build the full response for a matched route: apply templating to the body,
 * read `file` responses, and roll fault injection. The scenario is resolved by
 * the server pipeline and passed in as `spec` / `scenario`.
 */
export async function buildResponseFromSpec(options: {
  spec: ResponseSpec | undefined;
  scenarioError?: string;
  scenario?: string;
  route: PreparedRoute;
  request: RequestContext;
  config: MocktapeConfig;
  configDir: string;
}): Promise<ResolvedResponse> {
  const { spec, scenarioError, route, request, config, configDir } = options;

  if (spec === undefined) {
    // Scenario resolution failed — surface the reason instead of a bare 500.
    return {
      status: 422,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { error: "scenario resolution failed", detail: scenarioError },
      delayMs: 0,
      scenario: "",
    };
  }

  let delayMs = randomInRange(spec.delay ?? route.spec.delay ?? config.latency ?? 0);
  const headers: Record<string, string> = { ...route.spec.headers, ...spec.headers };
  let status = spec.status ?? route.spec.status ?? 200;
  let body = spec.body !== undefined ? renderTemplate(spec.body, request) : undefined;
  let raw: Buffer | undefined;
  let appliedFault: FaultSpec | undefined;

  const fault = route.spec.fault;
  if (fault !== undefined && Math.random() < (fault.rate ?? 1)) {
    appliedFault = fault;
    switch (fault.type) {
      case "latency":
        delayMs += randomInRange(fault.latencyMs ?? 1500);
        break;
      case "error":
        status = 500;
        body = { error: "mocktape: injected error fault" };
        break;
      case "garbage":
        raw = Buffer.from(GARBAGE_SAMPLES[Math.floor(Math.random() * GARBAGE_SAMPLES.length)]!);
        body = undefined;
        break;
      case "reset":
        // Server destroys the socket; nothing to build here.
        break;
    }
  }

  if (spec.file !== undefined) {
    try {
      raw = await readFile(path.resolve(configDir, spec.file));
    } catch {
      return {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: { error: `route "${route.name}" file not found`, file: spec.file },
        delayMs,
        scenario: options.scenario ?? "",
      };
    }
    if (headers["content-type"] === undefined) {
      headers["content-type"] =
        CONTENT_TYPES[path.extname(spec.file).toLowerCase()] ?? "application/octet-stream";
    }
  } else if (raw === undefined && body !== undefined && headers["content-type"] === undefined) {
    if (typeof body === "string") {
      // A string body that parses as JSON is served as JSON; anything else is text.
      const trimmed = body.trimStart();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          body = JSON.parse(body);
          headers["content-type"] = "application/json; charset=utf-8";
        } catch {
          headers["content-type"] = "text/plain; charset=utf-8";
        }
      } else {
        headers["content-type"] = "text/plain; charset=utf-8";
      }
    } else {
      headers["content-type"] = "application/json; charset=utf-8";
    }
  }

  return { status, headers, body, raw, delayMs, appliedFault, scenario: options.scenario ?? "" };
}
