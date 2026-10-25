import { describe, expect, it } from "vitest";
import { renderTemplate } from "../../src/template/template.js";
import type { RequestContext } from "../../src/http/types.js";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    method: "GET",
    path: "/users/42",
    query: { page: "2" },
    headers: { "x-token": "secret" },
    rawBody: undefined,
    params: { id: "42" },
    body: { user: { name: "ada" } },
    ...overrides,
  };
}

describe("renderTemplate", () => {
  it("leaves plain strings untouched", () => {
    expect(renderTemplate("hello", ctx())).toBe("hello");
  });

  it("resolves path params, query, headers and body values", () => {
    expect(renderTemplate("id={{ request.path.id }}", ctx())).toBe("id=42");
    expect(renderTemplate("page={{ request.query.page }}", ctx())).toBe("page=2");
    expect(renderTemplate("token={{ request.header.x-token }}", ctx())).toBe("token=secret");
    expect(renderTemplate("name={{ request.body.user.name }}", ctx())).toBe("name=ada");
  });

  it("resolves built-in variables", () => {
    expect(renderTemplate("{{ $uuid }}", ctx())).toMatch(/^[0-9a-f-]{36}$/);
    expect(renderTemplate("{{ $timestamp }}", ctx())).toBeTypeOf("number");
    expect(renderTemplate("{{ $isoTimestamp }}", ctx())).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const int = renderTemplate("{{ $randomInt }}", ctx());
    expect(int).toBeTypeOf("number");
    expect(int as number).toBeGreaterThanOrEqual(0);
    expect(int as number).toBeLessThan(1000);
    expect(renderTemplate("{{ $randomBoolean }}", ctx())).toBeTypeOf("boolean");
  });

  it("renders unknown expressions as empty strings", () => {
    expect(renderTemplate("x={{ $nope }}", ctx())).toBe("x=");
    expect(renderTemplate("x={{ request.nope.thing }}", ctx())).toBe("x=");
  });

  it("walks objects and arrays recursively", () => {
    const body = { list: ["{{ request.path.id }}"], nested: { v: "{{ $randomBoolean }}" } };
    const rendered = renderTemplate(body, ctx()) as { list: string[]; nested: { v: boolean } };
    expect(rendered.list[0]).toBe("42");
    expect([true, false]).toContain(rendered.nested.v);
  });

  it("preserves non-string primitives", () => {
    expect(renderTemplate({ a: 1, b: true, c: null }, ctx())).toEqual({ a: 1, b: true, c: null });
  });
});
