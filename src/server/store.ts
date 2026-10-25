import { randomUUID } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { ResourceSpec } from "../config/schema.js";
import type { RequestContext } from "../http/types.js";

/** ResourceSpec without required fields that parseConfig normally fills in. */
export type ResourceSpecInput = Omit<ResourceSpec, "idField"> & { idField?: string };

export interface StoredResponse {
  status: number;
  body?: unknown;
  /** Resource name that served the response. */
  origin?: string;
}

const RESERVED_QUERY_KEYS = new Set(["_page", "_limit", "_sort", "_order"]);

function readField(item: unknown, field: string): unknown {
  return field.split(".").reduce<unknown>((acc, key) => {
    if (Array.isArray(acc)) {
      const index = Number(key);
      return Number.isInteger(index) ? acc[index] : undefined;
    }
    if (acc !== null && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, item);
}

function looseEqual(actual: unknown, expected: string): boolean {
  if (actual === null || actual === undefined) return false;
  if (Array.isArray(actual)) return actual.some((item) => String(item) === expected);
  return String(actual) === expected;
}

/**
 * In-memory CRUD store for `resources`. Mirrors the json-server query
 * conventions (filtering, `_like`, `_ne`, `_gte`/`_lte`, `_sort`/`_order`,
 * `_page`/`_limit` pagination) so existing muscle memory applies.
 */
export class ResourceStore {
  private readonly items = new Map<string, unknown[]>();
  private readonly specByName = new Map<string, ResourceSpec>();
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    specs: Record<string, ResourceSpecInput>,
    private readonly baseDir: string,
  ) {
    // Normalize: ResourceStore is public API and may be constructed without
    // running configs through parseConfig first.
    for (const [name, spec] of Object.entries(specs)) {
      const normalized: ResourceSpec = {
        seed: spec.seed,
        idField: spec.idField ?? "id",
        persist: spec.persist,
      };
      this.specByName.set(name, normalized);
      this.items.set(name, normalized.seed ? structuredClone(normalized.seed) : []);
    }
  }

  /** Load persisted state over seeds (called once at startup). */
  async hydrate(): Promise<void> {
    for (const [name, spec] of this.specByName) {
      if (!spec.persist) continue;
      try {
        const raw = await readFile(path.resolve(this.baseDir, spec.persist), "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data[name])) this.items.set(name, data[name]);
      } catch {
        // no persisted file yet — seeds stay in place
      }
    }
  }

  names(): string[] {
    return [...this.specByName.keys()];
  }

  getItems(name: string): unknown[] {
    return this.items.get(name) ?? [];
  }

  /** Reset every resource back to its seed (or empty) state. */
  reset(): void {
    for (const [name, spec] of this.specByName) {
      this.items.set(name, spec.seed ? structuredClone(spec.seed) : []);
    }
  }

  /** Try to serve `request` from a resource. Returns undefined when not a resource path. */
  handle(request: RequestContext): StoredResponse | undefined {
    const segments = request.path.replace(/^\//, "").split("/").filter(Boolean);
    if (segments.length === 0 || segments.length > 2) return undefined;
    const [name, id] = segments as [string, string | undefined];
    if (!this.specByName.has(name)) return undefined;
    if (id !== undefined && id.includes(".")) return undefined; // e.g. /users/1.json — not ours

    const method = request.method === "HEAD" ? "GET" : request.method;
    const served = (response: StoredResponse): StoredResponse => ({ ...response, origin: name });
    switch (method) {
      case "GET":
        return id === undefined ? served(this.list(name, request)) : served(this.getOne(name, id));
      case "POST":
        return id === undefined ? served(this.create(name, request)) : undefined;
      case "PUT":
      case "PATCH":
        return id === undefined
          ? undefined
          : served(this.update(name, id, request, method === "PUT"));
      case "DELETE":
        return id === undefined ? undefined : served(this.remove(name, id));
      default:
        return undefined;
    }
  }

  private list(name: string, request: RequestContext): StoredResponse {
    let items = [...this.getItems(name)];
    const query = request.query;

    for (const [key, value] of Object.entries(query)) {
      if (RESERVED_QUERY_KEYS.has(key)) continue;
      if (key.endsWith("_ne")) {
        const field = key.slice(0, -3);
        items = items.filter((item) => !looseEqual(readField(item, field), value));
      } else if (key.endsWith("_like")) {
        const field = key.slice(0, -5);
        items = items.filter((item) =>
          String(readField(item, field) ?? "")
            .toLowerCase()
            .includes(value.toLowerCase()),
        );
      } else if (key.endsWith("_gte")) {
        const field = key.slice(0, -4);
        items = items.filter((item) => compare(readField(item, field), value) >= 0);
      } else if (key.endsWith("_lte")) {
        const field = key.slice(0, -4);
        items = items.filter((item) => compare(readField(item, field), value) <= 0);
      } else if (key === "id" && value.includes(",")) {
        const ids = value.split(",");
        items = items.filter((item) => ids.some((id) => looseEqual(readField(item, "id"), id)));
      } else {
        items = items.filter((item) => looseEqual(readField(item, key), value));
      }
    }

    const sortKey = query["_sort"];
    if (sortKey !== undefined) {
      const order = query["_order"]?.toLowerCase() === "desc" ? -1 : 1;
      items.sort((a, b) => {
        const av = readField(a, sortKey);
        const bv = readField(b, sortKey);
        if (av === bv) return 0;
        if (av === undefined || av === null) return 1;
        if (bv === undefined || bv === null) return -1;
        return (av < bv ? -1 : 1) * order;
      });
    }

    const page = query["_page"];
    const limitQuery = query["_limit"];
    if (page !== undefined) {
      const limit = Math.max(1, Number(limitQuery ?? 10));
      const pageNumber = Math.max(1, Number(page));
      const start = (pageNumber - 1) * limit;
      items = items.slice(start, start + limit);
    } else if (limitQuery !== undefined) {
      // _limit works standalone too: ?_limit=5 returns the first 5 items.
      items = items.slice(0, Math.max(1, Number(limitQuery)));
    }

    return { status: 200, body: items };
  }

  private getOne(name: string, id: string): StoredResponse {
    const spec = this.specByName.get(name)!;
    const item = this.getItems(name).find((entry) =>
      looseEqual(readField(entry, spec.idField), id),
    );
    if (item === undefined) {
      return { status: 404, body: { error: "not found", resource: name, id } };
    }
    return { status: 200, body: item };
  }

  private create(name: string, request: RequestContext): StoredResponse {
    if (
      request.body === undefined ||
      typeof request.body !== "object" ||
      Array.isArray(request.body)
    ) {
      return { status: 400, body: { error: "expected a JSON object body" } };
    }
    const spec = this.specByName.get(name)!;
    const items = this.getItems(name);
    const item = structuredClone(request.body) as Record<string, unknown>;
    if (item[spec.idField] === undefined) {
      item[spec.idField] = nextId(items, spec.idField);
    }
    items.push(item);
    this.schedulePersist(name);
    return { status: 201, body: item };
  }

  private update(
    name: string,
    id: string,
    request: RequestContext,
    replace: boolean,
  ): StoredResponse {
    if (
      request.body === undefined ||
      typeof request.body !== "object" ||
      Array.isArray(request.body)
    ) {
      return { status: 400, body: { error: "expected a JSON object body" } };
    }
    const spec = this.specByName.get(name)!;
    const items = this.getItems(name);
    const index = items.findIndex((entry) => looseEqual(readField(entry, spec.idField), id));
    if (index === -1) {
      return { status: 404, body: { error: "not found", resource: name, id } };
    }
    const current = items[index] as Record<string, unknown>;
    const patch = structuredClone(request.body) as Record<string, unknown>;
    delete patch[spec.idField]; // ids are immutable
    items[index] = replace
      ? { ...patch, [spec.idField]: current[spec.idField] }
      : { ...current, ...patch };
    this.schedulePersist(name);
    return { status: 200, body: items[index] };
  }

  private remove(name: string, id: string): StoredResponse {
    const spec = this.specByName.get(name)!;
    const items = this.getItems(name);
    const index = items.findIndex((entry) => looseEqual(readField(entry, spec.idField), id));
    if (index === -1) {
      return { status: 404, body: { error: "not found", resource: name, id } };
    }
    items.splice(index, 1);
    this.schedulePersist(name);
    return { status: 204 };
  }

  /** Debounced write so rapid test mutations do not hammer the disk. */
  private schedulePersist(name: string): void {
    const spec = this.specByName.get(name)!;
    if (!spec.persist) return;
    const existing = this.persistTimers.get(name);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.persistTimers.delete(name);
      void this.persistNow(name, spec);
    }, 200);
    timer.unref?.();
    this.persistTimers.set(name, timer);
  }

  private async persistNow(name: string, spec: ResourceSpec): Promise<void> {
    if (spec.persist === undefined) return;
    const target = path.resolve(this.baseDir, spec.persist);
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
    } catch {
      // start a fresh file
    }
    data[name] = this.getItems(name);
    await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  /** Flush any pending persistence (used by graceful shutdown and tests). */
  async flush(): Promise<void> {
    for (const [name, timer] of this.persistTimers) {
      clearTimeout(timer);
      this.persistTimers.delete(name);
      const spec = this.specByName.get(name)!;
      if (spec.persist) await this.persistNow(name, spec);
    }
  }
}

function nextId(items: unknown[], idField: string): string | number {
  const numericIds = items
    .map((item) => readField(item, idField))
    .filter((value): value is number => typeof value === "number");
  if (numericIds.length > 0) return Math.max(...numericIds) + 1;
  const anyIds = items.some((item) => readField(item, idField) !== undefined);
  return anyIds ? randomUUID() : 1;
}

function compare(actual: unknown, expected: string): number {
  const a = typeof actual === "number" ? actual : Number(actual);
  const b = Number(expected);
  if (!Number.isNaN(a) && !Number.isNaN(b) && actual !== undefined && actual !== null) {
    return a - b;
  }
  return String(actual ?? "") < expected ? -1 : String(actual ?? "") > expected ? 1 : 0;
}
