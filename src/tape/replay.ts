import type { RequestContext } from "../http/types.js";
import type { RecordedInteraction } from "./cassette.js";
import { canonicalQuery, filterHeaders, interactionKey, normalizePath } from "./normalize.js";
import { requestSimilarity, type SimilarityResult } from "../util/similarity.js";

export type ReplayResult =
  | { type: "hit"; interaction: RecordedInteraction }
  | {
      type: "miss";
      closest: Array<{ interaction: RecordedInteraction; similarity: SimilarityResult }>;
    };

export interface ReplayOptions {
  /** Prefer the most recently recorded interaction when several match exactly. */
  preferLatest?: boolean;
}

/**
 * Matches incoming requests against recorded interactions. Exact matching uses
 * a normalized key (method + path + canonical query + body fingerprint); misses
 * fall back to similarity scoring so the response can explain *why* nothing
 * matched.
 */
export class ReplayMatcher {
  private readonly exact = new Map<string, RecordedInteraction[]>();

  constructor(
    readonly interactions: readonly RecordedInteraction[],
    private readonly options: ReplayOptions = {},
  ) {
    for (const interaction of interactions) {
      const key = interactionKey(interaction.request);
      const bucket = this.exact.get(key);
      if (bucket === undefined) this.exact.set(key, [interaction]);
      else bucket.push(interaction);
    }
  }

  get size(): number {
    return this.interactions.length;
  }

  match(request: RequestContext): ReplayResult {
    const comparable = {
      method: request.method,
      path: normalizePath(request.path),
      query: request.query,
      body: request.body,
    };
    const key = interactionKey(comparable);
    const bucket = this.exact.get(key);
    if (bucket !== undefined && bucket.length > 0) {
      const interaction = this.options.preferLatest ? bucket[bucket.length - 1]! : bucket[0]!;
      return { type: "hit", interaction };
    }
    return { type: "miss", closest: this.closest(comparable, 3) };
  }

  closest(
    request: { method: string; path: string; query: Record<string, string>; body: unknown },
    count: number,
  ): Array<{ interaction: RecordedInteraction; similarity: SimilarityResult }> {
    return this.interactions
      .map((interaction) => ({
        interaction,
        similarity: requestSimilarity(request, {
          method: interaction.request.method,
          path: interaction.request.path,
          query: interaction.request.query,
          body: interaction.request.body,
        }),
      }))
      .sort((a, b) => b.similarity.score - a.similarity.score)
      .slice(0, count);
  }

  /** The normalized key of a request, exposed for the dashboard miss view. */
  static keyOf(request: RequestContext): string {
    return interactionKey({
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
    });
  }

  /** Headers recorded for an interaction, minus volatile ones (already filtered). */
  static recordedHeaders(interaction: RecordedInteraction): Record<string, string> {
    return filterHeaders(interaction.request.headers);
  }

  static canonicalQueryOf(request: RequestContext): string {
    return canonicalQuery(request.query);
  }
}
