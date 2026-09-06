import { buildScreen } from "./screens.ts";
import { type Json, list, object } from "./domain.ts";
const root = new URL("../../../", import.meta.url);
const catalog = JSON.parse(
  await Deno.readTextFile(new URL("discounts/data/catalog.json", root)),
);
const offers = list(catalog.offers).map((o, i) => ({ ...o, saved: i < 3 }));
const sample = {
  id: "11111111-1111-4111-8111-111111111111",
  content: {
    ...offers[0],
    title: "Студенческий обед",
    benefit: "Скидка по студенческому",
  },
  status: "pending",
  moderation_note: "",
  updated_at: "2026-09-06T08:00:00Z",
};
const states: Record<string, [string, Json, Json?, Json?]> = {
  "discounts-home": ["/", { offers, isModerator: true }],
  "discounts-empty": ["/", { offers: [] }],
  "discounts-detail": ["/offer", { offers }, { id: String(offers[0].id) }],
  "discounts-expired": ["/offer", {
    offers: [{ ...offers[0], valid_until: "2020-01-01" }],
  }, { id: String(offers[0].id) }],
  "discounts-favorites": ["/favorites", { offers }],
  "discounts-suggest": ["/suggest", {}],
  "discounts-suggestions": ["/suggestions", {
    suggestions: [sample, {
      ...sample,
      id: "22222222-2222-4222-8222-222222222222",
      status: "rejected",
      moderation_note: "Уточните адреса участвующих заведений.",
    }],
  }],
  "discounts-moderation": ["/moderation", {
    isModerator: true,
    queue: { suggestions: [sample], reports: [] },
  }],
  "discounts-review": ["/review", {
    isModerator: true,
    queue: { suggestions: [sample], reports: [] },
  }, { id: sample.id }],
  "discounts-reminder": ["/reminder", { offers }, { id: String(offers[0].id) }],
  "discounts-report": ["/report", { offers }, { id: String(offers[0].id) }],
  "discounts-filters": ["/", { offers }, {}, {
    filtersOpen: true,
    region: "moscow",
    online: true,
  }],
  "discounts-loading": ["/", { offers }, {}, { busy: true }],
  "discounts-error": ["/", { offers }, {}, { loadError: "unavailable" }],
  "discounts-favorites-empty": ["/favorites", { offers: [] }],
  "discounts-suggestions-empty": ["/suggestions", {}],
  "discounts-suggest-step-two": ["/suggest", { suggestions: [sample] }, {
    id: sample.id,
  }, { step: 1 }],
  "discounts-suggest-step-three": ["/suggest", { suggestions: [sample] }, {
    id: sample.id,
  }, { step: 2, extraOpen: false }],
  "discounts-suggest-options": ["/suggest", { suggestions: [sample] }, {
    id: sample.id,
  }, { step: 2, extraOpen: true }],
  "discounts-reminder-selected": ["/reminder", { offers }, {
    id: String(offers[0].id),
  }, { when: "2026-09-07T18:30:00.000", reminderSet: false }],
  "discounts-reminder-success": ["/reminder", { offers }, {
    id: String(offers[0].id),
  }, { when: "2026-09-07T18:30:00.000", reminderSet: true }],
  "discounts-moderation-empty": ["/moderation", {
    isModerator: true,
    queue: { suggestions: [], reports: [] },
  }],
  "discounts-review-report": ["/review", {
    isModerator: true,
    queue: {
      suggestions: [],
      reports: [{
        id: sample.id,
        offer_id: offers[0].id,
        offer_title: offers[0].title,
        reason: "conditions",
        details: "Скидка доступна только при заказе в приложении.",
      }],
    },
  }, { id: sample.id }],
  "discounts-detail-unconfirmed": ["/offer", {
    offers: [{ ...offers[0], verified_at: null, source_status: "unavailable" }],
  }, { id: String(offers[0].id) }],
  "discounts-detail-fallback": ["/offer", {
    offers: [{
      ...offers[0],
      id: "community-test",
      provider: "Студенческое кафе",
    }],
  }, { id: "community-test" }],
};
const output = new URL("artifacts/screens/discounts/", root);
await Deno.mkdir(output, { recursive: true });
for (const [name, [path, state, extra, initial]] of Object.entries(states)) {
  const screen = buildScreen(path, state, extra);
  if (initial) {
    const scope = object(screen.body);
    scope.initial = { ...object(scope.initial), ...initial };
  }
  await Deno.writeTextFile(
    new URL(`${name}.json`, output),
    JSON.stringify(screen, null, 2) + "\n",
  );
}
console.log(`Exported ${Object.keys(states).length} screens`);
