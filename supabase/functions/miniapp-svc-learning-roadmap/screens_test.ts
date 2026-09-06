import { type Json, type Plan } from "./domain.ts";
import {
  catalogData,
  parserPlanSample,
  sampleData,
  samplePlan,
} from "./fixtures.ts";
import { buildScreen, errorScreen } from "./screens.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function nodes(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value as Json, ...Object.values(value).flatMap(nodes)];
}
Deno.test("native screens use bounded paginated content and supported action contracts", () => {
  const screens = [
    buildScreen("/", sampleData),
    buildScreen("/catalog", catalogData),
    ...["/plan", "/semester", "/discipline", "/reminder", "/compare"].map((p) =>
      buildScreen(p, sampleData, { semester: "1", discipline: "math-1" })
    ),
    errorScreen(),
  ];
  const widgets = new Set([
    "appStateScope",
    "scaffold",
    "singleChildScrollView",
    "column",
    "appSectionTitle",
    "appCard",
    "appText",
    "sizedBox",
    "wrap",
    "appTag",
    "appButton",
    "appProgressBar",
    "appInputField",
    "appSelectField",
    "appChip",
    "appIf",
    "appErrorState",
    "appEmptyState",
  ]);
  const actions = new Set([
    "openPage",
    "reload",
    "showToast",
    "networkRequest",
    "multiAction",
    "hapticFeedback",
    "openDeepLink",
    "share",
    "openUrl",
    "pickDateTime",
    "scheduleReminder",
    "addCalendarEvent",
    "setState",
  ]);
  for (const screen of screens) {
    assert(new TextEncoder().encode(JSON.stringify(screen)).length < 512000);
    for (const n of nodes(screen)) {
      if (typeof n.type === "string") assert(widgets.has(n.type), n.type);
      if (typeof n.actionType === "string") {
        assert(actions.has(n.actionType), n.actionType);
      }
      if (n.actionType === "openDeepLink") {
        assert(
          ["/schedule", "/services/knowledge-bank", "/services/deadlines"]
            .includes(String(n.location)),
        );
      }
      if (n.actionType === "addCalendarEvent") {
        assert(n.start === "{{state.studyDate}}" && !("startIso" in n));
      }
      if (n.actionType === "scheduleReminder") {
        assert(n.when === "{{state.studyDate}}" && !("whenIso" in n));
      }
    }
  }
});
Deno.test("2000 subjects remain bounded and elective alternatives never inflate progress", () => {
  const huge: Plan = {
    ...samplePlan,
    disciplines: Array.from(
      { length: 2000 },
      (_, i) => ({
        ...samplePlan.disciplines[0],
        id: `d-${i}`,
        name: `Предмет ${i} ${"Я".repeat(500)}`,
      }),
    ),
  };
  const screen = buildScreen("/semester", { plan: huge, progress: [] }, {
    semester: "1",
  });
  assert(
    nodes(screen).filter((n) => n.label === "Открыть предмет").length === 20,
  );
  assert(new TextEncoder().encode(JSON.stringify(screen)).length < 100000);
});
Deno.test("date picker and scheduling are separate user actions", () => {
  const screen = buildScreen("/reminder", sampleData, { discipline: "math-1" });
  const picker = nodes(screen).find((n) => n.actionType === "pickDateTime");
  assert(picker && !("onResult" in picker));
  assert(
    nodes(screen).some((n) =>
      n.type === "appIf" && n.condition === "state.studyDate != ''"
    ),
  );
});
Deno.test("partial and unavailable plans never assert missing semesters or zero load", () => {
  const unavailable = buildScreen("/plan", {
    ...sampleData,
    plan: { ...samplePlan, quality: "unavailable", disciplines: [] },
  });
  assert(
    JSON.stringify(unavailable).includes("не означает отсутствие предметов"),
  );
  const unknown = buildScreen("/discipline", sampleData, {
    discipline: "unknown",
  });
  assert(
    JSON.stringify(unknown).includes("нет данных") &&
      JSON.stringify(unknown).includes("Семестр не определён"),
  );
});
Deno.test("external title and notes cannot inject state expressions", () => {
  const screen = buildScreen("/discipline", {
    ...sampleData,
    plan: {
      ...samplePlan,
      title: "{{storage.secret}}",
      disciplines: [{ ...samplePlan.disciplines[0], name: "{{user.id}}" }],
    },
    progress: [{ discipline_id: "math-1", note: "{{storage.secret}}" }],
  }, { discipline: "math-1" });
  const serialized = JSON.stringify(screen);
  assert(!serialized.includes("{{storage.") && !serialized.includes("{{user."));
});
Deno.test("real parser exams appear under the exams filter with Russian control labels", () => {
  const screen = buildScreen("/semester", {
    plan: parserPlanSample,
    progress: [],
  }, { semester: "1", filter: "exam" });
  const serialized = JSON.stringify(screen);
  assert(serialized.includes("Информатика") && serialized.includes("Экзамен"));
  assert(
    nodes(screen).filter((n) => n.label === "Открыть предмет").length === 1,
  );
});
Deno.test("unavailable plans do not produce misleading one-sided comparisons", () => {
  const screen = buildScreen("/compare", {
    plan: samplePlan,
    other: {
      ...samplePlan,
      id: "empty",
      quality: "unavailable",
      disciplines: [],
    },
  });
  const serialized = JSON.stringify(screen);
  assert(serialized.includes("Один из планов пока не разобран"));
  assert(!serialized.includes("В данных А"));
});
