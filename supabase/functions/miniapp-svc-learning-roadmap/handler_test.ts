import { type Json } from "./domain.ts";
import { createHandler } from "./handler.ts";
import { sampleData } from "./fixtures.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const USER = "ae594f66-bd7d-4b87-b927-d88109141abd";
const KEY = "test-service-key";
function req(input: Json, token = KEY): Request {
  return new Request("https://edge.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      organizationId: "mirea",
      slug: "learning-roadmap",
      userId: USER,
      ...input,
    }),
  });
}
Deno.test("only a trusted proxy can call screen or mutation dispatch", async () => {
  let count = 0;
  const handler = createHandler({
    serviceKey: KEY,
    dispatch: () => {
      count++;
      return Promise.resolve(sampleData);
    },
  });
  for (
    const request of [
      req({}, "anonymous-key"),
      req({ organizationId: "other" }),
      req({ slug: "iskra" }),
      req({ userId: "bad" }),
      req({ userId: null }),
    ]
  ) assert((await handler(request)).status === 403);
  assert(count === 0);
  assert((await handler(new Request("https://edge.test"))).status === 405);
});
Deno.test("API payload cannot impersonate another user or smuggle unrecognized action", async () => {
  let called: Json = {};
  const handler = createHandler({
    serviceKey: KEY,
    dispatch: (userId, action, params) => {
      called = { userId, action, params };
      return Promise.resolve({ ok: true });
    },
  });
  assert(
    (await handler(
      req({
        kind: "api",
        method: "POST",
        path: "/api/chosen",
        body: {
          id: "plan",
          discipline_id: "subject",
          chosen: true,
          scope: "subject",
          userId: "victim",
          p_user_id: "victim",
          action: "import",
        },
      }),
    )).status === 200,
  );
  assert(called.userId === USER && called.action === "set_chosen");
  assert((called.params as Json).scope === "subject");
  assert(!("userId" in (called.params as Json)));
  assert(
    (await handler(req({ kind: "api", method: "GET", path: "/api/note" })))
      .status === 405,
  );
  assert(
    (await handler(req({ kind: "api", method: "POST", path: "/api/import" })))
      .status === 404,
  );
});
Deno.test("body limits count streamed UTF-8 bytes without content-length", async () => {
  const handler = createHandler({
    serviceKey: KEY,
    dispatch: () => Promise.resolve({}),
  });
  assert(
    (await handler(
      req({
        kind: "api",
        method: "POST",
        path: "/api/note",
        body: { note: "я".repeat(10000) },
      }),
    )).status === 413,
  );
  assert(
    (await handler(
      new Request("https://edge.test", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}` },
        body: "[",
      }),
    )).status === 400,
  );
});
Deno.test("mutations validate booleans and text sizes and sanitize saved expressions", async () => {
  let saved: Json = {};
  const handler = createHandler({
    serviceKey: KEY,
    dispatch: (_u, _a, p) => {
      saved = p;
      return Promise.resolve({});
    },
  });
  assert(
    (await handler(
      req({
        kind: "api",
        method: "POST",
        path: "/api/chosen",
        body: { id: "plan", discipline_id: "subject", chosen: "false" },
      }),
    )).status === 400,
  );
  assert(
    (await handler(
      req({
        kind: "api",
        method: "POST",
        path: "/api/note",
        body: { id: "plan", discipline_id: "subject", note: "a".repeat(2001) },
      }),
    )).status === 400,
  );
  assert(
    (await handler(
      req({
        kind: "api",
        method: "POST",
        path: "/api/note",
        body: { id: "plan", discipline_id: "subject", note: "{{storage.key}}" },
      }),
    )).status === 200,
  );
  assert(!String(saved.note).includes("{{"));
});
Deno.test("removed completion endpoint and invalid choice scopes never reach dispatch", async () => {
  let count = 0;
  const handler = createHandler({
    serviceKey: KEY,
    dispatch: () => {
      count++;
      return Promise.resolve({});
    },
  });
  assert(
    (await handler(
      req({
        kind: "api",
        method: "POST",
        path: "/api/completed",
        body: { id: "plan", discipline_id: "subject", completed: true },
      }),
    )).status === 404,
  );
  assert(
    (await handler(
      req({
        kind: "api",
        method: "POST",
        path: "/api/chosen",
        body: {
          id: "plan",
          discipline_id: "subject",
          chosen: true,
          scope: "plan",
        },
      }),
    )).status === 400,
  );
  assert(count === 0);
});
Deno.test("screen database failures render a recoverable screen without private details", async () => {
  const handler = createHandler({
    serviceKey: KEY,
    dispatch: () =>
      Promise.reject({ code: "internal", message: "password=private" }),
  });
  const response = await handler(req({ path: "/" }));
  const body = await response.text();
  assert(
    response.status === 200 && body.includes("appErrorState") &&
      !body.includes("password"),
  );
});
Deno.test("screen path and proxy query route to the correct operation", async () => {
  let called: Json = {};
  const handler = createHandler({
    serviceKey: KEY,
    dispatch: (_u, action, params) => {
      called = { action, params };
      return Promise.resolve(sampleData);
    },
  });
  const response = await handler(
    req({
      path: "/compare",
      query: { id: "sample-plan-a", other: "sample-plan-b" },
    }),
  );
  assert(
    response.status === 200 && called.action === "compare" &&
      (called.params as Json).other === "sample-plan-b",
  );
});
