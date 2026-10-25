import { createMocktape, type RunningInstance } from "../src/index.js";
import type { ServerMode } from "../src/server/server.js";

/** Boot a quiet, ephemeral instance for tests. */
export async function boot(
  config: Record<string, unknown>,
  mode: ServerMode = { type: "dev" },
  extra: Partial<Parameters<typeof createMocktape>[0]> = {},
): Promise<RunningInstance> {
  return createMocktape({ config, mode, dashboard: false, ...extra });
}

export async function json<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor: condition not met in time");
}
