import { createHandler, type Dispatch } from "./handler.ts";
import type { Json } from "./domain.ts";
import * as fx from "./fixtures.ts";

const assert = (v: unknown, message = "Assertion failed") => {
  if (!v) throw new Error(message);
};
const key = "service-key-for-handler-tests-only";
const user = "11111111-1111-4111-8111-111111111111";
const entry = "22222222-2222-4222-8222-222222222222";
const context = { organizationId: "mirea", slug: "queue", userId: user };
const request = (body: Json, token = key) =>
  new Request("https://service.test/miniapp-svc-queue", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...context, ...body }),
  });
const api = (path: string, body: Json) =>
  request({ kind: "api", method: "POST", path, body });
const recorder = (result: Json | ((action: string) => Json) = { ok: true }) => {
  const calls: [string, string, Json][] = [];
  const dispatch: Dispatch = (userId, action, payload = {}) => {
    calls.push([userId, action, payload]);
    return Promise.resolve(
      typeof result === "function" ? result(action) : result,
    );
  };
  return {
    calls,
    handler: createHandler(key, dispatch, {
      now: () => fx.now,
      publicBase: "https://project.supabase.co",
    }),
  };
};
const failing = (code: string) =>
  createHandler(key, () => Promise.reject({ code }), { now: () => fx.now });

Deno.test("handler rejects foreign callers before dispatch", async () => {
  const { handler, calls } = recorder();
  for (
    const req of [
      request({}, "user-jwt"),
      request({ organizationId: "other" }),
      request({ slug: "teacher-reviews" }),
      request({ userId: "not-a-uuid" }),
    ]
  ) assert((await handler(req)).status === 403);
  const put = new Request("https://service.test", { method: "PUT" });
  assert((await handler(put)).status === 405);
  assert(calls.length === 0);
  const big = await handler(request({ padding: "x".repeat(20000) }));
  assert(big.status === 413);
});

Deno.test("qr images are public, cacheable and only for valid codes", async () => {
  const { handler, calls } = recorder();
  const ok = await handler(
    new Request("https://service.test/miniapp-svc-queue/qr/K7F2QX.png"),
  );
  assert(ok.status === 200);
  assert(ok.headers.get("Content-Type") === "image/png");
  assert(ok.headers.get("Cache-Control")?.includes("immutable"));
  const bytes = new Uint8Array(await ok.arrayBuffer());
  assert(bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
  for (
    const path of ["qr/k7f2qx.png", "qr/K7F2Q.png", "qr/O0O0O0.png", "other"]
  ) {
    const res = await handler(
      new Request(`https://service.test/miniapp-svc-queue/${path}`),
    );
    assert(res.status === 404, path);
    await res.body?.cancel();
  }
  assert(calls.length === 0);
});

Deno.test("screens dispatch the matching view and code", async () => {
  const { handler, calls } = recorder({ me: fx.me, queue: null });
  const home = await handler(request({ path: "/" }));
  assert(home.status === 200);
  await home.json();
  const queue = await handler(request({ path: "/q?code=k7f2qx" }));
  const screen = await queue.json();
  assert(JSON.stringify(screen).includes("Очередь не найдена"));
  await (await handler(request({ path: "/history?code=K7F2QX" }))).json();
  const missing = await handler(request({ path: "/q?code=bad" }));
  await missing.json();
  const unknown = await (await handler(request({ path: "/nope" }))).json();
  assert(JSON.stringify(unknown).includes("Страница не найдена"));
  assert(
    JSON.stringify(calls.map((c) => [c[1], c[2]])) === JSON.stringify([
      ["state", { view: "home", code: "" }],
      ["state", { view: "queue", code: "K7F2QX" }],
      ["state", { view: "history", code: "K7F2QX" }],
    ]),
  );
});

Deno.test("queue screens point the QR image at the public function", async () => {
  const { handler } = recorder(fx.queueState);
  const screen = await (await handler(request({ path: "/q?code=K7F2QX" })))
    .json();
  assert(
    JSON.stringify(screen).includes(
      "https://project.supabase.co/functions/v1/miniapp-svc-queue/qr/K7F2QX.png",
    ),
  );
});

Deno.test("resolve accepts links and lookalike codes", async () => {
  const { handler, calls } = recorder({ ok: true, code: "P2HC9T" });
  const res = await handler(
    api("/api/resolve", {
      raw:
        "https://mirea.ninja/app/services/apps/queue/run?page=%2Fq%3Fcode%3DP2HC9T",
    }),
  );
  const body = await res.json();
  assert(body.ok === true && body.code === "P2HC9T");
  await (await handler(api("/api/resolve", { raw: "р2нс 9т" }))).json();
  assert(calls.length === 2 && calls[1][2].code === "P2HC9T");
  const bad = await (await handler(api("/api/resolve", { raw: "привет" })))
    .json();
  assert(bad.ok === false && String(bad.message).includes("6 символов"));
  const missing = await (await failing("P0002")(
    api("/api/resolve", { raw: "K7F2QX" }),
  )).json();
  assert(
    missing.ok === false && String(missing.message).includes("не найдена"),
  );
});

Deno.test("when formats a custom opening moment", async () => {
  const { handler, calls } = recorder();
  const ok = await (await handler(
    api("/api/when", { iso: "2026-09-23T14:20:00.000" }),
  )).json();
  assert(ok.ok === true && ok.label === "сегодня в 14:20");
  assert(ok.iso === "2026-09-23T11:20:00.000Z");
  const past = await (await handler(
    api("/api/when", { iso: "2026-09-23T08:00:00.000" }),
  )).json();
  assert(past.ok === false);
  const broken = await (await handler(api("/api/when", { iso: "soon" })))
    .json();
  assert(broken.ok === false);
  assert(calls.length === 0);
});

Deno.test("create validates and normalizes the form", async () => {
  const { handler, calls } = recorder({ ok: true, code: "K7F2QX" });
  const created = await (await handler(api("/api/create", {
    title: "  Физика — лаба 3 ",
    note: "Ауд. А-214\nПо две лабы",
    mode: "owner",
    opens: "2026-09-23T14:20:00.000",
    capacity: 30,
    group: true,
    join_self: false,
  }))).json();
  assert(created.ok === true && created.code === "K7F2QX");
  const payload = calls[0][2];
  assert(calls[0][1] === "create");
  assert(payload.title === "Физика — лаба 3");
  assert(payload.opens_at === "2026-09-23T11:20:00.000Z");
  assert(payload.capacity === 30 && payload.group === true);
  const now = await (await handler(api("/api/create", {
    title: "Матан",
    opens: "now",
    capacity: 0,
  }))).json();
  assert(now.ok === true && calls[1][2].opens_at === null);
  for (
    const body of [
      { title: "x" },
      { title: "{{state.secret}}" },
      { title: "Норм", mode: "random" },
      { title: "Норм", capacity: 1 },
      { title: "Норм", opens: "2027-01-01T10:00:00" },
    ]
  ) {
    const res = await (await handler(api("/api/create", body))).json();
    assert(res.ok === false && res.message, JSON.stringify(body));
  }
  assert(calls.length === 2);
});

Deno.test("queue actions validate codes, entries and positions", async () => {
  const { handler, calls } = recorder({ ok: true, position: 4 });
  const joined = await (await handler(
    api("/api/join", { code: "k7f 2qx", note: "Лаба 3" }),
  )).json();
  assert(joined.ok === true && joined.position === 4);
  for (
    const path of [
      "leave",
      "let_ahead",
      "start",
      "done",
      "next",
      "shuffle",
      "reset",
      "delete",
    ]
  ) {
    await (await handler(api(`/api/${path}`, { code: "K7F2QX" }))).json();
  }
  await (await handler(api("/api/skip", { code: "K7F2QX", entry }))).json();
  await (await handler(api("/api/move", { code: "K7F2QX", entry, to: 1 })))
    .json();
  await (await handler(
    api("/api/status", { code: "K7F2QX", status: "closed" }),
  ))
    .json();
  assert(calls[0][2].code === "K7F2QX" && calls[0][2].note === "Лаба 3");
  assert(
    calls.map((c) => c[1]).join() ===
      "join,leave,let_ahead,start,done,next,shuffle,reset,delete,skip,move,status",
  );
  const before = calls.length;
  assert((await handler(api("/api/join", { code: "bad" }))).status === 404);
  assert(
    (await handler(api("/api/skip", { code: "K7F2QX", entry: "x" }))).status ===
      404,
  );
  const move =
    await (await handler(api("/api/move", { code: "K7F2QX", entry, to: 0 })))
      .json();
  assert(move.ok === false);
  const status = await (await handler(
    api("/api/status", { code: "K7F2QX", status: "paused" }),
  )).json();
  assert(status.ok === false);
  assert(
    (await handler(api("/api/unknown", { code: "K7F2QX" }))).status === 404,
  );
  assert(calls.length === before);
});

Deno.test("business rejections keep the server message", async () => {
  const { handler } = recorder({ ok: false, message: "Все места заняты" });
  const res = await (await handler(api("/api/join", { code: "K7F2QX" })))
    .json();
  assert(res.ok === false && res.message === "Все места заняты");
});

Deno.test("database errors map to safe statuses", async () => {
  const join = api("/api/join", { code: "K7F2QX" });
  assert((await failing("42501")(join.clone())).status === 403);
  assert((await failing("P0002")(join.clone())).status === 404);
  assert((await failing("P0001")(join.clone())).status === 429);
  const invalid = await (await failing("22023")(join.clone())).json();
  assert(invalid.ok === false);
  const duplicate = await (await failing("23505")(join.clone())).json();
  assert(duplicate.ok === false && duplicate.message.includes("уже"));
  const crash = await failing("XX000")(join.clone());
  assert(crash.status === 500);
  const body = await crash.json();
  assert(!JSON.stringify(body).includes("XX000"));
});
