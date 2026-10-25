import type { RequestSource, ServedRequest } from "../http/types.js";

export interface StatsSnapshot {
  uptimeMs: number;
  total: number;
  miss: number;
  bySource: Record<RequestSource, number>;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

const SOURCES: RequestSource[] = ["route", "resource", "replay", "proxy", "admin", "miss"];

/** Rolling request statistics for the dashboard and admin API. */
export class StatsTracker {
  private readonly startedAt = Date.now();
  private bySource: Record<RequestSource, number>;
  private total = 0;
  private durations: number[] = [];

  constructor() {
    this.bySource = Object.fromEntries(SOURCES.map((source) => [source, 0])) as Record<
      RequestSource,
      number
    >;
  }

  record(request: ServedRequest): void {
    this.total++;
    this.bySource[request.source]++;
    this.durations.push(request.durationMs);
    if (this.durations.length > 5000) this.durations = this.durations.slice(-5000);
  }

  snapshot(): StatsSnapshot {
    const durations = [...this.durations].sort((a, b) => a - b);
    const p95 =
      durations.length === 0
        ? 0
        : durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]!;
    const avg =
      durations.length === 0
        ? 0
        : durations.reduce((sum, value) => sum + value, 0) / durations.length;
    return {
      uptimeMs: Date.now() - this.startedAt,
      total: this.total,
      miss: this.bySource["miss"],
      bySource: { ...this.bySource },
      avgLatencyMs: Math.round(avg * 10) / 10,
      p95LatencyMs: Math.round(p95 * 10) / 10,
    };
  }
}
