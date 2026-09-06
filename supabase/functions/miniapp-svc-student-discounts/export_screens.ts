import { buildScreen } from "./screens.ts";
import { type Json, list } from "./domain.ts";
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
const states: Record<string, [string, Json, Json?]> = {
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
};
const output = new URL("artifacts/screens/discounts/", root);
await Deno.mkdir(output, { recursive: true });
for (const [name, [path, state, extra]] of Object.entries(states)) {
  await Deno.writeTextFile(
    new URL(`${name}.json`, output),
    JSON.stringify(buildScreen(path, state, extra), null, 2) + "\n",
  );
}
console.log(`Exported ${Object.keys(states).length} screens`);
