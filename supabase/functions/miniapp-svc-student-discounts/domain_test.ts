import {
  constantTimeEqual,
  dateInput,
  filterOffers,
  httpsUrl,
  offerState,
  parseRoute,
  safeText,
  suggestionPayload,
} from "./domain.ts";
const assert = (v: unknown, message = "Assertion failed") => {
  if (!v) throw new Error(message);
};
const throws = (f: () => unknown) => {
  let thrown = false;
  try {
    f();
  } catch {
    thrown = true;
  }
  assert(thrown);
};

Deno.test("public HTTPS and template validation", () => {
  assert(
    httpsUrl("https://museum.ru/students") === "https://museum.ru/students",
  );
  for (
    const value of [
      "http://museum.ru",
      "https://user:pass@museum.ru",
      "https://127.0.0.1/",
      "https://localhost/",
      "https://museum.local/",
      "https://museum.ru:444/",
      "https://museum.ru/{{state.secret}}",
      "https://museum.ru\\@evil.ru",
    ]
  ) throws(() => httpsUrl(value));
  assert(!safeText("{{state.secret}}").includes("{{"));
});
Deno.test("date boundaries reject nonexistent days", () => {
  assert(dateInput("") === null);
  assert(dateInput("2028-02-29") === "2028-02-29");
  for (const date of ["2026-02-29", "2026-13-01", "tomorrow"]) {
    throws(() => dateInput(date));
  }
});
Deno.test("offer expiration inclusive and evidence stale states", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  assert(
    offerState({
      valid_until: "2026-09-06",
      verified_at: "2026-09-05",
      source_status: "checked",
    }, now).usable,
  );
  assert(!offerState({ valid_until: "2026-09-05" }, now).usable);
  assert(
    offerState({ source_status: "changed" }, now).label ===
      "Условия изменились",
  );
  assert(
    offerState({ verified_at: "2026-06-01" }, now).label ===
      "Нужна перепроверка",
  );
  assert(!offerState({ status: "paused" }, now).usable);
});
Deno.test("filters combine Cyrillic search category geography saved and expiry", () => {
  const offers = [{
    id: "a",
    title: "Музей Гараж",
    benefit: "Бесплатный вход",
    category: "culture",
    region: "moscow",
    saved: true,
  }, {
    id: "b",
    title: "Музей",
    benefit: "Скидка",
    category: "culture",
    region: "moscow",
    valid_until: "2020-01-01",
  }, {
    id: "c",
    title: "IDE",
    category: "software",
    region: "international",
    online: true,
  }];
  assert(
    filterOffers(offers, {
      q: "ГАРАЖ",
      category: "culture",
      region: "moscow",
      free: true,
      saved: true,
    }).length === 1,
  );
  assert(filterOffers(offers, { category: "culture" }).length === 1);
  assert(
    filterOffers(offers, { category: "culture", show_expired: true }).length ===
      2,
  );
  assert(filterOffers(offers, { online: true }).length === 1);
});
Deno.test("route validation and constant-time token comparison fail closed", () => {
  for (
    const route of [
      "https://evil.ru",
      "//evil.ru",
      "/../api",
      "/\\evil",
      "/{{state.token}}",
    ]
  ) throws(() => parseRoute(route));
  assert(parseRoute("/offer?id=github-pro").id === "github-pro");
  assert(!constantTimeEqual("", ""));
  assert(!constantTimeEqual("a".repeat(25), "a".repeat(24)));
  assert(constantTimeEqual("abc".repeat(20), "abc".repeat(20)));
});
Deno.test("suggestions have fixed schema and reject forged classification", () => {
  const input = {
    title: "Студенческая скидка",
    provider: "Музей",
    benefit: "Скидка 10%",
    description: "Описание предложения",
    eligibility: "По студенческому билету",
    geography: "Москва",
    category: "culture",
    region: "moscow",
    source_url: "https://museum.ru/students",
    instructions: "Предъявить билет в кассе",
    online: false,
    isModerator: true,
    status: "approved",
  };
  const result = suggestionPayload(input);
  assert(!("isModerator" in result));
  assert(!("status" in result));
  throws(() => suggestionPayload({ ...input, category: "__proto__" }));
  throws(() => suggestionPayload({ ...input, title: "{{state.token}}" }));
});
