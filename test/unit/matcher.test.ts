import { describe, expect, it } from "vitest";
import { Router } from "../../src/server/matcher.js";
import type { RouteSpec } from "../../src/config/schema.js";
import type { RequestContext } from "../../src/http/types.js";

function ctx(
  method = "GET",
  path = "/",
  query: Record<string, string> = {},
  body?: unknown,
): RequestContext {
  return { method, path, query, headers: { "x-a": "1" }, rawBody: undefined, body };
}

describe("Router", () => {
  it("matches by method and path with params", () => {
    const router = new Router([{ path: "/users/:id" }]);
    const match = router.match(ctx("GET", "/users/42"));
    expect(match?.params).toEqual({ id: "42" });
    expect(router.match(ctx("POST", "/users/42"))).toBeUndefined();
  });

  it("supports multiple methods and wildcards", () => {
    const multi = new Router([{ path: "/x", method: ["GET", "POST"] }]);
    expect(multi.match(ctx("GET", "/x"))).toBeDefined();
    expect(multi.match(ctx("POST", "/x"))).toBeDefined();
    expect(multi.match(ctx("DELETE", "/x"))).toBeUndefined();

    const wildcard = new Router([{ path: "/y", method: "*" }]);
    expect(wildcard.match(ctx("PATCH", "/y"))).toBeDefined();
  });

  it("treats HEAD as GET", () => {
    const router = new Router([{ path: "/h" }]);
    expect(router.match(ctx("HEAD", "/h"))).toBeDefined();
  });

  it("evaluates query, header and body predicates", () => {
    const router = new Router([
      {
        path: "/pay",
        method: "POST",
        when: { query: { dry: "true" }, headers: { "x-a": "1" }, body: { amount: 100 } },
      },
    ]);
    expect(
      router.match(ctx("POST", "/pay", { dry: "true" }, { amount: 100, note: "hi" })),
    ).toBeDefined();
    expect(router.match(ctx("POST", "/pay", { dry: "false" }, { amount: 100 }))).toBeUndefined();
    expect(router.match(ctx("POST", "/pay", { dry: "true" }, { amount: 5 }))).toBeUndefined();
  });

  it("prefers static segments over params, and explicit methods over wildcards", () => {
    const router = new Router([
      { name: "param", path: "/shop/:resource" },
      { name: "static", path: "/shop/orders" },
    ]);
    expect(router.match(ctx("GET", "/shop/orders"))?.route.name).toBe("static");
    expect(router.match(ctx("GET", "/shop/other"))?.route.name).toBe("param");
  });

  it("lets priority override specificity", () => {
    const router = new Router([
      { name: "natural", path: "/a/b" },
      { name: "boosted", path: "/a/:x", priority: 100 },
    ]);
    expect(router.match(ctx("GET", "/a/b"))?.route.name).toBe("boosted");
  });

  it("breaks ties in config order", () => {
    const router = new Router([
      { name: "first", path: "/t" },
      { name: "second", path: "/t" },
    ]);
    expect(router.match(ctx("GET", "/t"))?.route.name).toBe("first");
  });

  it("names routes uniquely", () => {
    const router = new Router([{ path: "/t" }, { path: "/t" }]);
    expect(router.all[0]!.name).not.toBe(router.all[1]!.name);
  });

  it("explains 404s with closest routes", () => {
    const specs: RouteSpec[] = [
      { name: "users", path: "/users/:id" },
      { name: "orders", path: "/orders" },
    ];
    const router = new Router(specs);
    const closest = router.closest(ctx("GET", "/users/42x"));
    expect(closest.length).toBe(2);
    expect(closest[0]!.route.name).toBe("users");
    expect(closest[0]!.similarity.score).toBeGreaterThan(0.5);
  });

  it("normalizes trailing slashes", () => {
    const router = new Router([{ path: "/slash" }]);
    expect(router.match(ctx("GET", "/slash/"))).toBeDefined();
  });
});
