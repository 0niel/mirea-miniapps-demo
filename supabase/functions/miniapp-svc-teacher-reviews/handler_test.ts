import { createHandler } from "./handler.ts";
import type { Json } from "./domain.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("Assertion failed");
};
const key = "service-key-for-handler-tests-only";
const user = "11111111-1111-4111-8111-111111111111";
const teacher = "22222222-2222-4222-8222-222222222222";
const context = {
  organizationId: "mirea",
  slug: "teacher-reviews",
  userId: user,
};
const request = (body: Json, token = key) =>
  new Request("https://service.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...context, ...body }),
  });
const api = (path: string, body: Json) =>
  request({ kind: "api", method: "POST", path, body });

Deno.test("handler rejects unauthorized context before dispatch", async () => {
  let calls = 0;
  const handler = createHandler(key, () => {
    calls++;
    return Promise.resolve({});
  });
  for (
    const req of [
      request({}, "user-jwt"),
      request({ organizationId: "other" }),
      request({ slug: "student-discounts" }),
      request({ userId: "not-a-uuid" }),
      request({ userId: null }),
    ]
  ) assert((await handler(req)).status === 403);
  assert((await handler(new Request("https://service.test"))).status === 405);
  assert(calls === 0);
});
Deno.test("oversized and malformed bodies are refused", async () => {
  const handler = createHandler(key, () => {
    throw new Error("Must not dispatch");
  });
  assert(
    (await handler(request({ padding: "x".repeat(25000) }))).status === 413,
  );
  const broken = new Request("https://service.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: "{not json",
  });
  assert((await handler(broken)).status === 400);
});
Deno.test("screens dispatch the matching view and ids", async () => {
  const seen: unknown[][] = [];
  const handler = createHandler(key, (...args) => {
    seen.push(args);
    return Promise.resolve({ me: {}, teacher: null });
  });
  for (
    const [path, view, id] of [
      ["/", "home", ""],
      [`/teacher?id=${teacher}`, "teacher", teacher],
      [`/review?id=${teacher}`, "review", teacher],
      ["/top", "top", ""],
      ["/me", "me", ""],
      ["/recommend", "recommend", ""],
      ["/teacher?id=bad", "teacher", ""],
    ]
  ) {
    const response = await handler(request({ path }));
    assert(response.status === 200);
    const screen = await response.json();
    assert(screen.type === "scaffold");
    const call = seen.pop() as unknown[];
    assert(call[0] === user && call[1] === "state");
    assert(JSON.stringify(call[2]) === JSON.stringify({ view, id }));
  }
  const unknown = await handler(request({ path: "/nowhere" }));
  assert(unknown.status === 200);
  assert(seen.length === 0);
  assert((await handler(request({ path: "/../x" }))).status === 404);
});
Deno.test("unknown kinds, methods and api paths cannot mutate", async () => {
  let calls = 0;
  const handler = createHandler(key, () => {
    calls++;
    return Promise.resolve({});
  });
  assert((await handler(request({ kind: "maintenance" }))).status === 400);
  assert(
    (await handler(
      request({ kind: "api", method: "GET", path: "/api/review" }),
    )).status === 405,
  );
  assert((await handler(api("/api/import", {}))).status === 404);
  assert(calls === 0);
});
Deno.test("review api validates ratings, text and teacher id", async () => {
  let actual: unknown[] = [];
  let calls = 0;
  const handler = createHandler(key, (...args) => {
    actual = args;
    calls++;
    return Promise.resolve({ first: true, pioneer: false, points: 15 });
  });
  const ok = await handler(api("/api/review", {
    id: teacher.toUpperCase(),
    clarity: 5,
    loyalty: "4",
    usefulness: 3,
    body: "  Понятно объясняет  ",
    anonymous: true,
    userId: "other",
  }));
  assert(ok.status === 200);
  const payload = await ok.json();
  assert(
    payload.ok === true && payload.first === true && payload.points === 15,
  );
  assert(actual[0] === user && actual[1] === "review");
  assert(
    JSON.stringify(actual[2]) === JSON.stringify({
      id: teacher,
      clarity: 5,
      loyalty: 4,
      usefulness: 3,
      body: "Понятно объясняет",
      anonymous: true,
    }),
  );
  for (
    const body of [
      { id: teacher, clarity: 0, loyalty: 4, usefulness: 3 },
      { id: teacher, clarity: 5, loyalty: 4, usefulness: 7 },
      {
        id: teacher,
        clarity: 5,
        loyalty: 4,
        usefulness: 3,
        body: "{{state.x}}",
      },
      {
        id: teacher,
        clarity: 5,
        loyalty: 4,
        usefulness: 3,
        body: "x".repeat(2001),
      },
    ]
  ) assert((await handler(api("/api/review", body))).status === 422);
  assert(
    (await handler(
      api("/api/review", { id: "nope", clarity: 5, loyalty: 4, usefulness: 3 }),
    )).status === 404,
  );
  assert(calls === 1);
});
Deno.test("search and top validate enums and forward booleans", async () => {
  let actual: unknown[] = [];
  const handler = createHandler(key, (...args) => {
    actual = args;
    return Promise.resolve({
      count: 1,
      items: [{
        id: teacher,
        name: "Иванов Иван Иванович",
        reviews: 2,
        rating: 4.5,
        recent: 1,
      }],
    });
  });
  const search = await handler(
    api("/api/search", {
      q: "Иван",
      sort: "reviews",
      scope: "group",
      with_reviews: "yes",
      offset: 20,
    }),
  );
  assert(search.status === 200);
  const result = await search.json();
  assert(result.count === 1 && result.offset === 20);
  assert(result.items[0].rating_label === "4,5");
  assert(
    JSON.stringify(actual[2]) ===
      JSON.stringify({
        q: "Иван",
        sort: "reviews",
        scope: "group",
        with_reviews: false,
        offset: 20,
      }),
  );
  assert(
    (await handler(api("/api/search", { sort: "__proto__" }))).status === 422,
  );
  assert((await handler(api("/api/search", { offset: -1 }))).status === 422);
  const top = await handler(
    api("/api/top", { board: "rising", scope: "group" }),
  );
  assert(top.status === 200);
  const board = await top.json();
  assert(board.items[0].value_label === "+1");
  assert(
    JSON.stringify(actual[2]) ===
      JSON.stringify({ board: "rising", scope: "group" }),
  );
  assert((await handler(api("/api/top", { board: "secret" }))).status === 422);
});
Deno.test("vote, follow and settings require explicit booleans", async () => {
  const calls: unknown[][] = [];
  const handler = createHandler(key, (...args) => {
    calls.push(args);
    return Promise.resolve({ helpful: 3 });
  });
  const vote = await handler(api("/api/vote", { id: teacher, helpful: true }));
  assert((await vote.json()).helpful === 3);
  assert(
    (await handler(api("/api/vote", { id: teacher, helpful: "true" })))
      .status === 422,
  );
  assert(
    (await handler(api("/api/vote", { id: "x", helpful: true }))).status ===
      404,
  );
  assert(
    (await handler(api("/api/follow", { id: teacher, follow: false })))
      .status === 200,
  );
  assert((await handler(api("/api/follow", { id: teacher }))).status === 422);
  assert(
    (await handler(api("/api/settings", { show_in_leaderboard: true })))
      .status === 200,
  );
  assert(
    (await handler(api("/api/settings", { show_in_leaderboard: 1 }))).status ===
      422,
  );
  assert(
    (await handler(api("/api/review/delete", { id: teacher }))).status === 200,
  );
  assert(calls.length === 4);
  assert(
    calls.map((c) => c[1]).join() === "vote,follow,settings,delete_review",
  );
});
Deno.test("database errors map to safe statuses", async () => {
  const codes: [string, number][] = [
    ["42501", 403],
    ["P0002", 404],
    ["P0001", 429],
    ["22023", 422],
    ["22P02", 422],
    ["XX000", 500],
  ];
  for (const [code, status] of codes) {
    const handler = createHandler(key, () => Promise.reject({ code }));
    const response = await handler(
      api("/api/follow", { id: teacher, follow: true }),
    );
    assert(response.status === status);
    const payload = await response.json();
    assert(typeof payload.error === "string" && !payload.error.includes(code));
  }
});
