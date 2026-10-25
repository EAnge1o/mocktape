import { describe, expect, it } from "vitest";
import { ResourceStore, type ResourceSpecInput } from "../../src/server/store.js";
import type { RequestContext } from "../../src/http/types.js";

function ctx(
  method: string,
  path: string,
  query: Record<string, string> = {},
  body?: unknown,
): RequestContext {
  return {
    method,
    path,
    query,
    headers: {},
    rawBody: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    body,
  };
}

const SEED = [
  { id: 1, name: "Ada", role: "admin", age: 36 },
  { id: 2, name: "Alan", role: "user", age: 41 },
  { id: 3, name: "Grace", role: "admin", age: 45 },
];

function store(
  specs: Record<string, ResourceSpecInput> = { users: { seed: SEED } },
): ResourceStore {
  return new ResourceStore(specs, process.cwd());
}

describe("ResourceStore", () => {
  it("lists and gets by id", () => {
    const s = store();
    expect(s.handle(ctx("GET", "/users"))?.body).toHaveLength(3);
    expect(s.handle(ctx("GET", "/users/2"))?.body).toEqual(SEED[1]);
    expect(s.handle(ctx("GET", "/users/99"))?.status).toBe(404);
  });

  it("creates with an auto-incremented numeric id", () => {
    const s = store();
    const created = s.handle(ctx("POST", "/users", {}, { name: "Linus", role: "user" }));
    expect(created?.status).toBe(201);
    expect((created?.body as { id: number }).id).toBe(4);
  });

  it("patches without replacing and keeps ids immutable", () => {
    const s = store();
    const patched = s.handle(ctx("PATCH", "/users/1", {}, { name: "Ada K." }))?.body as {
      id: number;
      name: string;
      role: string;
    };
    expect(patched.name).toBe("Ada K.");
    expect(patched.role).toBe("admin");
    expect(patched.id).toBe(1);
  });

  it("replaces on PUT but preserves the id", () => {
    const s = store();
    const replaced = s.handle(ctx("PUT", "/users/2", {}, { name: "Alan M." }))?.body as Record<
      string,
      unknown
    >;
    expect(replaced).toEqual({ id: 2, name: "Alan M." });
  });

  it("deletes and returns 204", () => {
    const s = store();
    expect(s.handle(ctx("DELETE", "/users/1"))?.status).toBe(204);
    expect(s.handle(ctx("GET", "/users/1"))?.status).toBe(404);
    expect(s.handle(ctx("GET", "/users"))?.body).toHaveLength(2);
  });

  it("filters by field equality, _ne, _like and _gte/_lte", () => {
    const s = store();
    expect(s.handle(ctx("GET", "/users", { role: "admin" }))?.body).toHaveLength(2);
    expect(s.handle(ctx("GET", "/users", { role_ne: "admin" }))?.body).toHaveLength(1);
    expect(s.handle(ctx("GET", "/users", { name_like: "la" }))?.body).toHaveLength(1); // Alan
    expect(s.handle(ctx("GET", "/users", { age_gte: "41" }))?.body).toHaveLength(2);
    expect(s.handle(ctx("GET", "/users", { age_lte: "36" }))?.body).toHaveLength(1);
  });

  it("sorts and paginates json-server style", () => {
    const s = store();
    const sorted = s.handle(ctx("GET", "/users", { _sort: "age", _order: "desc" }))?.body as Array<{
      id: number;
    }>;
    expect(sorted.map((u) => u.id)).toEqual([3, 2, 1]);

    const page2 = s.handle(ctx("GET", "/users", { _page: "2", _limit: "2" }))?.body as unknown[];
    expect(page2).toHaveLength(1);
  });

  it("rejects non-object POST bodies", () => {
    const s = store();
    expect(s.handle(ctx("POST", "/users", {}, [1, 2]))?.status).toBe(400);
    expect(s.handle(ctx("POST", "/users", undefined))?.status).toBe(400);
  });

  it("ignores paths that are not resources", () => {
    const s = store();
    expect(s.handle(ctx("GET", "/orders"))).toBeUndefined();
    expect(s.handle(ctx("GET", "/users/1/orders"))).toBeUndefined();
    expect(s.handle(ctx("GET", "/users/1.json"))).toBeUndefined();
  });

  it("resets to seed state", () => {
    const s = store();
    s.handle(ctx("DELETE", "/users/1"));
    s.reset();
    expect(s.handle(ctx("GET", "/users"))?.body).toHaveLength(3);
  });

  it("persists mutations to the declared file", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(tmpdir(), "mocktape-"));
    const dbFile = path.join("db-test.json");
    const s = new ResourceStore({ users: { seed: SEED, persist: dbFile } }, dir);
    s.handle(ctx("POST", "/users", {}, { name: "New" }));
    await s.flush();
    const data = JSON.parse(await readFile(path.join(dir, dbFile), "utf8")) as { users: unknown[] };
    expect(data.users).toHaveLength(4);
  });
});
