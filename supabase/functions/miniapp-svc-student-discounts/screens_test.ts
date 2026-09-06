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
      "appSearchField",
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
Deno.test("catalog puts native search first and makes the whole offer card actionable", () => {
  const screen = buildScreen("/", { offers: [offer] });
  const all = nodes(screen);
  assert(!JSON.stringify(screen).includes("Чуть выгоднее"));
  assert(!all.some((n) => n.type === "appProgressBar"));
  assert(
    all.some((n) =>
      n.type === "appCard" &&
      String((n.onTap as Json)?.path).includes("/offer?id=")
    ),
  );
  assert(
    all.some((n) =>
      n.type === "singleChildScrollView" && n.scrollDirection === "horizontal"
    ),
  );
});
Deno.test("verified curated logos render with bounded fit and unknown offers keep a fallback", () => {
  const curated = nodes(
    buildScreen("/offer", { offers: [{ ...offer, id: "github-pro" }] }, {
      id: "github-pro",
    }),
  );
  const logo = curated.find((n) => n.type === "appImage");
  assert(
    logo?.fit === "contain" && logo.enablePreview === false &&
      Number(logo.width) <= 64,
  );
  assert(String(logo?.src).includes("/discounts/media/github-pro-"));
  const unknown = nodes(
    buildScreen("/offer", { offers: [offer] }, { id: offer.id }),
  );
  assert(!unknown.some((n) => n.type === "appImage"));
  assert(unknown.some((n) => n.type === "appIconTile" && n.emoji));
});
Deno.test("suggestion steps validate before advancing and keep optional fields separate", () => {
  const all = nodes(buildScreen("/suggest", {}));
  const next = all.filter((n) => n.type === "appButton" && n.label === "Далее");
  assert(next.length === 2);
  assert(
    next.every((n) => (n.onPressed as Json).actionType === "validateForm"),
  );
  assert(
    all.some((n) => n.type === "appIf" && n.condition === "state.extraOpen"),
  );
  assert(all.some((n) => n.id === "source_url" && n.required === true));
  assert(
    all.some((n) =>
      n.label === "Назад" && (n.onPressed as Json).actionType === "setState"
    ),
  );
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
