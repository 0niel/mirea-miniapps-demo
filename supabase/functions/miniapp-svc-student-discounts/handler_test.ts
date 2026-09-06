import { createHandler } from "./handler.ts";
import type { Json } from "./domain.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("Assertion failed");
};
const key = "service-key-for-handler-tests-only";
const user = "11111111-1111-4111-8111-111111111111";
const context = {
  organizationId: "mirea",
  slug: "student-discounts",
  userId: user,
};
const request = (body: Json, token = key) =>
  new Request("https://service.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...context, ...body }),
  });

Deno.test("handler rejects unauthorized context before dispatch", async () => {
  let count = 0;
  const handler = createHandler(key, () => {
    count++;
    return Promise.resolve({});
  });
  for (
    const req of [
      request({}, "user-jwt"),
      request({ organizationId: "other" }),
      request({ slug: "iskra" }),
      request({ userId: "not-a-uuid" }),
      request({ userId: null }),
    ]
  ) assert((await handler(req)).status === 403);
  assert(count === 0);
});
Deno.test("handler counts streamed body bytes even without content length", async () => {
  const handler = createHandler(key, () => {
    throw new Error("Must not dispatch");
  });
  const req = request({ padding: "x".repeat(25000) });
  assert(!req.headers.has("content-length"));
  assert((await handler(req)).status === 413);
});
Deno.test("unknown kind and methods cannot mutate", async () => {
  let count = 0;
  const handler = createHandler(key, () => {
    count++;
    return Promise.resolve({});
  });
  assert((await handler(request({ kind: "maintenance" }))).status === 400);
  assert(
    (await handler(
      request({ kind: "api", method: "GET", path: "/api/favorite" }),
    )).status === 405,
  );
  assert(
    (await handler(
      request({ kind: "api", method: "POST", path: "/api/import" }),
    )).status === 404,
  );
  assert(count === 0);
});
Deno.test("favorites dispatch explicit booleans and authenticated proxy identity", async () => {
  let actual: unknown;
  const handler = createHandler(key, (...args) => {
    actual = args;
    return Promise.resolve({});
  });
  const response = await handler(
    request({
      kind: "api",
      method: "POST",
      path: "/api/favorite",
      body: { id: "github-pro", saved: true, userId: "other" },
    }),
  );
  assert(response.status === 200);
  assert(
    JSON.stringify(actual) ===
      JSON.stringify([user, "favorite", { id: "github-pro", saved: true }]),
  );
  assert(
    (await handler(
      request({
        kind: "api",
        method: "POST",
        path: "/api/favorite",
        body: { id: "github-pro", saved: "false" },
      }),
    )).status === 422,
  );
});
Deno.test("search returns presentation fields and excludes ended offers", async () => {
  const handler = createHandler(key, () =>
    Promise.resolve({
      offers: [{
        id: "one",
        title: "Музей",
        category: "culture",
        benefit: "Бесплатно",
        verified_at: "2026-09-06T00:00:00Z",
      }, { id: "two", title: "Expired", valid_until: "2020-01-01" }],
    }));
  const response = await handler(
    request({
      kind: "api",
      method: "POST",
      path: "/api/search",
      body: { q: "Музей" },
    }),
  );
  const result = await response.json();
  assert(result.items.length === 1);
  assert(result.items[0].emoji === "🏛️");
  assert(result.items[0].status_label);
});
Deno.test("moderation page loads queue only after server membership", async () => {
  const calls: string[] = [];
  const handler = createHandler(key, (_u, action) => {
    calls.push(action);
    return Promise.resolve({ isModerator: false });
  });
  const response = await handler(
    request({ path: "/review?id=test", isModerator: true }),
  );
  assert(response.status === 200);
  assert(calls.join(",") === "state");
  assert((await response.text()).includes("Доступ ограничен"));
});
Deno.test("moderation requires the version actually reviewed and reports stale content", async () => {
  let actual: Json | undefined;
  const handler = createHandler(key, (_u, _a, body) => {
    actual = body;
    return Promise.resolve({});
  });
  const body = { id: user, decision: "approve", note: "Условия проверены" };
  assert(
    (await handler(
      request({ kind: "api", method: "POST", path: "/api/moderate", body }),
    )).status === 422,
  );
  assert(actual === undefined);
  const expected_updated_at = "2026-09-06T08:00:00.123456+00:00";
  assert(
    (await handler(
      request({
        kind: "api",
        method: "POST",
        path: "/api/moderate",
        body: { ...body, expected_updated_at },
      }),
    )).status === 200,
  );
  assert(actual?.expected_updated_at === expected_updated_at);
  const stale = createHandler(key, () => {
    throw { code: "40001" };
  });
  assert(
    (await stale(
      request({
        kind: "api",
        method: "POST",
        path: "/api/moderate",
        body: { ...body, expected_updated_at },
      }),
    )).status === 409,
  );
});
Deno.test("internal database errors never leak SQL or credentials", async () => {
  const handler = createHandler(key, () => {
    throw { code: "XX000", message: "secret service token database statement" };
  });
  const response = await handler(request({}));
  assert(response.status === 500);
  assert(!(await response.text()).includes("secret"));
});
Deno.test("quota and permission errors keep meaningful response codes", async () => {
  for (
    const [code, status] of [["P0001", 429], ["42501", 403], ["P0002", 404], [
      "23514",
      422,
    ]] as const
  ) {
    const handler = createHandler(key, () => {
      throw { code };
    });
    assert((await handler(request({}))).status === status);
  }
});
