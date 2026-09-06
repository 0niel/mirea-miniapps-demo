export type Json = Record<string, unknown>;
export interface Discipline {
  id: string;
  name: string;
  source_code?: string;
  subject_id?: string;
  semester: number | null;
  kind?: string;
  choice_group?: string | null;
  is_optional?: boolean;
  control_forms: string[];
  hours: number | null;
  credits: number | null;
}
export interface Plan extends Json {
  id: string;
  title: string;
  program_code: string;
  profile: string;
  level: string;
  study_form: string;
  admission_year: number | null;
  institute: string;
  source_url: string;
  quality: string;
  warnings: string[];
  disciplines: Discipline[];
}
export const PAGE_SIZE = 12;
export const SUBJECT_PAGE_SIZE = 20;
export const objectOf = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {};
export const arrayOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const stringOf = (value: unknown, limit = 500): string =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
export const literal = (value: unknown, limit = 1000): string =>
  stringOf(value, limit)
    .replace(/\{\{/g, "｛｛").replace(/\}\}/g, "｝｝")
    .split("").filter((c) => c >= " " || ["\t", "\n", "\r"].includes(c)).join(
      "",
    );
export const numberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
export function controlLabel(value: unknown): string {
  const labels: Record<string, string> = {
    exam: "Экзамен",
    credit: "Зачёт",
    graded_credit: "Зачёт с оценкой",
    course_project: "Курсовой проект",
    course_work: "Курсовая работа",
  };
  return labels[stringOf(value)] ?? literal(value, 100);
}
export function warningLabel(value: unknown): string {
  const code = stringOf(value, 500);
  if (/[А-Яа-яЁё]/.test(code)) return literal(code, 500);
  if (code === "last_good_parse_retained") {
    return "Сохранён предыдущий разбор. Последняя проверка дала меньше данных; сверься с официальным документом.";
  }
  if (code === "curriculum_document_not_published") {
    return "Университет ещё не опубликовал документ учебного плана.";
  }
  if (
    code.includes("semester") &&
    (code.includes("unavailable") || code.includes("header"))
  ) return "Распределение части дисциплин по семестрам не удалось определить.";
  if (code.includes("control")) {
    return "Некоторые формы контроля требуют сверки с оригиналом.";
  }
  if (code.includes("hours") || code.includes("credits")) {
    return "Часть учебной нагрузки требует сверки с оригиналом.";
  }
  if (code.includes("year")) {
    return "Год в документе отличается от года в имени файла; показан год из документа.";
  }
  if (code.includes("duplicate")) {
    return "В документе встретились неоднозначные повторяющиеся строки.";
  }
  if (code.includes("no_reliably") || code.includes("table_header")) {
    return "Таблицу учебного плана пока не удалось полностью разобрать.";
  }
  if (
    code.includes("fetch") || code.includes("download") || code.includes("HTTP")
  ) return "Официальный документ временно не удалось загрузить.";
  return "Некоторые сведения требуют проверки по официальному документу.";
}
export const pageOf = (value: unknown): number =>
  Math.max(0, Math.min(10000, Math.floor(Number(value) || 0)));
export const validId = (value: unknown): boolean =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return b.length > 0 && diff === 0;
}
export function sourceUrl(value: unknown): string {
  try {
    const url = new URL(stringOf(value, 2000));
    return url.protocol === "https:" &&
        (url.hostname === "mirea.ru" || url.hostname.endsWith(".mirea.ru")) &&
        !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function planOf(value: unknown): Plan | null {
  const row = objectOf(value);
  if (!validId(row.id)) return null;
  return {
    ...row,
    id: String(row.id),
    title: literal(row.title),
    program_code: literal(row.program_code),
    profile: literal(row.profile),
    level: literal(row.level),
    study_form: literal(row.study_form),
    admission_year: numberOf(row.admission_year),
    institute: literal(row.institute),
    source_url: sourceUrl(row.source_url),
    quality: stringOf(row.quality),
    stale: row.stale === true || row.source_stale === true,
    last_check_at: row.last_check_at ?? row.last_attempt_at ?? row.checked_at,
    warnings: [...new Set(arrayOf(row.warnings).map(warningLabel))].slice(
      0,
      20,
    ),
    disciplines: arrayOf(row.disciplines).flatMap((item) => {
      const d = objectOf(item);
      if (!validId(d.id) || !stringOf(d.name)) return [];
      const sem = numberOf(d.semester);
      return [{
        id: String(d.id),
        name: literal(d.name),
        source_code: literal(d.source_code, 100),
        subject_id: validId(d.subject_id) ? String(d.subject_id) : undefined,
        semester: sem !== null && Number.isInteger(sem) && sem >= 1 && sem <= 20
          ? sem
          : null,
        kind: literal(d.kind),
        choice_group: stringOf(d.choice_group, 200) || null,
        is_optional: d.kind === "elective" ||
          (d.is_optional === true && !stringOf(d.choice_group)),
        control_forms: arrayOf(d.control_forms).map(controlLabel),
        hours: numberOf(d.hours),
        credits: numberOf(d.credits),
      }];
    }),
  };
}
export function parseRoute(
  raw: unknown,
  query: unknown = {},
): { path: string; params: Json } {
  const url = new URL(stringOf(raw, 4000) || "/", "https://roadmap.local");
  const params: Json = Object.fromEntries(url.searchParams);
  for (const [key, val] of Object.entries(objectOf(query))) {
    if (typeof val === "string" && !(key in params)) params[key] = val;
  }
  return { path: url.pathname, params };
}
export function route(path: string, params: Json = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }
  return `${path}${query.size ? `?${query}` : ""}`;
}
export function fmt(value: number | null, unit: string): string {
  return value === null
    ? `${unit}: нет данных`
    : `${value.toLocaleString("ru-RU")} ${unit}`;
}
export function semesterLabel(value: number | null): string {
  return value === null
    ? "Семестр не определён"
    : `${value} семестр · ${Math.ceil(value / 2)} курс`;
}
export function chosenIds(plan: Plan, records: unknown): Set<string> {
  const available = new Set(
    plan.disciplines.filter((d) => d.choice_group || d.is_optional).map((d) =>
      d.id
    ),
  );
  return new Set(
    arrayOf(records).map(objectOf).filter((r) =>
      r.chosen === true && available.has(String(r.discipline_id))
    ).map((r) => String(r.discipline_id)),
  );
}
export interface LoadRange {
  min: number | null;
  max: number | null;
}
export interface Workload {
  hours: LoadRange;
  credits: LoadRange;
  subjects: number;
  groups: number;
  undecided: number;
  optional: number;
}
export function workloadOf(rows: Discipline[], chosen: Set<string>): Workload {
  const units: Discipline[][] = [];
  const groups = new Map<string, Discipline[]>();
  let undecided = 0, optional = 0;
  for (const d of rows) {
    if (d.choice_group) {
      const key = `${d.semester}:${d.choice_group}`;
      groups.set(key, [...(groups.get(key) ?? []), d]);
    } else if (!d.is_optional || chosen.has(d.id)) {
      units.push([d]);
      if (d.is_optional) optional++;
    }
  }
  let mandatoryGroups = 0;
  for (const items of groups.values()) {
    const picked = items.find((d) => chosen.has(d.id));
    const mandatory = items.some((d) => !d.is_optional);
    if (mandatory) mandatoryGroups++;
    if (picked) {
      units.push([picked]);
      if (!mandatory) optional++;
    } else if (mandatory) {
      units.push(items);
      undecided++;
    }
  }
  const total = (key: "hours" | "credits"): LoadRange => {
    if (units.some((items) => items.some((d) => d[key] === null))) {
      return { min: null, max: null };
    }
    return {
      min: Math.round(
        units.reduce(
          (n, items) => n + Math.min(...items.map((d) => d[key] as number)),
          0,
        ) * 1000,
      ) / 1000,
      max: Math.round(
        units.reduce(
          (n, items) => n + Math.max(...items.map((d) => d[key] as number)),
          0,
        ) * 1000,
      ) / 1000,
    };
  };
  return {
    hours: total("hours"),
    credits: total("credits"),
    subjects: units.length,
    groups: mandatoryGroups,
    undecided,
    optional,
  };
}
export function rangeLabel(range: LoadRange, unit: string): string {
  if (range.min === null || range.max === null) return `${unit}: не все данные`;
  return range.min === range.max
    ? fmt(range.min, unit)
    : `${range.min.toLocaleString("ru-RU")}–${
      range.max.toLocaleString("ru-RU")
    } ${unit}`;
}
export function relatedSubjects(plan: Plan, subject: Discipline): Discipline[] {
  return plan.disciplines.filter((d) =>
    d.id === subject.id ||
    Boolean(
      subject.subject_id && d.subject_id === subject.subject_id &&
        d.choice_group === subject.choice_group,
    )
  );
}
export interface Comparison {
  name: string;
  status: "same" | "changed" | "only_left" | "only_right";
  left: Discipline[];
  right: Discipline[];
}
export function comparePlans(left: Plan, right: Plan): Comparison[] {
  const normalize = (s: string) =>
    s.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(
      /\s+/g,
      " ",
    ).trim();
  const group = (plan: Plan) => {
    const result = new Map<string, Discipline[]>();
    for (const item of plan.disciplines) {
      const key = normalize(item.name);
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    return result;
  };
  const a = group(left), b = group(right);
  const signature = (rows: Discipline[]) =>
    JSON.stringify(
      rows.map((d) => ({
        semester: d.semester,
        hours: d.hours,
        credits: d.credits,
        optional: d.is_optional === true,
        choice: Boolean(d.choice_group),
        control: [...d.control_forms].sort(),
      })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
    );
  return [...new Set([...a.keys(), ...b.keys()])].map((key): Comparison => {
    const x = a.get(key) ?? [], y = b.get(key) ?? [];
    return {
      name: (x[0] ?? y[0]).name,
      left: x,
      right: y,
      status: !x.length
        ? "only_right"
        : !y.length
        ? "only_left"
        : signature(x) === signature(y)
        ? "same"
        : "changed",
    };
  }).sort((x, y) => x.name.localeCompare(y.name, "ru"));
}
export function publicFailure(
  error: unknown,
): { message: string; status: number } {
  const code = stringOf(objectOf(error).code);
  if (code === "42501") {
    return {
      message: "Действие недоступно. Войди в приложение заново.",
      status: 403,
    };
  }
  if (code === "P0002") {
    return {
      message: "План или дисциплина уже недоступны. Обнови экран.",
      status: 404,
    };
  }
  if (["22023", "22P02", "23514"].includes(code)) {
    return { message: "Проверь введённые данные.", status: 400 };
  }
  return {
    message: "Не удалось загрузить траекторию. Попробуй ещё раз.",
    status: 503,
  };
}
