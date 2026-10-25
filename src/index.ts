/**
 * mocktape — mock APIs from a single file, record real ones, replay anywhere.
 *
 * Library mode example (great for integration tests):
 *
 * ```ts
 * import { createMocktape } from "mocktape";
 *
 * const tape = await createMocktape({
 *   config: { resources: { users: { seed: [{ id: 1, name: "Ada" }] } } },
 * });
 *
 * await tape.fetch("/users/1"); // 200
 * tape.setScenario("POST /payments", "declined");
 *
 * await tape.close();
 * ```
 */

export { createMocktape, runMocktape, type RunOptions, type RunningInstance } from "./runner.js";
export { MockServer, type ServerMode, type MockServerOptions } from "./server/server.js";
export { Router, type PreparedRoute, type RouteMatch } from "./server/matcher.js";
export { ResourceStore } from "./server/store.js";
export { ScenarioRegistry, SCENARIO_HEADER } from "./server/scenario.js";
export { ReplayMatcher } from "./tape/replay.js";
export { CassetteWriter } from "./tape/recorder.js";
export { UpstreamProxy } from "./tape/proxy.js";
export {
  loadCassettes,
  readCassette,
  writeCassette,
  encodeBody,
  decodeBody,
  type Cassette,
  type RecordedInteraction,
} from "./tape/cassette.js";
export { requestSimilarity } from "./util/similarity.js";
export { EventBus } from "./obs/bus.js";
export { createLogger } from "./obs/logger.js";
export { StatsTracker } from "./obs/stats.js";
export { parseConfig, configSchema, ConfigValidationError } from "./config/schema.js";
export type {
  MocktapeConfig,
  RouteSpec,
  ResponseSpec,
  ResourceSpec,
  PredicateSpec,
  FaultSpec,
} from "./config/schema.js";
export type { RequestContext, ServedRequest, RequestSource } from "./http/types.js";
export { ADMIN_PREFIX, handleAdmin } from "./server/admin.js";
