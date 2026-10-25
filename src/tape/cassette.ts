import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export type BodyEncoding = "json" | "text" | "base64" | "none";

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
  bodyEncoding: BodyEncoding;
}

export interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  bodyEncoding: BodyEncoding;
}

export interface RecordedInteraction {
  id: string;
  request: RecordedRequest;
  response: RecordedResponse;
}

export interface Cassette {
  version: 1;
  recordedAt: string;
  upstream?: string;
  interactions: RecordedInteraction[];
}

const CASSETTE_VERSION = 1 as const;

/** Encode a raw buffer according to its content type, so cassettes stay readable. */
export function encodeBody(
  raw: Buffer | undefined,
  contentType: string | undefined,
): { body?: unknown; bodyEncoding: BodyEncoding } {
  if (raw === undefined || raw.length === 0) return { bodyEncoding: "none" };
  const type = (contentType ?? "").toLowerCase();
  const text = raw.toString("utf8");
  if (type.includes("json")) {
    try {
      return { body: JSON.parse(text), bodyEncoding: "json" };
    } catch {
      return { body: text, bodyEncoding: "text" };
    }
  }
  if (
    type.startsWith("text/") ||
    type.includes("xml") ||
    type.includes("yaml") ||
    type.includes("javascript")
  ) {
    return { body: text, bodyEncoding: "text" };
  }
  if (isProbablyText(text)) return { body: text, bodyEncoding: "text" };
  return { body: raw.toString("base64"), bodyEncoding: "base64" };
}

/** Decode a recorded body back into a sendable buffer. */
export function decodeBody(body: unknown, encoding: BodyEncoding): Buffer {
  switch (encoding) {
    case "none":
      return Buffer.alloc(0);
    case "json":
    case "text":
      return Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
    case "base64":
      return Buffer.from(String(body), "base64");
  }
}

function isProbablyText(text: string): boolean {
  if (text.includes("\u0000")) return false;
  let control = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32)) control++;
    if (control > text.length * 0.05) return false;
  }
  return true;
}

export function newInteraction(
  request: Omit<RecordedRequest, never>,
  response: Omit<RecordedResponse, never>,
): RecordedInteraction {
  return { id: randomUUID(), request, response };
}

export async function writeCassette(filePath: string, cassette: Cassette): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const header = `# Mocktape cassette — recorded ${cassette.recordedAt}\n# Replay offline with: mocktape replay ${path.basename(filePath)}\n`;
  await writeFile(filePath, header + YAML.stringify(cassette), "utf8");
}

export async function readCassette(filePath: string): Promise<Cassette> {
  const text = await readFile(filePath, "utf8");
  const parsed = YAML.parse(text) as Cassette;
  if (parsed?.version !== CASSETTE_VERSION || !Array.isArray(parsed.interactions)) {
    throw new Error(`${filePath} is not a valid mocktape cassette`);
  }
  return parsed;
}

/** Load a cassette file, or every cassette in a directory, merged. */
export async function loadCassettes(
  target: string,
): Promise<{ cassette: Cassette; files: string[] }> {
  const { stat, readdir } = await import("node:fs/promises");
  const absolute = path.resolve(target);
  const info = await stat(absolute);
  let files: string[];
  if (info.isDirectory()) {
    files = (await readdir(absolute))
      .filter((name) => /\.(yaml|yml)$/.test(name))
      .map((name) => path.join(absolute, name));
    if (files.length === 0) throw new Error(`no cassettes found in directory: ${absolute}`);
  } else {
    files = [absolute];
  }
  const loaded = await Promise.all(
    files.map(async (file) => {
      const cassette = await readCassette(file);
      return { cassette, file };
    }),
  );
  const merged: Cassette = {
    version: CASSETTE_VERSION,
    recordedAt: new Date().toISOString(),
    upstream: loaded[0]?.cassette.upstream,
    interactions: loaded.flatMap((entry) => entry.cassette.interactions),
  };
  return { cassette: merged, files };
}
