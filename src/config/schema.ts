import { z } from "zod";

export type Range = [min: number, max: number];

const delaySchema = z.union([z.number().min(0), z.tuple([z.number().min(0), z.number().min(0)])]);

/**
 * Responses support two notations: inline (`status`/`headers`/`body` directly
 * on the route) or named scenario variants (`scenarios.default` etc.). Both are
 * normalized to `ResponseSpec` at match time.
 */
export const responseSpecSchema = z.object({
  status: z.number().int().min(100).max(599).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  file: z.string().optional(),
  delay: delaySchema.optional(),
});

const faultTypeSchema = z.enum(["latency", "reset", "garbage", "error"]);

export const faultSchema = z.object({
  type: faultTypeSchema,
  /** Probability in [0, 1] that the fault triggers. Default 1. */
  rate: z.number().min(0).max(1).optional(),
  /** Only used by the `latency` fault when the route has no explicit delay. */
  latencyMs: delaySchema.optional(),
});

export const predicateSchema = z.object({
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

export const routeSpecSchema = z
  .object({
    name: z.string().min(1).optional(),
    method: z.union([z.string(), z.array(z.string())]).optional(),
    path: z.string().min(1),
    scenarios: z.record(z.string(), responseSpecSchema).optional(),
    status: z.number().int().min(100).max(599).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
    file: z.string().optional(),
    delay: delaySchema.optional(),
    fault: faultSchema.optional(),
    when: predicateSchema.optional(),
    priority: z.number().optional(),
  })
  .refine(
    (route) =>
      route.scenarios !== undefined || route.body !== undefined || route.file !== undefined,
    { message: 'route needs a response: "body", "file" or "scenarios"' },
  );

export const resourceSpecSchema = z.object({
  seed: z.array(z.unknown()).optional(),
  idField: z.string().min(1).default("id"),
  /** Write mutations to this JSON file so state survives restarts. */
  persist: z.string().optional(),
});

export const configSchema = z.object({
  /** 0 picks a random free port (handy for tests). */
  port: z.number().int().min(0).max(65535).optional(),
  host: z.string().min(1).optional(),
  cors: z.boolean().default(true),
  /** Extra latency applied to every response, useful for testing spinners. */
  latency: delaySchema.optional(),
  silent: z.boolean().default(false),
  dashboard: z
    .object({
      enabled: z.boolean().default(true),
      port: z.number().int().min(1).max(65535).optional(),
    })
    .prefault({}),
  tape: z
    .object({
      dir: z.string().min(1).default("cassettes"),
    })
    .prefault({}),
  upstream: z.string().optional(),
  resources: z.record(z.string(), resourceSpecSchema).default({}),
  routes: z.array(routeSpecSchema).default([]),
});

export type RouteSpec = z.infer<typeof routeSpecSchema>;
export type ResponseSpec = z.infer<typeof responseSpecSchema>;
export type PredicateSpec = z.infer<typeof predicateSchema>;
export type ResourceSpec = z.infer<typeof resourceSpecSchema>;
export type FaultSpec = z.infer<typeof faultSchema>;
export type MocktapeConfig = z.infer<typeof configSchema>;
export type FaultType = z.infer<typeof faultTypeSchema>;

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function parseConfig(input: unknown): MocktapeConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
    throw new ConfigValidationError(
      `invalid config: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
      issues,
    );
  }
  return result.data;
}
