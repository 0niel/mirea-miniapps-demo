export type ProxyRequest = {
  organizationId?: string;
  slug?: string;
  kind?: string;
  path?: string;
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  userId?: string;
};

export type JsonObject = Record<string, unknown>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function objectOf(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function stringOf(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function userTextOf(value: unknown, max = 500): string {
  const withoutControls = [...stringOf(value, max)].map((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  return withoutControls
    .replaceAll("{{", "‹‹")
    .replaceAll("}}", "››")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function booleanOf(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function profilePayload(value: unknown): JsonObject {
  const body = objectOf(value);
  const interests = stringOf(body.interests, 280)
    .split(/[,;\n]/)
    .map((item) => userTextOf(item, 30))
    .filter(Boolean)
    .slice(0, 8);
  return {
    displayName: userTextOf(body.displayName, 40),
    age: Number.parseInt(stringOf(body.age, 3), 10),
    gender: stringOf(body.gender, 16),
    lookingFor: stringOf(body.lookingFor, 16),
    intent: stringOf(body.intent, 24),
    bio: userTextOf(body.bio, 500),
    interests,
    avatarEmoji: stringOf(body.avatarEmoji, 8),
  };
}

export function extractTemporaryUpload(
  rawUrl: unknown,
  supabaseUrl: string,
  userId: string,
  expectedPrefix = userId,
): string | null {
  if (typeof rawUrl !== "string") return null;
  try {
    const value = new URL(rawUrl);
    const expected = new URL(supabaseUrl);
    if (value.origin !== expected.origin || value.search || value.hash) {
      return null;
    }
    const prefix = "/storage/v1/object/public/mini-app-uploads/";
    if (!value.pathname.startsWith(prefix)) return null;
    const path = decodeURIComponent(value.pathname.slice(prefix.length));
    if (
      (expectedPrefix !== userId && !expectedPrefix.startsWith(`${userId}/`)) ||
      !path.startsWith(`${expectedPrefix}/`) || path.includes("..")
    ) return null;
    return path;
  } catch {
    return null;
  }
}

export function publicError(
  message: string,
  code = "",
): { status: number; message: string } {
  const lower = message.toLowerCase();
  if (code === "40001" || lower.includes("changed, refresh")) {
    return {
      status: 409,
      message: "Данные изменились. Обнови экран и повтори",
    };
  }
  if (lower.includes("blocked") || lower.includes("moderator access")) {
    return { status: 403, message: "Действие недоступно" };
  }
  if (lower.includes("adult confirmation")) {
    return { status: 403, message: "Сначала подтверди, что тебе уже есть 18" };
  }
  if (
    lower.includes("profile required") || lower.includes("not active")
  ) {
    return { status: 403, message: "Сначала заверши настройку профиля" };
  }
  if (code === "42501") {
    return { status: 403, message: "Действие недоступно" };
  }
  if (
    lower.includes("daily decision limit") ||
    lower.includes("daily photo limit")
  ) {
    return { status: 429, message: "Лимит на сегодня исчерпан" };
  }
  if (
    lower.includes("invalid") || lower.includes("required") ||
    lower.includes("candidate is unavailable")
  ) {
    return { status: 422, message: "Проверь данные и попробуй ещё раз" };
  }
  return { status: 500, message: "Не получилось. Попробуй чуть позже" };
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
