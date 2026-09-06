export type Json = Record<string, unknown>;
export const categories: Record<string, { label: string; emoji: string }> = {
  software: { label: "Софт", emoji: "💻" },
  design: { label: "Дизайн", emoji: "🎨" },
  learning: { label: "Курсы", emoji: "📚" },
  culture: { label: "Культура", emoji: "🏛️" },
  transport: { label: "Транспорт", emoji: "🚆" },
  food: { label: "Еда", emoji: "🥐" },
  shopping: { label: "Покупки", emoji: "🛍️" },
  sport: { label: "Спорт", emoji: "🏃" },
};
export const regions: Record<string, string> = {
  moscow: "Москва",
  russia: "Россия",
  international: "Международные",
  "saint-petersburg": "Петербург",
};
export class InputError extends Error {
  constructor(message = "Проверьте заполненные поля", public status = 422) {
    super(message);
  }
}
export const object = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
export const list = (v: unknown): Json[] =>
  Array.isArray(v) ? v.map(object) : [];
export const string = (v: unknown): string => typeof v === "string" ? v : "";
export const safeText = (v: unknown): string =>
  string(v).replace(/\{\{/g, "｛｛").replace(/\}\}/g, "｝｝");
export const uuid = (v: unknown): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(string(v));
export function textInput(v: unknown, min: number, max: number): string {
  const s = string(v).trim();
  if (
    s.length < min || s.length > max ||
    /\{\{|\}\}/.test(s) ||
    [...s].some((c) =>
      c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0))
    )
  ) throw new InputError();
  return s;
}
export function httpsUrl(v: unknown): string {
  const s = textInput(v, 10, 1500);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new InputError("Нужна полная HTTPS-ссылка");
  }
  if (
    u.protocol !== "https:" || u.username || u.password || u.port ||
    /[\\{}\s]/.test(s) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(u.hostname) ||
    /(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname)
  ) throw new InputError("Нужна публичная HTTPS-ссылка");
  return u.href;
}
export function dateInput(v: unknown): string | null {
  if (!v) return null;
  const s = string(v);
  const time = Date.parse(s);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== s
  ) throw new InputError("Дата должна быть в формате ГГГГ-ММ-ДД");
  return s;
}
export function suggestionPayload(body: Json): Json {
  const category = string(body.category);
  const region = string(body.region);
  if (!Object.hasOwn(categories, category) || !Object.hasOwn(regions, region)) {
    throw new InputError();
  }
  const source = httpsUrl(body.source_url);
  return {
    title: textInput(body.title, 4, 100),
    provider: textInput(body.provider, 2, 80),
    benefit: textInput(body.benefit, 3, 100),
    description: textInput(body.description, 10, 1000),
    eligibility: textInput(body.eligibility, 5, 1000),
    geography: textInput(body.geography, 2, 200),
    category,
    region,
    online: body.online === true,
    source_url: source,
    redeem_url: body.redeem_url ? httpsUrl(body.redeem_url) : source,
    steps: [textInput(body.instructions, 5, 800)],
    valid_until: dateInput(body.valid_until),
    validity_note: textInput(
      body.validity_note || "Дата окончания не указана организатором.",
      3,
      300,
    ),
    coupon: textInput(body.coupon, 0, 80),
  };
}
export function parseRoute(raw: unknown): { path: string; id: string } {
  const s = string(raw) || "/";
  if (
    !s.startsWith("/") || s.startsWith("//") || /[\\\r\n{}]/.test(s) ||
    s.length > 1000 || /(?:^|\/)\.{1,2}(?:\/|\?|$)/.test(s)
  ) throw new InputError("Страница не найдена", 404);
  const url = new URL(s, "https://miniapp.invalid");
  return { path: url.pathname, id: url.searchParams.get("id") ?? "" };
}
export function offerState(
  offer: Json,
  now = new Date(),
): { label: string; tone: string; usable: boolean } {
  if (offer.status === "paused") {
    return { label: "Скрыто после проверки", tone: "warning", usable: false };
  }
  if (
    offer.valid_until &&
    string(offer.valid_until) <
      now.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" })
  ) return { label: "Срок завершился", tone: "muted", usable: false };
  if (offer.source_status === "changed") {
    return { label: "Условия изменились", tone: "warning", usable: true };
  }
  const verified = Date.parse(string(offer.verified_at));
  if (
    offer.source_status === "unavailable" || !Number.isFinite(verified) ||
    now.getTime() - verified > 30 * 86400000
  ) return { label: "Нужна перепроверка", tone: "warning", usable: true };
  return { label: "Источник проверен", tone: "success", usable: true };
}
export function filterOffers(
  offers: Json[],
  filter: Json,
  now = new Date(),
): Json[] {
  const q = string(filter.q).trim().toLocaleLowerCase("ru").slice(0, 100);
  return offers.filter((o) =>
    (!q ||
      [o.title, o.provider, o.description, o.benefit].some((v) =>
        string(v).toLocaleLowerCase("ru").includes(q)
      )) &&
    (!filter.category || filter.category === "all" ||
      o.category === filter.category) &&
    (!filter.region || filter.region === "all" || o.region === filter.region) &&
    (filter.online !== true || o.online === true) &&
    (filter.free !== true || /бесплат/i.test(string(o.benefit))) &&
    (filter.saved !== true || o.saved === true) &&
    (filter.show_expired === true || offerState(o, now).usable)
  );
}
export function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return b.length >= 20 && difference === 0;
}
