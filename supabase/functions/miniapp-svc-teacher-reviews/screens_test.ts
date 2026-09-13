import { buildScreen } from "./screens.ts";
import type { Json } from "./domain.ts";
import * as fx from "./fixtures.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("Assertion failed");
};
function nodes(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value as Json, ...Object.values(value).flatMap(nodes)];
}
const texts = (screen: Json) =>
  nodes(screen).filter((n) => n.type === "appText").map((n) => String(n.data));
const hasText = (screen: Json, needle: string) =>
  JSON.stringify(screen).includes(needle);

Deno.test("home combines search, progress, recommendations, top and feed", () => {
  const screen = buildScreen("/", fx.home);
  const all = nodes(screen);
  for (
    const type of [
      "appSearchField",
      "appForEach",
      "appProgressRing",
      "appSmartChip",
      "appListGroup",
      "appExpandableText",
    ]
  ) assert(all.some((n) => n.type === type));
  assert(
    all.some((n) =>
      n.actionType === "fetch" && n.path === "/api/search" &&
      n.saveAs === "listing"
    ),
  );
  assert(all.some((n) => n.actionType === "openPage" && n.path === "/top"));
  assert(
    all.some((n) => n.actionType === "openPage" && n.path === "/recommend"),
  );
  assert(
    all.some((n) =>
      n.actionType === "openPage" && n.path === `/review?id=${fx.thirdId}`
    ),
  );
  assert(hasText(screen, "Наблюдатель · 60 XP"));
  assert(hasText(screen, "Сегодня у вас"));
  assert(hasText(screen, "Сегодня есть пара"));
  assert(hasText(screen, "12 пар у вас в семестре"));
  assert(!hasText(screen, "Укажите свою группу"));
  assert(all.some((n) => n.type === "appIconTile" && n.emoji === "🥇"));
});
Deno.test("home without group shows the schedule banner and skips group filters", () => {
  const screen = buildScreen("/", {
    ...fx.home,
    me: fx.newcomer,
    today: [],
    recommend: [],
  });
  assert(hasText(screen, "Укажите свою группу"));
  assert(
    nodes(screen).some((n) =>
      n.actionType === "openDeepLink" && n.location === "/schedule"
    ),
  );
  assert(
    !nodes(screen).some((n) =>
      n.type === "appChip" && n.label === "Моя группа"
    ),
  );
  assert(hasText(screen, "Новичок · 0 XP"));
});
Deno.test("teacher profile shows ratings, streak challenge, reviews and actions", () => {
  const screen = buildScreen("/teacher", fx.teacherState, { id: fx.teacherId });
  const all = nodes(screen);
  assert(hasText(screen, "Соколова Анна Владимировна"));
  assert(hasText(screen, "#2 в общем топе"));
  assert(hasText(screen, "В топ-10 уже 12 дней"));
  assert(hasText(screen, "Рекорд — 15 дней"));
  assert(hasText(screen, "Изменить мой отзыв"));
  assert(
    all.some((n) =>
      n.type === "appProgressRing" && n.label === "12" && n.sublabel === "из 14"
    ),
  );
  assert(all.filter((n) => n.type === "appProgressBar").length >= 8);
  assert(
    all.some((n) =>
      n.actionType === "networkRequest" && n.url === "/api/follow"
    ),
  );
  assert(
    all.some((n) => n.actionType === "networkRequest" && n.url === "/api/vote"),
  );
  assert(
    all.some((n) =>
      n.actionType === "share" &&
      String(n.text).includes("teacher-reviews/run?page=")
    ),
  );
  assert(hasText(screen, "Похожие преподаватели"));
  assert(
    texts(screen).some((s) => s === "Ваш отзыв" || s.includes("Ваш отзыв")) ||
      all.some((n) => n.type === "appBadge" && n.label === "Ваш отзыв"),
  );
  assert(!hasText(screen, "{{state.secret"));
});
Deno.test("teacher without rank explains eligibility and missing teacher falls back", () => {
  const fresh = buildScreen("/teacher", {
    me: fx.me,
    teacher: { ...fx.other, reviews_list: [], similar: [], eligible: 40 },
  }, { id: fx.otherId });
  assert(hasText(fresh, "Ещё 1 отзыв до рейтинга"));
  assert(hasText(fresh, "Отзывов пока нет"));
  const outside = buildScreen("/teacher", {
    me: fx.me,
    teacher: {
      ...fx.teacher,
      rank: 24,
      reviews_list: [],
      similar: [],
      eligible: 40,
    },
  }, { id: fx.teacherId });
  assert(hasText(outside, "#24 из 40 в общем топе"));
  const missing = buildScreen("/teacher", { me: fx.me, teacher: null }, {
    id: fx.teacherId,
  });
  assert(hasText(missing, "Преподаватель не найден"));
  assert(
    nodes(missing).some((n) =>
      n.actionType === "reload" && n.target === "root"
    ),
  );
});
Deno.test("review form binds stars to state and guards submission", () => {
  const screen = buildScreen("/review", fx.teacherState, { id: fx.teacherId });
  const all = nodes(screen);
  const scope = all.find((n) => n.type === "appStateScope") as Json;
  const initial = scope.initial as Json;
  assert(
    initial.clarity === 5 && initial.loyalty === 4 && initial.usefulness === 5,
  );
  assert(String(initial.body).startsWith("Объясняет"));
  assert(
    all.filter((n) => n.type === "appLineIcon" && n.icon === "star").length ===
      15,
  );
  assert(
    all.some((n) =>
      n.actionType === "setState" && n.key === "usefulness" && n.value === 3
    ),
  );
  const submit = all.find((n) =>
    n.actionType === "runIf" &&
    String(n.condition).includes("state.clarity > 0")
  ) as Json;
  assert(submit);
  const request = nodes(submit.then).find((n) =>
    n.actionType === "networkRequest"
  ) as Json;
  assert(request.url === "/api/review");
  assert((request.body as Json).id === fx.teacherId);
  assert((request.body as Json).anonymous === "{{state.anonymous}}");
  assert(all.some((n) => n.actionType === "confirm" && n.isDanger === true));
  assert(
    all.some((n) =>
      n.actionType === "networkRequest" && n.url === "/api/review/delete"
    ),
  );
  assert(
    all.some((n) =>
      n.type === "appInputField" && n.maxLength === 2000 && n.multiline === true
    ),
  );
  const blank = buildScreen("/review", {
    me: fx.me,
    teacher: { ...fx.other, my_review: null },
  }, { id: fx.otherId });
  const blankScope = nodes(blank).find((n) =>
    n.type === "appStateScope"
  ) as Json;
  assert((blankScope.initial as Json).clarity === 0);
  assert(hasText(blank, "Опубликовать отзыв"));
  assert(!nodes(blank).some((n) => n.url === "/api/review/delete"));
});
Deno.test("top switches boards through fetch and shows the student race", () => {
  const screen = buildScreen("/top", fx.topState);
  const all = nodes(screen);
  assert(all.some((n) => n.type === "appSegmentedControl"));
  assert(
    all.some((n) =>
      n.actionType === "fetch" && n.path === "/api/top" &&
      n.saveAs === "board_data"
    ),
  );
  assert(
    all.filter((n) =>
      n.type === "appChip" && String(n.selected).startsWith("{{state.board ==")
    ).length === 6,
  );
  assert(
    all.some((n) =>
      n.type === "appChip" && String(n.label).includes("ИКБО-40-26")
    ),
  );
  const scope = all.find((n) => n.type === "appStateScope") as Json;
  const board = (scope.initial as Json).board_data as Json;
  assert((board.items as Json[])[0].value_label === "4,6");
  assert((board.items as Json[])[0].medal === "🥇");
  assert(
    all.some((n) =>
      n.type === "appSwitch" && Array.isArray(n.cases) &&
      (n.cases as Json[]).length === 6
    ),
  );
  assert(hasText(screen, "Вы #4 · 60 XP"));
  assert(hasText(screen, "Ниндзя #A1B2 · это вы"));
  assert(hasText(screen, "140 XP"));
  assert(all.some((n) => n.type === "appToggle" && n.value === false));
  assert(
    all.some((n) =>
      n.actionType === "networkRequest" && n.url === "/api/settings" &&
      (n.body as Json).show_in_leaderboard === true
    ),
  );
});
Deno.test("profile lists quests, achievements, own reviews and follows", () => {
  const screen = buildScreen("/me", fx.meState);
  const all = nodes(screen);
  assert(hasText(screen, "Неделя отзывов"));
  assert(hasText(screen, "Оценено 3 из 8 преподавателей ИКБО-40-26"));
  assert(hasText(screen, "2 дня подряд среди лучших рецензентов"));
  assert(hasText(screen, "Достижения"));
  assert(hasText(screen, "3/10"));
  assert(
    all.some((n) =>
      n.actionType === "openDeepLink" && n.location === "/profile"
    ),
  );
  assert(
    all.filter((n) =>
      n.actionType === "openPage" && String(n.path).startsWith("/review?id=")
    ).length === 2,
  );
  assert(hasText(screen, "Кузнецов Д. О."));
  assert(all.some((n) => n.type === "appListGroup"));
  const empty = buildScreen("/me", {
    me: fx.newcomer,
    my_reviews: [],
    followed: [],
  });
  assert(hasText(empty, "Отзывов ещё нет"));
  assert(hasText(empty, "0/1"));
});
Deno.test("recommendations split today and pending and handle missing group", () => {
  const screen = buildScreen("/recommend", fx.recommendState);
  assert(hasText(screen, "Группа ИКБО-40-26"));
  assert(hasText(screen, "Оценено 3 из 8 преподавателей семестра"));
  assert(hasText(screen, "Сегодня в 12:40"));
  assert(hasText(screen, "Ещё не оценили"));
  assert(hasText(screen, "Уже оценили"));
  assert(
    nodes(screen).filter((n) => n.type === "appButton" && n.label === "Оценить")
      .length === 2,
  );
  const done = buildScreen("/recommend", {
    ...fx.recommendState,
    recommend: [],
  });
  assert(hasText(done, "Все оценены"));
  const noGroup = buildScreen("/recommend", {
    me: fx.newcomer,
    recommend: [],
    reviewed: [],
  });
  assert(hasText(noGroup, "Нужна ваша группа"));
  assert(
    nodes(noGroup).some((n) =>
      n.actionType === "openDeepLink" && n.location === "/schedule"
    ),
  );
});
Deno.test("user content never reaches screens as templates", () => {
  const hostile = "{{state.secret}} <b>x</b>";
  const state = {
    ...fx.teacherState,
    teacher: {
      ...(fx.teacherState.teacher as Json),
      name: hostile,
      disciplines: [hostile],
      reviews_list: [{ ...fx.review, body: hostile, author: hostile }],
      similar: [{ ...fx.other, name: hostile }],
    },
  };
  for (const path of ["/teacher", "/review"]) {
    const screen = buildScreen(path, state, { id: fx.teacherId });
    const dumped = JSON.stringify(screen);
    assert(!dumped.includes("{{state.secret"));
  }
  const homeScreen = buildScreen("/", {
    ...fx.home,
    recent: [{ ...fx.review, body: hostile }],
    today: [{ ...fx.teacher, name: hostile, subject: hostile }],
  });
  assert(!JSON.stringify(homeScreen).includes("{{state.secret"));
  const unknown = buildScreen("/nowhere", {});
  assert(hasText(unknown, "Страница не найдена"));
});
