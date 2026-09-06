import {
  catalogData,
  parserPlanSample,
  sampleData,
  samplePlan,
} from "./fixtures.ts";
import { objectOf } from "./domain.ts";
import { buildScreen, errorScreen } from "./screens.ts";
const output = Deno.args[0];
if (!output) throw new Error("Output directory required");
await Deno.mkdir(output, { recursive: true });
const screens = {
  home: buildScreen("/", sampleData),
  onboarding: buildScreen("/", { preferences: {}, catalog_count: 950 }),
  catalog: buildScreen("/catalog", catalogData),
  catalog_empty: buildScreen("/catalog", {
    ...catalogData,
    plans: [],
    total: 0,
  }),
  plan: buildScreen("/plan", sampleData),
  semester: buildScreen("/semester", sampleData, { semester: "1" }),
  electives: buildScreen("/semester", sampleData, { semester: "2" }),
  discipline: buildScreen("/discipline", sampleData, { discipline: "math-1" }),
  elective: buildScreen("/discipline", sampleData, { discipline: "sport-b-2" }),
  elective_selected: buildScreen("/discipline", sampleData, {
    discipline: "sport-a-2",
  }),
  facultative: buildScreen("/discipline", sampleData, {
    discipline: "optional-2",
  }),
  load_range: buildScreen("/semester", sampleData, { semester: "3" }),
  reminder: buildScreen("/reminder", sampleData, { discipline: "math-1" }),
  compare: buildScreen("/compare", sampleData),
  unavailable: buildScreen("/plan", {
    ...sampleData,
    plan: { ...samplePlan, quality: "unavailable", disciplines: [] },
  }),
  error: errorScreen(),
  parser_exams: buildScreen("/semester", {
    plan: parserPlanSample,
    records: [],
  }, { semester: "1", filter: "exam" }),
  parser_choice: buildScreen("/discipline", {
    plan: parserPlanSample,
    records: [],
  }, { discipline: "eae09f29a374fddc154a690b136c6bbf" }),
  compare_unavailable: buildScreen("/compare", {
    plan: samplePlan,
    other: {
      ...samplePlan,
      id: "empty",
      quality: "unavailable",
      disciplines: [],
    },
  }),
};
const filtersOpen = buildScreen("/catalog", catalogData);
const planDataOpen = buildScreen("/plan", sampleData);
planDataOpen.initial = {
  ...objectOf(planDataOpen.initial),
  planDataOpen: true,
};
filtersOpen.initial = { ...objectOf(filtersOpen.initial), filtersOpen: true };
const filtersAdvanced = buildScreen("/catalog", catalogData);
filtersAdvanced.initial = {
  ...objectOf(filtersAdvanced.initial),
  filtersOpen: true,
  programFiltersOpen: true,
};
const reminderReady = buildScreen("/reminder", sampleData, {
  discipline: "math-1",
});
reminderReady.initial = {
  ...objectOf(reminderReady.initial),
  studyDate: "2027-01-12T14:00:00",
};
Object.assign(screens, {
  plan_data_open: planDataOpen,
  catalog_filters_open: filtersOpen,
  catalog_filters_advanced: filtersAdvanced,
  reminder_ready: reminderReady,
});
for (const [name, screen] of Object.entries(screens)) {
  await Deno.writeTextFile(
    `${output}/learning_${name}.json`,
    JSON.stringify(screen, null, 2),
  );
}
console.log(`Exported ${Object.keys(screens).length} learning screens`);
