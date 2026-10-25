import { describe, expect, it } from "vitest";
import { parseConfig, ConfigValidationError } from "../../src/config/schema.js";

describe("parseConfig", () => {
  it("fills defaults for an empty config", () => {
    const config = parseConfig({});
    expect(config.cors).toBe(true);
    expect(config.dashboard.enabled).toBe(true);
    expect(config.tape.dir).toBe("cassettes");
    expect(config.routes).toEqual([]);
    expect(config.resources).toEqual({});
  });

  it("accepts a full valid config", () => {
    const config = parseConfig({
      port: 3000,
      routes: [{ path: "/ping", body: "pong" }],
      resources: { users: { seed: [{ id: 1 }] } },
    });
    expect(config.resources["users"]?.idField).toBe("id");
  });

  it("rejects routes without any response", () => {
    expect(() => parseConfig({ routes: [{ path: "/x" }] })).toThrow(ConfigValidationError);
  });

  it("rejects out-of-range ports and statuses", () => {
    expect(() => parseConfig({ port: 99_999 })).toThrow(ConfigValidationError);
    expect(() => parseConfig({ routes: [{ path: "/x", body: {}, status: 42 }] })).toThrow(
      ConfigValidationError,
    );
  });

  it("reports issue paths in the error", () => {
    try {
      parseConfig({ routes: [{ path: "/x" }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const issues = (error as ConfigValidationError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]!.path).toContain("routes");
    }
  });
});
