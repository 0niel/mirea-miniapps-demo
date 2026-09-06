import {
  constantTimeEqual,
  filterOffers,
  InputError,
  type Json,
  list,
  object,
  parseRoute,
  string,
  suggestionPayload,
  textInput,
  uuid,
} from "./domain.ts";
import { buildScreen, presentOffer } from "./screens.ts";

export type Dispatch = (
  userId: string,
  action: string,
  payload?: Json,
) => Promise<Json>;
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });

async function readBody(request: Request): Promise<Json> {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("Пустой запрос", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 24000) {
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

export function createHandler(serviceKey: string, dispatch: Dispatch) {
  return async (request: Request): Promise<Response> => {
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
    try {
      const input = await readBody(request);
      if (
        input.organizationId !== "mirea" ||
        input.slug !== "student-discounts" || !uuid(input.userId)
      ) return json({ error: "Invalid proxy context" }, 403);
      const userId = string(input.userId),
        route = parseRoute(input.path),
        body = object(input.body);
      if ((input.kind ?? "screen") === "screen") {
        const state = await dispatch(userId, "state", {
          id: route.id,
          saved: route.path === "/favorites",
        });
        if (
          ["/moderation", "/review"].includes(route.path) &&
          state.isModerator === true
        ) state.queue = await dispatch(userId, "moderation_queue");
        return json(buildScreen(route.path, state, { id: route.id }));
      }
      if (input.kind !== "api") {
        throw new InputError("Invalid request kind", 400);
      }
      if (string(input.method).toUpperCase() !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      if (route.path === "/api/search") {
        const offset = Number(body.offset ?? 0);
        if (!Number.isInteger(offset) || offset < 0 || offset > 100000) {
          throw new InputError();
        }
        const filters = {
          q: textInput(body.q, 0, 100),
          category: textInput(body.category || "all", 0, 30),
          region: textInput(body.region || "all", 0, 30),
          online: body.online === true,
          free: body.free === true,
          saved: body.saved === true,
          show_expired: body.show_expired === true,
          offset,
        };
        const state = await dispatch(userId, "state", filters);
        const items = filterOffers(list(state.offers), body).map((o) =>
          presentOffer(o)
        );
        return json({
          items,
          count: typeof state.total === "number" ? state.total : items.length,
          offset,
        });
      }
      if (route.path === "/api/favorite") {
        if (typeof body.saved !== "boolean") throw new InputError();
        await dispatch(userId, "favorite", {
          id: textInput(body.id, 3, 80),
          saved: body.saved,
        });
      } else if (route.path === "/api/suggest") {
        if (body.id && !uuid(body.id)) throw new InputError();
        const content = suggestionPayload(body);
        await dispatch(userId, "suggest", { id: body.id || null, content });
      } else if (route.path === "/api/withdraw") {
        if (!uuid(body.id)) throw new InputError();
        await dispatch(userId, "withdraw", { id: body.id });
      } else if (route.path === "/api/report") {
        if (
          !["expired", "rejected", "conditions", "link", "other"].includes(
            string(body.reason),
          )
        ) throw new InputError();
        await dispatch(userId, "report", {
          id: textInput(body.id, 3, 80),
          reason: body.reason,
          details: textInput(body.details, 0, 800),
        });
      } else if (route.path === "/api/moderate") {
        if (
          !uuid(body.id) ||
          !["approve", "reject", "dismiss_report", "pause_offer"].includes(
            string(body.decision),
          )
        ) throw new InputError();
        const expectedUpdatedAt =
          ["approve", "reject"].includes(string(body.decision))
            ? textInput(body.expected_updated_at, 20, 40)
            : null;
        if (
          expectedUpdatedAt && !Number.isFinite(Date.parse(expectedUpdatedAt))
        ) throw new InputError();
        await dispatch(userId, "moderate", {
          id: body.id,
          decision: body.decision,
          note: textInput(body.note, 3, 500),
          expected_updated_at: expectedUpdatedAt,
        });
      } else throw new InputError("Страница не найдена", 404);
      return json({ ok: true });
    } catch (error) {
      if (error instanceof InputError) {
        return json({ error: error.message }, error.status);
      }
      const code = string(object(error).code);
      if (code === "42501") return json({ error: "Действие недоступно" }, 403);
      if (code === "P0002") {
        return json({ error: "Запись уже недоступна" }, 404);
      }
      if (code === "P0001") {
        return json({ error: "Лимит на сегодня исчерпан" }, 429);
      }
      if (code === "40001") {
        return json({
          error: "Предложение изменилось. Откройте его заново перед проверкой.",
        }, 409);
      }
      if (["22023", "23514", "22007", "22P02"].includes(code)) {
        return json({ error: "Проверьте заполненные поля" }, 422);
      }
      return json(
        { error: "Сервис временно недоступен. Попробуйте ещё раз." },
        500,
      );
    }
  };
}
