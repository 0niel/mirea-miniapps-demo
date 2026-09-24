import {
  appLink,
  constantTimeEqual,
  extractCode,
  InputError,
  type Json,
  normalizeCode,
  number,
  object,
  parseMoment,
  parseRoute,
  queuePath,
  slug,
  string,
  textInput,
  uuid,
  whenLabel,
} from "./domain.ts";
import { qrPng } from "./qr.ts";
import { buildScreen } from "./screens.ts";

export type Dispatch = (
  userId: string,
  action: string,
  payload?: Json,
) => Promise<Json>;
export type HandlerOptions = {
  now?: () => number;
  publicBase?: string;
};
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
const views: Record<string, string> = {
  "/": "home",
  "/new": "new",
  "/q": "queue",
  "/history": "history",
  "/edit": "edit",
};
const selfActions = ["leave", "let_ahead", "start", "done"];
const ownerActions = ["next", "shuffle", "reset", "delete"];
const entryActions = ["skip", "remove"];

async function readBody(request: Request): Promise<Json> {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("Пустой запрос", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16000) {
      await reader.cancel();
      throw new InputError("Запрос слишком большой", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new InputError("Некорректный запрос", 400);
  }
}

function codeInput(v: unknown): string {
  const code = normalizeCode(v);
  if (!code) throw new InputError("Очередь не найдена", 404);
  return code;
}

function entryInput(v: unknown): string {
  if (!uuid(v)) throw new InputError("Участник не найден", 404);
  return string(v).toLowerCase();
}

function boolInput(v: unknown): boolean {
  return v === true || v === "true";
}

function capacityInput(v: unknown): number {
  const n = number(v, 0);
  if (!Number.isInteger(n) || (n !== 0 && (n < 2 || n > 200))) {
    throw new InputError("Лимит мест — от 2 до 200");
  }
  return n;
}

function modeInput(v: unknown): string {
  const mode = string(v) || "join";
  if (!["join", "owner"].includes(mode)) throw new InputError();
  return mode;
}

function momentInput(v: unknown, now: number): string | null {
  const time = parseMoment(v, now);
  return time == null ? null : new Date(time).toISOString();
}

export function createHandler(
  serviceKey: string,
  dispatch: Dispatch,
  options: HandlerOptions = {},
) {
  const clock = options.now ?? (() => Date.now());
  const publicBase = options.publicBase ?? "";
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const match = /\/qr\/([^/]+)\.png$/.exec(url.pathname);
      const code = match ? normalizeCode(match[1]) : null;
      if (!code || code !== match?.[1]) {
        return json({ error: "Not found" }, 404);
      }
      return new Response(await qrPng(appLink(queuePath(code))), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    const token = (request.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    if (!constantTimeEqual(token, serviceKey)) {
      return json({ error: "Forbidden" }, 403);
    }
    let apiPath = "";
    try {
      const input = await readBody(request);
      if (
        input.organizationId !== "mirea" || input.slug !== slug ||
        !uuid(input.userId)
      ) return json({ error: "Invalid proxy context" }, 403);
      const userId = string(input.userId),
        route = parseRoute(input.path),
        body = object(input.body),
        now = clock();
      if ((input.kind ?? "screen") === "screen") {
        const view = views[route.path];
        const state = !view
          ? {}
          : ["queue", "history", "edit"].includes(view) && !route.code
          ? { queue: null }
          : await dispatch(userId, "state", { view, code: route.code });
        return json(
          buildScreen(route.path, state, {
            code: route.code,
            now,
            publicBase,
          }),
        );
      }
      if (input.kind !== "api") {
        throw new InputError("Invalid request kind", 400);
      }
      if (string(input.method).toUpperCase() !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      apiPath = route.path;
      const action = route.path.replace(/^\/api\//, "");
      if (route.path === "/api/resolve") {
        const code = extractCode(body.raw);
        if (!code) {
          return json({
            ok: false,
            message:
              "Не похоже на код очереди. Код — 6 символов, например K7F 2QX.",
          });
        }
        const result = await dispatch(userId, "resolve", { code });
        return json({ ok: true, code: string(result.code) });
      }
      if (route.path === "/api/when") {
        const time = parseMoment(body.iso, now);
        if (time == null) {
          return json({
            ok: false,
            message: "Это время уже прошло — запись откроется сразу.",
          });
        }
        return json({
          ok: true,
          iso: new Date(time).toISOString(),
          label: whenLabel(time, now),
        });
      }
      let payload: Json;
      if (route.path === "/api/create") {
        payload = {
          title: textInput(body.title, 2, 80),
          note: textInput(body.note ?? "", 0, 280, true),
          mode: modeInput(body.mode),
          opens_at: momentInput(body.opens, now),
          capacity: capacityInput(body.capacity),
          group: boolInput(body.group),
          join_self: boolInput(body.join_self),
        };
      } else if (route.path === "/api/edit") {
        payload = {
          code: codeInput(body.code),
          title: textInput(body.title, 2, 80),
          note: textInput(body.note ?? "", 0, 280, true),
          mode: modeInput(body.mode),
          opens_at: momentInput(body.opens, now),
          capacity: capacityInput(body.capacity),
          group: boolInput(body.group),
        };
      } else if (route.path === "/api/join" || route.path === "/api/note") {
        payload = {
          code: codeInput(body.code),
          note: textInput(body.note ?? "", 0, 60),
        };
      } else if (
        selfActions.includes(action) || ownerActions.includes(action)
      ) {
        payload = { code: codeInput(body.code) };
      } else if (entryActions.includes(action)) {
        payload = { code: codeInput(body.code), entry: entryInput(body.entry) };
      } else if (route.path === "/api/move") {
        const to = number(body.to, NaN);
        if (!Number.isInteger(to) || to < 1 || to > 1000) {
          throw new InputError();
        }
        payload = {
          code: codeInput(body.code),
          entry: entryInput(body.entry),
          to,
        };
      } else if (route.path === "/api/status") {
        const status = string(body.status);
        if (!["open", "closed", "finished"].includes(status)) {
          throw new InputError();
        }
        payload = { code: codeInput(body.code), status };
      } else throw new InputError("Страница не найдена", 404);
      const result = await dispatch(userId, action, payload);
      const out: Json = { ok: result.ok !== false };
      if (result.ok === false) out.message = string(result.message);
      if (result.code != null) out.code = string(result.code);
      if (result.position != null) out.position = number(result.position, 0);
      return json(out);
    } catch (error) {
      if (error instanceof InputError) {
        if (apiPath && error.status === 422) {
          return json({ ok: false, message: error.message });
        }
        return json({ error: error.message }, error.status);
      }
      const code = string(object(error).code);
      if (code === "P0002") {
        if (apiPath === "/api/resolve") {
          return json({
            ok: false,
            message: "Очередь с таким кодом не найдена. Проверьте символы.",
          });
        }
        return json({ error: "Запись уже недоступна" }, 404);
      }
      if (code === "42501") return json({ error: "Действие недоступно" }, 403);
      if (code === "P0001") {
        return json({ error: "Лимит на сегодня исчерпан" }, 429);
      }
      if (
        ["22023", "23514", "22007", "22P02", "22001", "22008"].includes(code)
      ) {
        return apiPath
          ? json({ ok: false, message: "Проверьте заполненные поля" })
          : json({ error: "Проверьте заполненные поля" }, 422);
      }
      if (code === "23505") {
        return json({ ok: false, message: "Вы уже в этой очереди" });
      }
      return json(
        { error: "Сервис временно недоступен. Попробуйте ещё раз." },
        500,
      );
    }
  };
}
