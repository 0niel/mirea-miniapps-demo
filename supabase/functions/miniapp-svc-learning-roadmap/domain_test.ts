import {
  chosenIds,
  comparePlans,
  constantTimeEqual,
  literal,
  parseRoute,
  planOf,
  relatedSubjects,
  sourceUrl,
  workloadOf,
} from "./domain.ts";
import {
  otherPlan,
  parserPlanSample,
  sampleData,
  samplePlan,
} from "./fixtures.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("public and personal text cannot become expressions", () => {
  assert(!literal("{{state.secret}}\u0000").includes("{{"));
  const plan = planOf({
    ...samplePlan,
    title: "{{storage.token}}",
    disciplines: [{ ...samplePlan.disciplines[0], name: "{{user.name}}" }],
  });
  assert(
    plan && !plan.title.includes("{{") &&
      !plan.disciplines[0].name.includes("{{"),
  );
});
Deno.test("sources are official HTTPS URLs without credentials", () => {
  assert(sourceUrl("https://www.mirea.ru/a.pdf") !== "");
  for (
    const value of [
      "https://mirea.ru.evil.com/a",
      "http://mirea.ru/a",
      "https://evil.com",
      "javascript:alert(1)",
      "https://user:pass@mirea.ru/a",
    ]
  ) assert(sourceUrl(value) === "", value);
});
Deno.test("constant-time comparison rejects empty and unequal keys", () => {
  assert(!constantTimeEqual("", ""));
  assert(!constantTimeEqual("key", "ke"));
  assert(!constantTimeEqual("foo", "bar"));
  assert(constTime("actual-key"));
});
function constTime(key: string): boolean {
  return constantTimeEqual(key, key);
}
Deno.test("comparison matches names instead of reused source codes and retains unknown values", () => {
  const rows = comparePlans(samplePlan, otherPlan);
  assert(
    rows.find((x) => x.name === "Математический анализ")?.status === "changed",
  );
  assert(
    rows.find((x) => x.name === "Основы программирования")?.status === "same",
  );
  assert(
    rows.find((x) => x.name === "Компьютерные сети")?.status === "only_right",
  );
  const changed = comparePlans(samplePlan, {
    ...samplePlan,
    disciplines: samplePlan.disciplines.map((d) => ({
      ...d,
      hours: d.hours === null ? 0 : d.hours,
    })),
  });
  assert(
    changed.find((x) => x.name === "Проектная практика")?.status === "changed",
  );
});
Deno.test("workload counts one alternative per semester and only selected facultatives", () => {
  const chosen = chosenIds(samplePlan, sampleData.records);
  const rows = samplePlan.disciplines.filter((d) => d.semester === 2);
  const load = workloadOf(rows, chosen);
  assert(load.subjects === 1 && load.groups === 1 && load.undecided === 0);
  assert(
    load.hours.min === 72 && load.hours.max === 72 && load.credits.min === 0,
  );
  const empty = workloadOf(rows, new Set());
  assert(
    empty.subjects === 1 && empty.undecided === 1 && empty.hours.min === 72,
  );
  const selected = workloadOf(rows, new Set(["optional-2", "sport-b-2"]));
  assert(
    selected.subjects === 2 && selected.optional === 1 &&
      selected.hours.min === 108 && selected.credits.min === 1,
  );
  const stale = chosenIds(samplePlan, [{
    discipline_id: "deleted",
    chosen: true,
  }, { discipline_id: "math-1", chosen: true }]);
  assert(stale.size === 0);
});
Deno.test("unknown alternatives preserve ranges and multi-semester groups never collapse into one", () => {
  const rows = samplePlan.disciplines.filter((d) => d.choice_group);
  const load = workloadOf(rows, new Set());
  assert(load.subjects === 2 && load.groups === 2 && load.undecided === 2);
  assert(load.hours.min === 144 && load.hours.max === 180);
  const selected = workloadOf(rows, new Set(["sport-a-2", "sport-b-3"]));
  assert(selected.hours.min === 180 && selected.hours.max === 180);
  const unknown = workloadOf(
    rows.map((d) => d.id === "sport-b-3" ? { ...d, hours: null } : d),
    new Set(),
  );
  assert(unknown.hours.min === null && unknown.hours.max === null);
  const related = relatedSubjects(samplePlan, samplePlan.disciplines[2]);
  assert(
    related.length === 2 && related.every((d) => d.subject_id === "sport-a"),
  );
});
Deno.test("facultative choice groups stay outside load until exactly one is selected", () => {
  const rows = samplePlan.disciplines.filter((d) =>
    d.semester === 2 && d.choice_group
  ).map((d) => ({ ...d, is_optional: true, kind: "elective" }));
  assert(workloadOf(rows, new Set()).subjects === 0);
  const load = workloadOf(rows, new Set(rows.map((d) => d.id)));
  assert(load.subjects === 1 && load.optional === 1 && load.hours.min === 72);
});
Deno.test("routes retain query and prefer actual path over duplicate query fields", () => {
  const r = parseRoute("/plan?id=one", {
    id: "two",
    semester: "2",
    userId: { malicious: true },
  });
  assert(
    r.path === "/plan" && r.params.id === "one" && r.params.semester === "2" &&
      !("userId" in r.params),
  );
});
Deno.test("real parser control enums and mandatory sports alternatives retain their semantics", () => {
  const plan = planOf(parserPlanSample);
  assert(plan !== null);
  assert(plan.disciplines[0].control_forms[0] === "Экзамен");
  assert(plan.disciplines[1].control_forms[0] === "Зачёт");
  assert(plan.disciplines[1].is_optional === false);
  const load = workloadOf(plan.disciplines, new Set());
  assert(load.subjects === 2 && load.undecided === 1 && load.hours.min === 216);
});
Deno.test("parser retained-source metadata becomes visible stale provenance", () => {
  const plan = planOf({
    ...parserPlanSample,
    source_stale: true,
    last_attempt_at: "2026-09-06T10:00:00Z",
    warnings: ["last_good_parse_retained"],
  });
  assert(plan !== null && plan.stale === true);
  assert(plan.last_check_at === "2026-09-06T10:00:00Z");
  assert(plan.warnings[0].includes("Сохранён предыдущий разбор"));
});
