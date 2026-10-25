import path from "node:path";
import {
  encodeBody,
  newInteraction,
  writeCassette,
  type Cassette,
  type RecordedInteraction,
} from "./cassette.js";
import { filterHeaders, interactionKey } from "./normalize.js";
import type { ProxiedResponse } from "./proxy.js";
import type { RequestContext } from "../http/types.js";

/**
 * Records proxied request/response pairs into a cassette file. Writes are
 * serialized through a promise chain, so concurrent requests never interleave
 * file writes.
 */
export class CassetteWriter {
  private cassette: Cassette;
  private writeQueue: Promise<void> = Promise.resolve();
  /** Index of recorded keys for dup-skip and quick lookup. */
  private readonly seen = new Map<string, RecordedInteraction>();

  constructor(
    readonly filePath: string,
    upstream?: string,
  ) {
    this.cassette = {
      version: 1,
      recordedAt: new Date().toISOString(),
      upstream,
      interactions: [],
    };
  }

  get count(): number {
    return this.cassette.interactions.length;
  }

  get interactions(): readonly RecordedInteraction[] {
    return this.cassette.interactions;
  }

  async record(request: RequestContext, response: ProxiedResponse): Promise<RecordedInteraction> {
    const requestHeaders = filterHeaders(request.headers);
    const responseHeaders = filterHeaders(response.headers);
    const recordedRequest = {
      method: request.method,
      path: request.path,
      query: request.query,
      headers: requestHeaders,
      ...encodeBody(request.rawBody, request.headers["content-type"]),
    };
    const recordedResponse = {
      status: response.status,
      headers: responseHeaders,
      ...encodeBody(response.raw, response.headers["content-type"]),
    };
    const interaction = newInteraction(recordedRequest, recordedResponse);

    // Don't append byte-identical duplicates — replay doesn't need them and
    // cassettes stay diff-friendly in code review.
    const key = interactionKey(recordedRequest);
    if (this.seen.has(key)) return this.seen.get(key)!;
    this.seen.set(key, interaction);

    this.cassette.interactions.push(interaction);
    this.writeQueue = this.writeQueue.then(() =>
      writeCassette(this.filePath, this.cassette).catch((error) => {
        throw new Error(
          `failed to write cassette ${path.basename(this.filePath)}: ${(error as Error).message}`,
        );
      }),
    );
    return interaction;
  }

  /** Wait for pending cassette writes (used on graceful shutdown). */
  async flush(): Promise<void> {
    await this.writeQueue;
  }
}
