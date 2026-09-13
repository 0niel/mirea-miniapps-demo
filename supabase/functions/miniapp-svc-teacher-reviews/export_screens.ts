import { buildScreen } from "./screens.ts";
import { type Json, object, presentTeacher } from "./domain.ts";
import * as fx from "./fixtures.ts";

const root = new URL("../../../", import.meta.url);
const listing = (items: Json[]): Json => ({
  count: items.length,
  offset: 0,
  items: items.map(presentTeacher),
});
const states: Record<string, [string, Json, Json?, Json?]> = {
  "reviews-home": ["/", fx.home],
  "reviews-home-newcomer": ["/", {
    ...fx.home,
    me: fx.newcomer,
    today: [],
    recommend: [],
    top: [],
    recent: [],
  }],
  "reviews-home-search": ["/", fx.home, {}, {
    searching: true,
    filtersOpen: true,
    q: "Соколова",
    listing: listing([fx.teacher, fx.other]),
  }],
  "reviews-home-search-empty": ["/", fx.home, {}, {
    searching: true,
    q: "Нет такого",
    listing: listing([]),
  }],
  "reviews-teacher": ["/teacher", fx.teacherState, { id: fx.teacherId }],
  "reviews-teacher-fresh": ["/teacher", {
    me: fx.me,
    teacher: { ...fx.third, reviews_list: [], similar: [], eligible: 40 },
  }, { id: fx.thirdId }],
  "reviews-teacher-missing": ["/teacher", { me: fx.me, teacher: null }, {
    id: fx.teacherId,
  }],
  "reviews-review": ["/review", fx.teacherState, { id: fx.teacherId }],
  "reviews-review-blank": ["/review", {
    me: fx.me,
    teacher: { ...fx.third, my_review: null },
  }, { id: fx.thirdId }],
  "reviews-review-tips": [
    "/review",
    {
      me: fx.me,
      teacher: { ...fx.third, my_review: null },
    },
    { id: fx.thirdId },
    { tipsOpen: true, clarity: 4 },
  ],
  "reviews-top": ["/top", fx.topState],
  "reviews-top-students": ["/top", fx.topState, {}, { tab: 1 }],
  "reviews-top-empty": ["/top", {
    ...fx.topState,
    board: { board: "overall", scope: "all", count: 0, items: [] },
    students: [],
  }],
  "reviews-me": ["/me", fx.meState],
  "reviews-me-newcomer": ["/me", {
    me: fx.newcomer,
    my_reviews: [],
    followed: [],
  }],
  "reviews-recommend": ["/recommend", fx.recommendState],
  "reviews-recommend-no-group": ["/recommend", {
    me: fx.newcomer,
    recommend: [],
    reviewed: [],
  }],
};
const output = new URL("artifacts/screens/teacher-reviews/", root);
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
