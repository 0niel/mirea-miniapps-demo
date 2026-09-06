import {
  constantTimeEqual,
  isUuid,
  type Json,
  literal,
  objectOf,
  pageOf,
  parseRoute,
  publicFailure,
  stringOf,
  validId,
} from "./domain.ts";
import { buildScreen, errorScreen } from "./screens.ts";

export type Dispatch = (
  userId: string,
  action: string,
  params: Json,
) => Promise<Json>;
export interface HandlerOptions {
  serviceKey: string;
  dispatch: Dispatch;
}
const MAX_BODY = 16384;
const SCREEN_ROUTES = new Set([
  "/",
  "/catalog",
  "/plan",
  "/semester",
  "/discipline",
  "/reminder",
  "/compare",
]);
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function json(value: unknown, status = 200): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > 500000) {
    return new Response(
      JSON.stringify(
        errorScreen(
          "Слишком много данных",
          "Попробуй открыть другой раздел плана.",
        ),
      ),
      { status: 200, headers },
    );
  }
  return new Response(body, { status, headers });
}
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY) {
    throw { code: "payload_too_large" };
  }
  const reader = request.body?.getReader();
  if (!reader) throw { code: "invalid_json" };
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw { code: "payload_too_large" };
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw { code: "invalid_json" };
  }
}
function paramsOf(params: Json): Json {
  return {
    ...Object.fromEntries(
      [
        "id",
        "other",
        "discipline",
        "semester",
        "filter",
        "compare",
        "q",
        "code",
        "year",
        "level",
        "form",
        "institute",
      ].filter((k) => typeof params[k] === "string").map((
        k,
      ) => [k, stringOf(params[k], k === "q" ? 100 : 500)]),
    ),
    ...(params.page !== undefined ? { page: pageOf(params.page) } : {}),
  };
}
function apiAction(
  path: string,
  raw: unknown,
): { action: string; params: Json } | null {
  const body = objectOf(raw);
  if (path === "/api/filters") {
    return { action: "save_filters", params: paramsOf(body) };
  }
  if (path === "/api/goal") {
    if (typeof body.goal !== "string" || body.goal.length > 500) {
      throw { code: "22023" };
    }
    return { action: "save_goal", params: { goal: literal(body.goal, 500) } };
  }
  if (
    !["/api/select", "/api/completed", "/api/note", "/api/chosen"].includes(
      path,
    )
  ) return null;
  if (!validId(body.id)) throw { code: "22023" };
  if (path === "/api/select") {
    return { action: "select_plan", params: { id: body.id } };
  }
  if (!validId(body.discipline_id)) throw { code: "22023" };
  if (path === "/api/chosen") {
    if (typeof body.chosen !== "boolean") throw { code: "22023" };
    return {
      action: "set_chosen",
      params: {
        id: body.id,
        discipline_id: body.discipline_id,
        chosen: body.chosen,
      },
    };
  }
  if (path === "/api/completed") {
    if (typeof body.completed !== "boolean") throw { code: "22023" };
    return {
      action: "set_completed",
      params: {
        id: body.id,
        discipline_id: body.discipline_id,
        completed: body.completed,
      },
    };
  }
  if (typeof body.note !== "string" || body.note.length > 2000) {
    throw { code: "22023" };
  }
  return {
    action: "save_note",
    params: {
      id: body.id,
      discipline_id: body.discipline_id,
      note: literal(body.note, 2000),
    },
  };
}
export function createHandler(
  options: HandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    const token = (request.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    if (!constantTimeEqual(token, options.serviceKey)) {
      return json({ error: "Forbidden" }, 403);
    }
    let input: Json;
    try {
      input = objectOf(await readBody(request));
    } catch (error) {
      return json({
        error: objectOf(error).code === "payload_too_large"
          ? "Payload too large"
          : "Invalid JSON",
      }, objectOf(error).code === "payload_too_large" ? 413 : 400);
    }
    if (
      input.organizationId !== "mirea" || input.slug !== "learning-roadmap" ||
      !isUuid(input.userId)
    ) return json({ error: "Invalid proxy context" }, 403);
    const kind = input.kind ?? "screen";
    try {
      const { path, params: raw } = parseRoute(input.path, input.query);
      if (kind === "screen") {
        if (!SCREEN_ROUTES.has(path)) {
          return json(
            errorScreen("Такой страницы нет", "Вернись на главную страницу."),
          );
        }
        const params = paramsOf(raw);
        const action = path === "/"
          ? "home"
          : path === "/catalog"
          ? "catalog"
          : path === "/compare"
          ? "compare"
          : "plan";
        const data = await options.dispatch(input.userId, action, params);
        return json(buildScreen(path, data, params));
      }
      if (kind !== "api") return json({ error: "Invalid request kind" }, 400);
      if (stringOf(input.method).toUpperCase() !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      const mutation = apiAction(path, input.body);
      if (!mutation) return json({ error: "Not found" }, 404);
      await options.dispatch(input.userId, mutation.action, mutation.params);
      return json({ ok: true });
    } catch (error) {
      const failure = publicFailure(error);
      return kind === "screen"
        ? json(errorScreen(undefined, failure.message))
        : json({ error: failure.message }, failure.status);
    }
  };
}
