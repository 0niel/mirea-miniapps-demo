import {
  boardValue,
  constantTimeEqual,
  count,
  formatRating,
  InputError,
  nextMilestone,
  parseRoute,
  plural,
  presentReview,
  presentTeacher,
  ratingInput,
  ratingTone,
  safeText,
  shortName,
  stars,
  textInput,
} from "./domain.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("Assertion failed");
};
const throws = (fn: () => unknown, status?: number) => {
  try {
    fn();
  } catch (error) {
    assert(error instanceof InputError);
    if (status) assert((error as InputError).status === status);
    return;
  }
  throw new Error("Expected InputError");
};

Deno.test("routes keep only uuid ids and reject traversal", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert(parseRoute(`/teacher?id=${id.toUpperCase()}`).id === id);
  assert(parseRoute("/teacher?id=not-a-uuid").id === "");
  assert(parseRoute(undefined).path === "/");
  throws(() => parseRoute("/../secret"), 404);
  throws(() => parseRoute("//evil"), 404);
  throws(() => parseRoute("/teacher?id={{state.x}}"), 404);
});
Deno.test("text and rating inputs are bounded and template safe", () => {
  assert(textInput("  Хороший препод  ", 0, 100) === "Хороший препод");
  throws(() => textInput("{{state.secret}}", 0, 100));
  throws(() => textInput("x".repeat(2001), 0, 2000));
  throws(() => textInput("bad", 0, 100));
  assert(ratingInput(5) === 5);
  assert(ratingInput("3") === 3);
  throws(() => ratingInput(0));
  throws(() => ratingInput(6));
  throws(() => ratingInput(2.5));
  assert(safeText("{{state.x}}") === "｛｛state.x｝｝");
});
Deno.test("russian plural forms and formatting helpers", () => {
  assert(plural(1, ["отзыв", "отзыва", "отзывов"]) === "отзыв");
  assert(plural(3, ["отзыв", "отзыва", "отзывов"]) === "отзыва");
  assert(plural(11, ["отзыв", "отзыва", "отзывов"]) === "отзывов");
  assert(plural(22, ["отзыв", "отзыва", "отзывов"]) === "отзыва");
  assert(count(5, ["день", "дня", "дней"]) === "5 дней");
  assert(shortName("Иванов Иван Иванович") === "Иванов И. И.");
  assert(shortName("Иванов") === "Иванов");
  assert(formatRating(4.66) === "4,7");
  assert(formatRating(null) === "—");
  assert(stars(4) === "★★★★☆");
  assert(ratingTone(4.8) === "live");
  assert(ratingTone(2.1) === "danger");
  assert(ratingTone(null) === "mute");
  assert(nextMilestone(0) === 7);
  assert(nextMilestone(7) === 14);
  assert(nextMilestone(400) === 500);
});
Deno.test("teacher presenter builds labels and escapes templates", () => {
  const card = presentTeacher({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Иванов {{state.x}} Иванович",
    reviews: 3,
    rating: 4.5,
    rank: 2,
    top_days: 4,
    recent: 1,
    disciplines: ["Математика", "{{state.y}}"],
    mine: true,
    today: true,
    time: "10:40:00",
  });
  assert(!JSON.stringify(card).includes("{{"));
  assert(card.rating_label === "4,5");
  assert(card.rating_tone === "live");
  assert(card.reviews_label === "3 отзыва");
  assert(card.rank_label === "#2");
  assert(card.medal === "🥈");
  assert(card.streak_label === "🔥 4 дня в топ-10");
  assert(card.reason_label === "Сегодня в 10:40");
  assert(card.mine === true);
  const fresh = presentTeacher({
    name: "Петров Пётр",
    reviews: 0,
    occurrences: 5,
  });
  assert(fresh.rating_label === "—");
  assert(fresh.reviews_label === "Нет отзывов");
  assert(fresh.reason_label === "Отзывов ещё нет — станьте первым");
  assert(
    presentTeacher({ name: "Сидоров", reviews: 2, occurrences: 5 })
      .reason_label === "5 пар у вас в семестре",
  );
  assert(boardValue("discussed", { reviews: 7 }) === "7 отзывов");
  assert(boardValue("rising", { recent: 2 }) === "+2");
  assert(boardValue("clarity", { reviews: 2, clarity: 4.25 }) === "4,3");
  assert(boardValue("overall", { reviews: 0 }) === "—");
});
Deno.test("review presenter trims excerpts and keeps vote state", () => {
  const review = presentReview({
    id: "r1",
    teacher: "Иванов Иван Иванович",
    author: "Тестов Т.",
    body: "а".repeat(200) + "{{state.x}}",
    rating: 4.3,
    clarity: 5,
    loyalty: 4,
    usefulness: 4,
    helpful: 2,
    voted: true,
    created_at: "2026-09-12T10:00:00Z",
  });
  assert(String(review.excerpt).length <= 180);
  assert(String(review.excerpt).endsWith("…"));
  assert(!String(review.body).includes("{{"));
  assert(review.helpful_label === "Полезно · 2");
  assert(review.voted === true);
  assert(review.teacher_short === "Иванов И. И.");
  assert(review.stars_clarity === "★★★★★");
  assert(String(review.date_label).startsWith("12"));
  assert(presentReview({ helpful: 0 }).helpful_label === "Полезно");
});
Deno.test("service key comparison requires a long exact match", () => {
  assert(constantTimeEqual("a".repeat(24), "a".repeat(24)));
  assert(!constantTimeEqual("a".repeat(24), "a".repeat(23) + "b"));
  assert(!constantTimeEqual("short", "short"));
});
