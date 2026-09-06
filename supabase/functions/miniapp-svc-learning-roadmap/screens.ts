import {
  arrayOf,
  chosenIds,
  comparePlans,
  type Discipline,
  fmt,
  type Json,
  literal,
  numberOf,
  objectOf,
  PAGE_SIZE,
  pageOf,
  type Plan,
  planOf,
  rangeLabel,
  relatedSubjects,
  route,
  semesterLabel,
  stringOf,
  SUBJECT_PAGE_SIZE,
  validId,
  workloadOf,
} from "./domain.ts";

type Node = Json;
const text = (data: string, variant = "body", color?: string): Node => ({
  type: "appText",
  data: literal(data, 2500),
  variant,
  ...(color ? { color } : {}),
});
const gap = (height = 12): Node => ({ type: "sizedBox", height });
const column = (children: Node[]): Node => ({
  type: "column",
  crossAxisAlignment: "stretch",
  children,
});
const wrap = (children: Node[]): Node => ({
  type: "wrap",
  spacing: 8,
  runSpacing: 8,
  children,
});
const card = (children: Node[], tinted = false): Node => ({
  type: "appCard",
  tinted,
  radius: 22,
  child: column(children),
});
const page = (path: string, title = "Траектория"): Node => ({
  actionType: "openPage",
  path,
  title,
});
const toast = (message: string): Node => ({ actionType: "showToast", message });
const reload: Node = { actionType: "reload" };
const button = (label: string, onPressed: Node, variant = "primary"): Node => ({
  type: "appButton",
  label,
  onPressed,
  variant,
  expanded: true,
});
const tag = (label: string, tone = "accent"): Node => ({
  type: "appTag",
  label: literal(label, 150),
  tone,
});
const heading = (title: string, subtitle?: string): Node => ({
  type: "appSectionTitle",
  title: literal(title),
  ...(subtitle ? { subtitle: literal(subtitle) } : {}),
  topMargin: 18,
});
const empty = (title: string, subtitle: string): Node => ({
  type: "appEmptyState",
  emoji: "🧭",
  title,
  subtitle,
});
const input = (
  label: string,
  key: string,
  maxLength: number,
  multiline = false,
): Node => ({
  type: "appInputField",
  label,
  stateKey: key,
  maxLength,
  ...(multiline ? { maxLines: 5, keyboardType: "multiline" } : {}),
});
function request(action: string, body: Json, success: Node = reload): Node {
  return {
    actionType: "networkRequest",
    url: `/api/${action}`,
    method: "post",
    body,
    loadingKey: "busy",
    errorKey: "requestError",
    onError: toast(
      "Не удалось сохранить. Проверь подключение и попробуй ещё раз.",
    ),
    results: [
      {
        statusCode: 200,
        action: {
          actionType: "multiAction",
          sync: true,
          actions: [{ actionType: "hapticFeedback", style: "light" }, success],
        },
      },
      ...[400, 403, 404, 409, 413, 429, 500, 502, 503, 504].map((
        statusCode,
      ) => ({
        statusCode,
        action: toast(
          statusCode === 404
            ? "Учебный план изменился. Обнови экран."
            : "Не удалось сохранить. Попробуй ещё раз.",
        ),
      })),
    ],
  };
}
function shell(
  title: string,
  subtitle: string,
  children: Node[],
  initial: Json = {},
): Node {
  return {
    type: "appStateScope",
    initial: { busy: false, requestError: null, ...initial },
    child: {
      type: "scaffold",
      body: {
        type: "singleChildScrollView",
        padding: { left: 16, right: 16, top: 4, bottom: 32 },
        child: column([
          {
            type: "appSectionTitle",
            title,
            ...(subtitle ? { subtitle } : {}),
            topMargin: 0,
          },
          ...children,
        ]),
      },
    },
  };
}
function metadata(plan: Plan, compact = false): Node[] {
  const level = /бакалавр/i.test(plan.level)
    ? "Бакалавриат"
    : /магистр/i.test(plan.level)
    ? "Магистратура"
    : /специал/i.test(plan.level)
    ? "Специалитет"
    : /аспиран/i.test(plan.level)
    ? "Аспирантура"
    : "";
  return [
    ...(plan.profile && plan.profile !== plan.title
      ? [text(plan.profile, "bodyStrong"), gap(8)]
      : []),
    wrap([
      tag(plan.program_code || "Код не указан"),
      ...(plan.admission_year
        ? [tag(`Набор ${plan.admission_year}`, "mute")]
        : []),
      ...(!compact && level ? [tag(level, "mute")] : []),
      ...(compact && plan.study_form ? [tag(plan.study_form, "mute")] : []),
    ]),
    ...(!compact && (plan.study_form || plan.institute)
      ? [
        gap(8),
        text(
          [plan.study_form, plan.institute].filter(Boolean).join(" · "),
          "subtext",
          "muted",
        ),
      ]
      : []),
  ];
}
function sourceCard(plan: Plan): Node {
  const partial = plan.quality !== "complete";
  return card([
    text(
      plan.stale === true
        ? "Сохранён предыдущий разбор"
        : partial
        ? "Проверь детали в оригинале"
        : "Из официального учебного плана",
      "headlineStrong",
    ),
    gap(8),
    text(
      plan.quality === "unavailable"
        ? "Документ найден, но дисциплины пока не удалось надёжно извлечь. Открой PDF: отсутствие строк здесь не означает отсутствие предметов."
        : partial
        ? "Показана извлечённая часть плана. Неопределённые семестры и объёмы отмечены отдельно; сверяй выбор дисциплин с PDF."
        : "Автоматический разбор официального документа. Доступность дисциплин по выбору и индивидуальные изменения уточняй в институте.",
      "subtext",
      "muted",
    ),
    ...plan.warnings.slice(0, 4).flatMap((
      x,
    ) => [gap(6), text(x, "caption", "muted")]),
    ...(stringOf(plan.parsed_at)
      ? [
        gap(8),
        text(`Разобрано: ${dateLabel(plan.parsed_at)}`, "caption", "muted"),
      ]
      : []),
    ...(plan.stale === true && stringOf(plan.last_check_at)
      ? [
        gap(6),
        text(
          `Последняя проверка: ${dateLabel(plan.last_check_at)}`,
          "caption",
          "muted",
        ),
      ]
      : []),
    ...(plan.source_url
      ? [
        gap(),
        button("Открыть официальный PDF", {
          actionType: "openUrl",
          url: plan.source_url,
        }, "secondary"),
      ]
      : []),
  ]);
}
function dateLabel(value: unknown): string {
  const date = new Date(stringOf(value));
  return Number.isNaN(date.valueOf())
    ? "дата не указана"
    : date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}
function home(data: Json): Node {
  const plan = planOf(data.plan);
  if (plan) return planScreen(plan, data, true);
  return shell("Траектория", "Учебные планы РТУ МИРЭА", [
    card([
      text("Найди свою программу", "heading"),
      gap(8),
      text(
        "Предметы по семестрам, варианты выбора и сравнение программ.",
        "body",
        "muted",
      ),
      gap(),
      button("Выбрать учебный план", page("/catalog", "Учебные планы")),
    ], true),
    heading("Для учёбы"),
    wrap([{
      type: "appChip",
      label: "Расписание",
      onTap: { actionType: "openDeepLink", location: "/schedule" },
    }, {
      type: "appChip",
      label: "Банк знаний",
      onTap: {
        actionType: "openDeepLink",
        location: "/services/knowledge-bank",
      },
    }]),
  ]);
}
function loadText(rows: Discipline[], chosen: Set<string>): string {
  const load = workloadOf(rows, chosen);
  return rangeLabel(load.hours, "ч") + " · " + rangeLabel(load.credits, "з.е.");
}
function navChip(label: string, action: Node): Node {
  return { type: "appChip", label, onTap: action };
}
function compactButton(
  label: string,
  action: Node,
  variant = "secondary",
): Node {
  return { ...button(label, action, variant), expanded: false, size: "small" };
}
function toggle(key: string): Node {
  return { actionType: "setState", key, value: "{{!state." + key + "}}" };
}
function select(label: string, key: string, values: unknown): Node {
  const placeholder = ({
    code: "Все направления",
    year: "Любой год",
    level: "Все уровни",
    form: "Все формы",
    institute: "Все институты",
  } as Record<string, string>)[key] ?? "Все";
  return {
    type: "appSelectField",
    label,
    stateKey: key,
    placeholder,
    options: [
      { value: "", label: placeholder },
      ...arrayOf(values).map((v) => ({
        value: literal(String(v), 500),
        label: literal(String(v), 500),
      })),
    ],
  };
}
function catalog(data: Json, params: Json): Node {
  const filters = objectOf(data.filters), applied = objectOf(data.applied);
  const currentPage = pageOf(data.page), total = numberOf(data.total) ?? 0;
  const compare = validId(params.compare) ? String(params.compare) : "";
  const openCatalog = page(
    route("/catalog", { compare }),
    compare ? "Второй план" : "Учебные планы",
  );
  const plans = arrayOf(data.plans).map(planOf).filter((x): x is Plan =>
    x !== null
  );
  const activeFilters =
    ["code", "year", "level", "form", "institute"].filter((key) =>
      Boolean(applied[key])
    ).length;
  const findPlans = request("filters", {
    q: "{{state.q}}",
    code: "{{state.code}}",
    year: "{{state.year}}",
    level: "{{state.level}}",
    form: "{{state.form}}",
    institute: "{{state.institute}}",
  }, openCatalog);
  return shell(
    compare ? "Второй план" : "Учебные планы",
    "",
    [
      card([
        input("Поиск по названию или коду", "q", 100),
        gap(),
        button("Найти планы", findPlans),
        gap(8),
        wrap([
          {
            type: "appChip",
            label: activeFilters ? `Фильтры · ${activeFilters}` : "Фильтры",
            onTap: {
              actionType: "setState",
              key: "filtersOpen",
              value: "{{!state.filtersOpen}}",
            },
          },
          ...(activeFilters || stringOf(applied.q)
            ? [{
              type: "appChip",
              label: "Сбросить",
              onTap: request("filters", {}, openCatalog),
            }]
            : []),
        ]),
        {
          type: "appIf",
          condition: "state.filtersOpen",
          child: column([
            gap(),
            select("Год поступления", "year", filters.years),
            gap(8),
            select("Уровень", "level", filters.levels),
            gap(8),
            navChip(
              "Направление, институт и форма",
              toggle("programFiltersOpen"),
            ),
            {
              type: "appIf",
              condition: "state.programFiltersOpen",
              child: column([
                gap(8),
                select("Направление", "code", filters.codes),
                gap(8),
                select("Институт", "institute", filters.institutes),
                gap(8),
                select("Форма обучения", "form", filters.forms),
              ]),
            },
            gap(),
            button("Применить фильтры", findPlans),
          ]),
        },
      ]),
      heading(
        `Планы · ${total}`,
        total
          ? `Страница ${currentPage + 1} из ${Math.ceil(total / PAGE_SIZE)}`
          : "Попробуй другой запрос или сбрось фильтры",
      ),
      ...plans.flatMap((
        plan,
      ) => [
        card([
          text(plan.title, "headlineStrong"),
          gap(),
          ...metadata(plan, true),
          gap(8),
          tag(
            plan.quality === "complete"
              ? "Разобран"
              : plan.quality === "partial"
              ? "Частичный разбор"
              : "Доступен оригинал",
            plan.quality === "complete" ? "success" : "mute",
          ),
          gap(),
          button(
            compare
              ? (compare === plan.id
                ? "Это первый план"
                : "Сравнить с этим планом")
              : "Посмотреть программу",
            page(
              compare
                ? route("/compare", { id: compare, other: plan.id })
                : route("/plan", { id: plan.id }),
              compare ? "Сравнение" : "Учебный план",
            ),
            "secondary",
          ),
        ]),
        gap(),
      ]),
      ...(!plans.length
        ? [
          empty(
            "Планов по запросу нет",
            "Измени фильтры. Каталог обновляется по официальным публикациям университета.",
          ),
        ]
        : []),
      ...(currentPage > 0
        ? [
          button(
            "Предыдущая страница",
            page(route("/catalog", { page: currentPage - 1, compare })),
            "secondary",
          ),
          gap(8),
        ]
        : []),
      ...((currentPage + 1) * PAGE_SIZE < total
        ? [
          button(
            "Следующая страница",
            page(route("/catalog", { page: currentPage + 1, compare })),
            "secondary",
          ),
        ]
        : []),
    ],
    {
      filtersOpen: false,
      programFiltersOpen: Boolean(
        applied.code || applied.institute || applied.form,
      ),
      ...Object.fromEntries(
        ["q", "code", "year", "level", "form", "institute"].map((
          k,
        ) => [k, literal(applied[k], 500)]),
      ),
    },
  );
}
function planScreen(plan: Plan, data: Json, isHome = false): Node {
  const chosen = chosenIds(plan, data.records),
    prefs = objectOf(data.preferences);
  const semesters = [...new Set(plan.disciplines.map((d) => d.semester))].sort((
    a,
    b,
  ) => (a ?? 99) - (b ?? 99));
  const selected = prefs.plan_id === plan.id;
  const status = [
    selected ? "Мой учебный план" : "",
    plan.stale === true
      ? "Сохранена предыдущая версия"
      : plan.quality !== "complete"
      ? "Есть неполные данные"
      : "",
  ].filter(Boolean).join(" · ");
  return shell(plan.title, "", [
    ...(status ? [text(status, "caption", "muted"), gap(8)] : []),
    ...(plan.profile && plan.profile !== plan.title
      ? [text(plan.profile, "subtext"), gap(6)]
      : []),
    text(
      [
        plan.program_code,
        plan.admission_year ? "Набор " + plan.admission_year : "",
        plan.study_form,
      ].filter(Boolean).join(" · "),
      "caption",
      "muted",
    ),
    gap(8),
    wrap([
      ...(!selected
        ? [
          compactButton(
            "Сохранить план",
            request("select", { id: plan.id }),
            "primary",
          ),
        ]
        : []),
      ...(plan.source_url
        ? [
          compactButton("PDF плана", {
            actionType: "openUrl",
            url: plan.source_url,
          }),
        ]
        : []),
      compactButton(
        "Сравнить",
        page(route("/catalog", { compare: plan.id }), "Сравнение"),
      ),
    ]),
    gap(4),
    wrap([
      compactButton(
        "Сменить учебный план",
        page("/catalog", "Учебные планы"),
        "text",
      ),
      compactButton("О данных плана", toggle("planDataOpen"), "text"),
    ]),
    {
      type: "appIf",
      condition: "state.planDataOpen",
      child: column([gap(8), sourceCard(plan)]),
    },
    heading("Семестры"),
    ...semesters.flatMap((sem) => {
      const rows = plan.disciplines.filter((d) => d.semester === sem),
        load = workloadOf(rows, chosen);
      return [{
        ...card([
          text(semesterLabel(sem), "headlineStrong"),
          gap(6),
          text(loadText(rows, chosen), "bodyStrong"),
          gap(4),
          text(
            "Позиций в плане: " + load.subjects +
              (load.groups ? " · блоков выбора: " + load.groups : "") +
              (load.optional ? " · факультативов: " + load.optional : ""),
            "caption",
            "muted",
          ),
          ...(load.undecided
            ? [
              gap(4),
              text(
                "Блоков для выбора: " + load.undecided,
                "caption",
                "muted",
              ),
            ]
            : []),
        ]),
        onTap: page(
          route("/semester", { id: plan.id, semester: sem ?? "unknown" }),
          semesterLabel(sem),
        ),
      }, gap(8)];
    }),
    ...(!semesters.length
      ? [
        empty(
          "Дисциплины пока недоступны",
          "Открой официальный PDF или подробности в разделе «О данных плана».",
        ),
      ]
      : [
        text(
          "В нагрузке каждый блок выбора учитывается один раз. Факультативы добавляются после выбора. Диапазон означает, что объём зависит от альтернативы.",
          "caption",
          "muted",
        ),
      ]),
    ...(isHome
      ? [
        heading("Личная цель"),
        input("Чему хочу научиться", "goal", 500, true),
        gap(8),
        button(
          "Сохранить цель",
          request("goal", { goal: "{{state.goal}}" }),
          "secondary",
        ),
      ]
      : []),
    heading("Для учёбы"),
    wrap([
      navChip("Расписание", {
        actionType: "openDeepLink",
        location: "/schedule",
      }),
      navChip("Материалы", {
        actionType: "openDeepLink",
        location: "/services/knowledge-bank",
      }),
      navChip("Дедлайны", {
        actionType: "openDeepLink",
        location: "/services/deadlines",
      }),
    ]),
    heading("О программе"),
    text(
      [plan.level, plan.institute].filter(Boolean).join(" · "),
      "subtext",
      "muted",
    ),
    gap(8),
    button("Поделиться программой", {
      actionType: "share",
      text: plan.title +
        "\nhttps://mirea.ninja/app/services/apps/learning-roadmap/run?page=" +
        encodeURIComponent(route("/plan", { id: plan.id })),
    }, "secondary"),
  ], { planDataOpen: false, goal: literal(prefs.goal, 500) });
}
function subjectCard(plan: Plan, d: Discipline, chosen: Set<string>): Node {
  const optional = Boolean(d.choice_group) || d.is_optional === true;
  return {
    ...card([
      text(d.name, "headlineStrong"),
      gap(6),
      text(
        fmt(d.hours, "ч") + " · " + fmt(d.credits, "з.е."),
        "subtext",
        "muted",
      ),
      ...(d.control_forms.length || optional
        ? [
          gap(8),
          wrap([
            ...(d.is_optional
              ? [tag("Факультатив", "mute")]
              : d.choice_group
              ? [tag("По выбору", "mute")]
              : []),
            ...(chosen.has(d.id) ? [tag("Мой выбор", "success")] : []),
            ...d.control_forms.slice(0, 2).map((x) => tag(x)),
          ]),
        ]
        : []),
    ]),
    onTap: page(
      route("/discipline", { id: plan.id, discipline: d.id }),
      d.name,
    ),
  };
}
function semesterScreen(plan: Plan, data: Json, params: Json): Node {
  const sem = params.semester === "unknown" ? null : Number(params.semester),
    chosen = chosenIds(plan, data.records);
  const filter =
    ["all", "choice", "optional", "exam"].includes(String(params.filter))
      ? String(params.filter)
      : "all";
  const all = plan.disciplines.filter((d) => d.semester === sem),
    load = workloadOf(all, chosen);
  const subjects = all.filter((d) =>
    filter === "choice"
      ? Boolean(d.choice_group) && !d.is_optional
      : filter === "optional"
      ? d.is_optional
      : filter === "exam"
      ? d.control_forms.includes("Экзамен")
      : true
  );
  const current = pageOf(params.page),
    base = { id: plan.id, semester: sem ?? "unknown", filter };
  return shell(
    semesterLabel(sem),
    plan.program_code + " · набор " + (plan.admission_year ?? "не указан"),
    [
      ...(all.length
        ? [
          text(loadText(all, chosen), "heading"),
          gap(4),
          text(
            load.undecided
              ? "Нагрузка включает по одному предмету из блоков выбора. Нужно выбрать: " +
                load.undecided + "."
              : "Нагрузка учитывает твой выбор дисциплин.",
            "caption",
            "muted",
          ),
          gap(10),
        ]
        : []),
      wrap(
        [
          ["all", "Все"],
          ["choice", "По выбору"],
          ["optional", "Факультативы"],
          ["exam", "Экзамены"],
        ].map(([value, label]) => ({
          type: "appChip",
          label,
          selected: filter === value,
          onTap: page(
            route("/semester", { ...base, filter: value }),
            semesterLabel(sem),
          ),
        })),
      ),
      ...(sem === null
        ? [
          gap(8),
          text(
            "Распределение по семестрам не определено. Объём указан для предмета целиком.",
            "caption",
            "muted",
          ),
        ]
        : []),
      heading("Дисциплины · " + subjects.length),
      ...subjects.slice(
        current * SUBJECT_PAGE_SIZE,
        (current + 1) * SUBJECT_PAGE_SIZE,
      ).flatMap((d) => [subjectCard(plan, d, chosen), gap(8)]),
      ...(!subjects.length
        ? [empty(
          "По этому фильтру ничего нет",
          all.length
            ? "Выбери другой фильтр или открой все дисциплины."
            : "В разборе нет строк этого семестра; проверь официальный документ.",
        )]
        : []),
      ...(current > 0
        ? [
          button(
            "Предыдущие предметы",
            page(route("/semester", { ...base, page: current - 1 })),
            "secondary",
          ),
          gap(8),
        ]
        : []),
      ...((current + 1) * SUBJECT_PAGE_SIZE < subjects.length
        ? [
          button(
            "Следующие предметы",
            page(route("/semester", { ...base, page: current + 1 })),
            "secondary",
          ),
          gap(8),
        ]
        : []),
      wrap([
        navChip("Все семестры", page(route("/plan", { id: plan.id }))),
        ...(plan.source_url
          ? [navChip("PDF", { actionType: "openUrl", url: plan.source_url })]
          : []),
      ]),
    ],
  );
}
function disciplineScreen(plan: Plan, data: Json, params: Json): Node {
  const d = plan.disciplines.find((x) => x.id === params.discipline);
  if (!d) {
    return errorScreen(
      "Дисциплина не найдена",
      "Учебный план мог обновиться. Вернись к программе.",
    );
  }
  const chosen = chosenIds(plan, data.records),
    record =
      arrayOf(data.records).map(objectOf).find((x) =>
        x.discipline_id === d.id
      ) ?? {};
  const optional = Boolean(d.choice_group) || d.is_optional === true,
    selected = chosen.has(d.id),
    related = relatedSubjects(plan, d);
  const alternatives = d.choice_group
    ? plan.disciplines.filter((x) =>
      x.choice_group === d.choice_group && x.semester === d.semester &&
      x.id !== d.id
    )
    : [];
  const selectedOther = alternatives.find((x) => chosen.has(x.id));
  return shell(d.name, semesterLabel(d.semester), [
    text(fmt(d.hours, "ч") + " · " + fmt(d.credits, "з.е."), "heading"),
    gap(8),
    wrap([
      ...(d.control_forms.length
        ? d.control_forms.map((x) => tag(x))
        : [tag("Контроль не указан", "mute")]),
      ...(selected ? [tag("Мой выбор", "success")] : []),
    ]),
    ...(d.semester === null
      ? [
        gap(8),
        text(
          "Нагрузка указана для предмета целиком; семестр не определён.",
          "caption",
          "muted",
        ),
      ]
      : []),
    ...(optional
      ? [
        gap(),
        card([
          text(
            d.is_optional ? "Факультатив" : "Один предмет из блока",
            "headlineStrong",
          ),
          gap(6),
          text(
            d.is_optional
              ? "Не входит в обязательную нагрузку. Добавь, если планируешь изучать этот предмет."
              : "Альтернативы не суммируются: в этом блоке и семестре учитываем один предмет. Личный выбор не заменяет официальную запись.",
            "subtext",
            "muted",
          ),
          ...(selectedOther
            ? [gap(8), text("Сейчас выбран: " + selectedOther.name, "subtext")]
            : []),
          gap(),
          button(
            selected
              ? (d.is_optional ? "Убрать факультатив" : "Отменить выбор")
              : selectedOther
              ? "Выбрать вместо текущего"
              : d.is_optional
              ? "Добавить факультатив"
              : "Выбрать предмет",
            request("chosen", {
              id: plan.id,
              discipline_id: d.id,
              chosen: !selected,
              scope: "semester",
            }),
            selected ? "secondary" : "primary",
          ),
          ...(related.length > 1
            ? [
              gap(8),
              text(
                "Этот предмет есть в семестрах: " + related.map((x) =>
                  x.semester ?? "?"
                ).join(", ") + ".",
                "caption",
                "muted",
              ),
              gap(8),
              button(
                related.every((x) => chosen.has(x.id))
                  ? "Отменить во всех семестрах"
                  : "Выбрать во всех семестрах",
                request("chosen", {
                  id: plan.id,
                  discipline_id: d.id,
                  chosen: !related.every((x) => chosen.has(x.id)),
                  scope: "subject",
                }),
                "secondary",
              ),
            ]
            : []),
        ], true),
      ]
      : []),
    ...(alternatives.length
      ? [
        heading("Другие варианты этого блока"),
        ...alternatives.slice(0, 12).flatMap((
          x,
        ) => [{
          ...card([
            text(x.name, "bodyStrong"),
            gap(4),
            text(
              fmt(x.hours, "ч") + " · " + fmt(x.credits, "з.е."),
              "caption",
              "muted",
            ),
            ...(chosen.has(x.id) ? [gap(4), tag("Мой выбор", "success")] : []),
          ]),
          onTap: page(
            route("/discipline", { id: plan.id, discipline: x.id }),
            x.name,
          ),
        }, gap(6)]),
        ...(alternatives.length > 12
          ? [
            button(
              "Все варианты семестра",
              page(
                route("/semester", {
                  id: plan.id,
                  semester: d.semester ?? "unknown",
                  filter: d.is_optional ? "optional" : "choice",
                }),
              ),
              "secondary",
            ),
          ]
          : []),
      ]
      : []),
    heading("Материалы и занятия"),
    wrap([
      navChip("Банк знаний", {
        actionType: "openDeepLink",
        location: "/services/knowledge-bank",
      }),
      navChip("Расписание", {
        actionType: "openDeepLink",
        location: "/schedule",
      }),
      navChip(
        "Запланировать",
        page(
          route("/reminder", { id: plan.id, discipline: d.id }),
          "Запланировать занятие",
        ),
      ),
    ]),
    heading("Моя заметка"),
    input("Темы, ссылки и личные планы", "note", 2000, true),
    gap(8),
    button(
      "Сохранить заметку",
      request("note", {
        id: plan.id,
        discipline_id: d.id,
        note: "{{state.note}}",
      }),
      "secondary",
    ),
    ...(related.length > 1 && !optional
      ? [
        heading("Другие семестры"),
        wrap(
          related.filter((x) => x.id !== d.id).map((x) =>
            navChip(
              x.semester === null
                ? "Без семестра"
                : String(x.semester) + " семестр",
              page(
                route("/discipline", { id: plan.id, discipline: x.id }),
                x.name,
              ),
            )
          ),
        ),
      ]
      : []),
    gap(),
    wrap([
      navChip(
        "К семестру",
        page(
          route("/semester", {
            id: plan.id,
            semester: d.semester ?? "unknown",
          }),
        ),
      ),
      ...(plan.source_url
        ? [
          navChip("PDF плана", { actionType: "openUrl", url: plan.source_url }),
        ]
        : []),
    ]),
  ], { note: literal(record.note, 2000) });
}
function reminderScreen(plan: Plan, params: Json): Node {
  const d = plan.disciplines.find((x) => x.id === params.discipline);
  if (!d) {
    return errorScreen("Дисциплина не найдена", "Вернись к учебному плану.");
  }
  return shell("Время для учёбы", d.name, [
    card([
      text("Сначала выбери дату и время", "headlineStrong"),
      gap(8),
      text(
        "После выбора можно создать напоминание на этом устройстве или событие в календаре.",
        "body",
        "muted",
      ),
      gap(),
      button("Выбрать дату и время", {
        actionType: "pickDateTime",
        mode: "datetime",
        saveAs: "studyDate",
        onCancel: toast("Дата не выбрана"),
      }),
    ], true),
    gap(),
    {
      type: "appIf",
      condition: "state.studyDate != ''",
      child: card([
        {
          type: "appText",
          data: "Выбрано: {{state.studyDate}}",
          variant: "bodyStrong",
        },
        gap(),
        button("Создать напоминание", {
          actionType: "scheduleReminder",
          title: literal(d.name, 120),
          body: "Время для учёбы · Траектория",
          when: "{{state.studyDate}}",
          saveAs: "reminderId",
          onResult: toast("Напоминание создано"),
          onCancel: toast(
            "Не удалось создать напоминание. Проверь дату и разрешение уведомлений.",
          ),
        }),
        gap(8),
        button("Добавить в календарь", {
          actionType: "addCalendarEvent",
          title: literal(d.name, 120),
          start: "{{state.studyDate}}",
          notes: literal(`Занятие по учебному плану: ${plan.title}`, 800),
          saveAs: "eventAdded",
          onResult: toast("Событие добавлено"),
          onCancel: toast(
            "Событие не добавлено. Проверь разрешение календаря.",
          ),
        }, "secondary"),
      ]),
    },
    gap(),
    text(
      "Если выбрано прошедшее время, напоминание не создастся. Для другого устройства запланируй его там отдельно.",
      "caption",
      "muted",
    ),
  ], { studyDate: "" });
}
function comparisonSummary(rows: Discipline[]): string {
  if (!rows.length) return "Нет в извлечённых данных";
  const load = workloadOf(rows, new Set(rows.map((d) => d.id)));
  const semesters = [...new Set(rows.map((x) => x.semester))].sort((a, b) =>
    (a ?? 99) - (b ?? 99)
  ).map((x) => x === null ? "?" : String(x));
  const controls = [...new Set(rows.flatMap((x) => x.control_forms))];
  const kind = rows.some((d) => d.is_optional)
    ? "Факультатив"
    : rows.some((d) => d.choice_group)
    ? "По выбору"
    : "Обязательный предмет";
  return `Семестры: ${semesters.join(", ")}\n${rangeLabel(load.hours, "ч")} · ${
    rangeLabel(load.credits, "з.е.")
  }\n${kind}${controls.length ? ` · ${controls.join(", ")}` : ""}`;
}
function compareScreen(data: Json, params: Json): Node {
  const left = planOf(data.plan), right = planOf(data.other);
  if (!left || !right) {
    return errorScreen("Не хватает одного плана", "Выбери программы заново.");
  }
  if (!left.disciplines.length || !right.disciplines.length) {
    return shell("Сравнение программ", "Нужны данные обоих планов", [
      card([
        text("Один из планов пока не разобран", "headlineStrong"),
        gap(8),
        text(
          "Сравнение дисциплин появится, когда будут доступны оба разбора. Пока можно сопоставить официальные документы.",
          "body",
          "muted",
        ),
      ], true),
      gap(),
      text(`План А · ${left.title}`, "headlineStrong"),
      sourceCard(left),
      gap(),
      text(`План Б · ${right.title}`, "headlineStrong"),
      sourceCard(right),
      gap(),
      button(
        "Выбрать другой план",
        page(route("/catalog", { compare: left.id })),
        "secondary",
      ),
    ]);
  }
  const all = comparePlans(left, right),
    filter = stringOf(params.filter) || "differences";
  const rows = all.filter((x) => filter === "all" || x.status !== "same"),
    current = pageOf(params.page);
  const base = { id: left.id, other: right.id, filter };
  const labels = {
    same: "Данные совпадают",
    changed: "Есть изменения",
    only_left: "В данных А",
    only_right: "В данных Б",
  };
  return shell("Сравнение программ", "", [
    ...(left.quality !== "complete" || right.quality !== "complete" ||
        left.stale === true || right.stale === true
      ? [
        card([
          text("Сравниваем неполные данные", "headlineStrong"),
          gap(8),
          text(
            "Один из разборов неполный или сохранён от предыдущей проверки. Отсутствие предмета в доступных данных не означает его отсутствие в официальной программе.",
            "body",
            "muted",
          ),
        ], true),
        gap(),
      ]
      : []),
    card([
      tag("ПЛАН А"),
      gap(8),
      text(left.title, "headlineStrong"),
      gap(8),
      ...metadata(left, true),
    ]),
    gap(),
    card([
      tag("ПЛАН Б", "success"),
      gap(8),
      text(right.title, "headlineStrong"),
      gap(8),
      ...metadata(right, true),
    ]),
    gap(),
    text(
      "Сопоставляем точные названия дисциплин без учёта регистра и лишних пробелов. Сравнение не подтверждает возможность перезачёта. Одинаковый код в разных планах не считается совпадением предмета.",
      "subtext",
      "muted",
    ),
    heading(
      `Различия в общих предметах · ${
        all.filter((x) => x.status === "changed").length
      }`,
      `Совпадения по извлечённым данным · ${
        all.filter((x) => x.status === "same").length
      }`,
    ),
    wrap(
      [["differences", "Различия"], ["all", "Все предметы"]].map((
        [value, label],
      ) => ({
        type: "appChip",
        label,
        selected: filter === value,
        onTap: page(route("/compare", { ...base, filter: value }), "Сравнение"),
      })),
    ),
    gap(),
    ...rows.slice(
      current * SUBJECT_PAGE_SIZE,
      (current + 1) * SUBJECT_PAGE_SIZE,
    ).flatMap((
      x,
    ) => [
      card([
        tag(labels[x.status], x.status === "same" ? "success" : "mute"),
        gap(8),
        text(x.name, "headlineStrong"),
        ...(x.status === "only_left" || x.status === "only_right"
          ? [
            gap(8),
            text(
              `Найдено только в доступных данных плана ${
                x.status === "only_left" ? "А" : "Б"
              }.`,
              "caption",
              "muted",
            ),
          ]
          : []),
        gap(),
        text("ПЛАН А", "overline"),
        text(comparisonSummary(x.left), "subtext"),
        gap(),
        text("ПЛАН Б", "overline"),
        text(comparisonSummary(x.right), "subtext"),
      ]),
      gap(),
    ]),
    ...(!rows.length
      ? [
        empty(
          "Различий в извлечённых данных нет",
          "Проверь полноту обоих разборов и официальные PDF.",
        ),
      ]
      : []),
    ...(current > 0
      ? [
        button(
          "Предыдущие предметы",
          page(route("/compare", { ...base, page: current - 1 })),
          "secondary",
        ),
        gap(8),
      ]
      : []),
    ...((current + 1) * SUBJECT_PAGE_SIZE < rows.length
      ? [
        button(
          "Следующие предметы",
          page(route("/compare", { ...base, page: current + 1 })),
          "secondary",
        ),
        gap(),
      ]
      : []),
    button(
      "Выбрать другой второй план",
      page(route("/catalog", { compare: left.id })),
      "secondary",
    ),
    gap(),
    sourceCard(left),
    gap(),
    sourceCard(right),
  ]);
}
export function errorScreen(
  title = "Не удалось загрузить траекторию",
  message = "Проверь подключение и попробуй ещё раз.",
): Node {
  return shell("Траектория", "Учебные планы РТУ МИРЭА", [{
    type: "appErrorState",
    title,
    message,
    primaryLabel: "Повторить",
    onPrimary: reload,
    secondaryLabel: "На главную",
    onSecondary: page("/"),
  }]);
}
export function buildScreen(path: string, data: Json, params: Json = {}): Node {
  if (path === "/") return home(data);
  if (path === "/catalog") return catalog(data, params);
  if (path === "/compare") return compareScreen(data, params);
  const plan = planOf(data.plan);
  if (!plan) {
    return errorScreen(
      "Учебный план не найден",
      "Найди программу в каталоге и попробуй ещё раз.",
    );
  }
  if (path === "/plan") return planScreen(plan, data);
  if (path === "/semester") return semesterScreen(plan, data, params);
  if (path === "/discipline") return disciplineScreen(plan, data, params);
  if (path === "/reminder") return reminderScreen(plan, params);
  return errorScreen(
    "Такой страницы нет",
    "Вернись на главную страницу траектории.",
  );
}
