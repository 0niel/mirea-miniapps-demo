import { buildScreen } from "./screens.ts";
import type { Json } from "./domain.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("Assertion failed");
};
function nodes(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value as Json, ...Object.values(value).flatMap(nodes)];
}
const offer = {
  id: "museum-offer",
  provider: "Музей",
  title: "Студенческий день",
  benefit: "Бесплатный вход",
  description: "Коллекция музея",
  eligibility: "Студенческий билет",
  geography: "Москва",
  category: "culture",
  region: "moscow",
  source_url: "https://museum.ru/conditions",
  redeem_url: "https://museum.ru/tickets",
  verified_at: "2026-09-06T00:00:00Z",
  source_status: "checked",
  steps: ["Показать студенческий"],
  validity_note: "По воскресеньям",
  saved: true,
};

Deno.test("catalog exposes filters results empty state and native busy handling", () => {
  const all = nodes(buildScreen("/", { offers: [offer] }));
  for (
    const type of [
      "appForEach",
      "appIf",
      "appErrorState",
      "appInputField",
      "appSelectField",
      "wrap",
    ]
  ) assert(all.some((n) => n.type === type));
  assert(
    all.some((n) =>
      n.actionType === "fetch" && n.path === "/api/search" &&
      n.loadingKey === "busy"
    ),
  );
  assert(all.some((n) => n.actionType === "openPage" && n.path === "/suggest"));
});
Deno.test("offer displays evidence and native save share redemption actions", () => {
  const all = nodes(
    buildScreen("/offer", { offers: [offer] }, { id: offer.id }),
  );
  for (const action of ["share", "openUrl", "networkRequest"]) {
    assert(all.some((n) => n.actionType === action));
  }
  assert(all.some((n) => n.data === "Студенческий билет"));
  assert(all.some((n) => n.url === "/api/favorite"));
  assert(JSON.stringify(all).includes("Проверка условий"));
});
Deno.test("expired offers keep source but remove redemption and coupon", () => {
  const all = nodes(
    buildScreen("/offer", {
      offers: [{ ...offer, valid_until: "2020-01-01", coupon: "STUDENT" }],
    }, { id: offer.id }),
  );
  assert(!all.some((n) => n.actionType === "copyToClipboard"));
  assert(
    !all.some((n) => n.actionType === "openUrl" && n.url === offer.redeem_url),
  );
  assert(
    all.some((n) => n.actionType === "openUrl" && n.url === offer.source_url),
  );
});
Deno.test("reminder requires date selection before explicit scheduling", () => {
  const all = nodes(
    buildScreen("/reminder", { offers: [offer] }, { id: offer.id }),
  );
  const picker = all.find((n) => n.actionType === "pickDateTime");
  assert(picker?.saveAs === "when");
  assert(JSON.stringify(picker).includes("scheduleReminder") === false);
  assert(
    all.some((n) =>
      n.actionType === "scheduleReminder" && n.when === "{{state.when}}"
    ),
  );
  assert(
    all.some((n) =>
      n.type === "appIf" && String(n.condition).includes("state.when")
    ),
  );
});
Deno.test("suggestions use validated native form and no file collection", () => {
  const all = nodes(buildScreen("/suggest", {}));
  assert(all.some((n) => n.actionType === "validateForm"));
  assert(all.some((n) => n.url === "/api/suggest"));
  assert(
    !all.some((n) =>
      ["pickImage", "pickFile", "readClipboard", "getLocation"].includes(
        String(n.actionType),
      )
    ),
  );
  assert(all.some((n) => n.id === "source_url" && n.required === true));
});
Deno.test("untrusted offer text cannot become reactive template", () => {
  const screen = JSON.stringify(
    buildScreen("/offer", {
      offers: [{
        ...offer,
        title: "{{state.secret}}",
        description: "{{storage.token}}",
      }],
    }, { id: offer.id }),
  );
  assert(!screen.includes("{{state.secret}}"));
  assert(!screen.includes("{{storage.token}}"));
});
Deno.test("ordinary users never receive moderation controls", () => {
  for (const path of ["/moderation", "/review"]) {
    const screen = JSON.stringify(
      buildScreen(path, {
        isModerator: false,
        queue: { suggestions: [{ id: "fake", content: offer }] },
      }),
    );
    assert(!screen.includes("/api/moderate"));
  }
});
