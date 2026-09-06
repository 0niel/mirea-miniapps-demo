import {
  arrayOf,
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
  progressOf,
  route,
  semesterLabel,
  stringOf,
  SUBJECT_PAGE_SIZE,
  validId,
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
          { type: "appSectionTitle", title, subtitle, topMargin: 0 },
          ...children,
        ]),
      },
    },
  };
}
function metadata(plan: Plan): Node[] {
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
      ...(level ? [tag(level, "mute")] : []),
    ]),
    ...(plan.study_form || plan.institute
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
function progressCard(plan: Plan, records: unknown): Node {
  const p = progressOf(plan, records);
  if (!plan.disciplines.length) {
    return card([
      text("Прогресс появится после разбора", "headlineStrong"),
      gap(8),
      text(
        "Пока можно изучить официальный PDF и сохранить план.",
        "subtext",
        "muted",
      ),
    ]);
  }
  return card([
    text(`${p.done} из ${p.total}`, "displaySmall"),
    text("Отмечено в твоей траектории", "subtext", "muted"),
    gap(),
    { type: "appProgressBar", value: p.ratio, color: "accent", height: 8 },
    gap(8),
    text(
      "Личные отметки, не официальная успеваемость. В блоке по выбору учитываем один предмет; факультативы — только выбранные.",
      "caption",
      "muted",
    ),
    ...(p.undecided
      ? [
        gap(8),
        text(
          `Осталось выбрать предметы в ${p.undecided} блоках. Открой дисциплины по семестрам.`,
          "caption",
          "muted",
        ),
      ]
      : []),
  ], true);
}
function home(data: Json): Node {
  const plan = planOf(data.plan), prefs = objectOf(data.preferences);
  return shell(
    "Траектория",
    "Учебные планы РТУ МИРЭА",
    [
      card([
        text("Учёба по плану", "heading"),
        gap(8),
        text(
          "Предметы, твой выбор и прогресс по семестрам.",
          "body",
          "muted",
        ),
      ], true),
      gap(),
      ...(plan
        ? [
          heading("Мой учебный план"),
          card([
            text(plan.title, "headlineStrong"),
            gap(),
            ...metadata(plan),
            gap(),
            button(
              "Открыть мой маршрут",
              page(route("/plan", { id: plan.id }), "Мой маршрут"),
            ),
          ]),
          gap(),
          progressCard(plan, data.progress),
        ]
        : [
          gap(),
          empty(
            "Выбери свою программу",
            "Найди направление, профиль и год поступления. Выбор сохранится на всех твоих устройствах.",
          ),
        ]),
      gap(),
      button(
        plan ? "Найти или сменить план" : "Найти свой учебный план",
        page("/catalog", "Учебные планы"),
        plan ? "secondary" : "primary",
      ),
      ...(plan
        ? [
          heading("Личная цель", "Видна только тебе"),
          input("Чему хочу научиться", "goal", 500, true),
          gap(),
          button(
            "Сохранить цель",
            request("goal", { goal: "{{state.goal}}" }),
            "secondary",
          ),
        ]
        : []),
      heading("Рядом с учёбой"),
      card([
        button("Моё расписание", {
          actionType: "openDeepLink",
          location: "/schedule",
        }, "secondary"),
        gap(8),
        button("Банк знаний", {
          actionType: "openDeepLink",
          location: "/services/knowledge-bank",
        }, "secondary"),
        gap(8),
        button("Дедлайны", {
          actionType: "openDeepLink",
          location: "/services/deadlines",
        }, "secondary"),
      ]),
    ],
    { goal: literal(prefs.goal, 500) },
  );
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
    compare ? "Выбери второй план" : "Найди свой маршрут",
    compare
      ? "Сопоставим дисциплины, семестры и учебную нагрузку"
      : "Направление, профиль, форма и год поступления",
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
            select("Направление", "code", filters.codes),
            gap(8),
            select("Год поступления", "year", filters.years),
            gap(8),
            select("Уровень", "level", filters.levels),
            gap(8),
            select("Форма обучения", "form", filters.forms),
            gap(8),
            select("Институт", "institute", filters.institutes),
            gap(),
            button("Применить фильтры", findPlans),
          ]),
        },
      ]),
      heading(
        `${total} планов`,
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
          ...metadata(plan),
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
      ...Object.fromEntries(
        ["q", "code", "year", "level", "form", "institute"].map((
          k,
        ) => [k, literal(applied[k], 500)]),
      ),
    },
  );
}
function planScreen(plan: Plan, data: Json): Node {
  const progress = progressOf(plan, data.progress),
    selected = objectOf(data.preferences).plan_id === plan.id;
  const semesters = [...new Set(plan.disciplines.map((d) => d.semester))].sort((
    a,
    b,
  ) => (a ?? 99) - (b ?? 99));
  return shell("Учебный план", "Полная картина твоего обучения", [
    card([
      text(plan.title, "pageTitle"),
      gap(),
      ...metadata(plan),
      gap(),
      button(
        selected ? "Это мой учебный план" : "Выбрать этот план",
        request("select", { id: plan.id }),
      ),
      gap(8),
      button(
        "Сравнить с другим планом",
        page(route("/catalog", { compare: plan.id }), "Сравнить планы"),
        "secondary",
      ),
      gap(8),
      button("Поделиться программой", {
        actionType: "share",
        text:
          `${plan.title}\nhttps://mirea.ninja/app/services/apps/learning-roadmap/run?page=${
            encodeURIComponent(route("/plan", { id: plan.id }))
          }`,
      }, "secondary"),
    ], true),
    gap(),
    progressCard(plan, data.progress),
    heading(
      "Маршрут по семестрам",
      "Открой семестр, чтобы увидеть дисциплины и формы контроля",
    ),
    ...semesters.flatMap((sem) => {
      const subjects = plan.disciplines.filter((d) => d.semester === sem),
        done = subjects.filter((d) => progress.ids.has(d.id)).length;
      return [
        card([
          text(semesterLabel(sem), "headlineStrong"),
          gap(8),
          text(
            `${subjects.length} дисциплин · отмечено ${done}`,
            "subtext",
            "muted",
          ),
          gap(8),
          {
            type: "appProgressBar",
            value: subjects.length ? done / subjects.length : 0,
            height: 6,
          },
          gap(),
          button(
            "Открыть дисциплины",
            page(
              route("/semester", { id: plan.id, semester: sem ?? "unknown" }),
              semesterLabel(sem),
            ),
            "secondary",
          ),
        ]),
        gap(),
      ];
    }),
    ...(!semesters.length
      ? [
        empty(
          "Разбор пока недоступен",
          "Учебный план есть в каталоге. Открой официальный документ ниже.",
        ),
      ]
      : []),
    sourceCard(plan),
  ]);
}
function subjectCard(plan: Plan, d: Discipline, completed: boolean): Node {
  return card([
    wrap([
      tag(completed ? "Отмечено" : "Впереди", completed ? "success" : "mute"),
      ...(d.choice_group ? [tag("По выбору", "mute")] : []),
      ...(d.is_optional ? [tag("Факультатив", "mute")] : []),
      ...d.control_forms.slice(0, 3).map((x) => tag(x)),
    ]),
    gap(8),
    text(d.name, "headlineStrong"),
    gap(8),
    text(
      `${fmt(d.hours, "ч")} · ${fmt(d.credits, "з.е.")}`,
      "subtext",
      "muted",
    ),
    gap(),
    button(
      "Открыть предмет",
      page(
        route("/discipline", { id: plan.id, discipline: d.id }),
        "Дисциплина",
      ),
      "secondary",
    ),
  ]);
}
function semesterScreen(plan: Plan, data: Json, params: Json): Node {
  const sem = params.semester === "unknown" ? null : Number(params.semester),
    done = progressOf(plan, data.progress).ids;
  const filter =
    ["all", "pending", "done", "exam"].includes(String(params.filter))
      ? String(params.filter)
      : "all";
  const all = plan.disciplines.filter((d) => d.semester === sem);
  const subjects = all.filter((d) =>
    filter === "done"
      ? done.has(d.id)
      : filter === "pending"
      ? !done.has(d.id)
      : filter === "exam"
      ? d.control_forms.some((x) => /экзамен/i.test(x))
      : true
  );
  const current = pageOf(params.page),
    pages = subjects.slice(
      current * SUBJECT_PAGE_SIZE,
      (current + 1) * SUBJECT_PAGE_SIZE,
    );
  const base = { id: plan.id, semester: sem ?? "unknown", filter };
  return shell(
    semesterLabel(sem),
    `${plan.program_code} · ${plan.admission_year ?? "Год не указан"}`,
    [
      wrap(
        [["all", "Все"], ["pending", "Впереди"], ["done", "Отмечено"], [
          "exam",
          "Экзамены",
        ]].map(([value, label]) => ({
          type: "appChip",
          label,
          selected: filter === value,
          onTap: page(
            route("/semester", { ...base, filter: value }),
            semesterLabel(sem),
          ),
        })),
      ),
      heading(
        `${subjects.length} дисциплин`,
        sem === null
          ? "Объём по предмету из источника; распределение по семестрам не определено"
          : "Нагрузка указана для этого семестра, если она есть в источнике",
      ),
      ...pages.flatMap((d) => [subjectCard(plan, d, done.has(d.id)), gap()]),
      ...(!subjects.length
        ? [empty(
          "Здесь пока пусто",
          all.length
            ? "Под выбранный фильтр дисциплины не попали."
            : "В разборе нет строк для этого семестра. Это не подтверждает отсутствие занятий.",
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
          gap(),
        ]
        : []),
      button(
        "К учебному плану",
        page(route("/plan", { id: plan.id })),
        "secondary",
      ),
      gap(),
      sourceCard(plan),
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
  const record =
    arrayOf(data.progress).map(objectOf).find((x) =>
      x.discipline_id === d.id
    ) ?? {};
  const completed = record.completed === true;
  const optional = Boolean(d.choice_group) || d.is_optional === true;
  const chosen = record.chosen === true;
  return shell("Дисциплина", semesterLabel(d.semester), [
    card([
      text(d.name, "pageTitle"),
      gap(),
      wrap(
        d.control_forms.length
          ? d.control_forms.map((x) => tag(x))
          : [tag("Контроль не указан", "mute")],
      ),
      gap(),
      text(fmt(d.hours, "ч"), "headlineStrong"),
      gap(4),
      text(fmt(d.credits, "з.е."), "headlineStrong"),
      ...(d.source_code
        ? [gap(8), text(`Код в плане: ${d.source_code}`, "caption", "muted")]
        : []),
      ...(d.kind
        ? [
          gap(4),
          text(
            ({
              discipline: "Дисциплина",
              practice: "Практика",
              elective: "Факультатив",
              attestation: "Аттестация",
              final_assessment: "Итоговая аттестация",
            } as Record<string, string>)[d.kind] ?? "Учебная дисциплина",
            "caption",
            "muted",
          ),
        ]
        : []),
      ...(d.semester === null
        ? [
          gap(8),
          text(
            "Объём относится к предмету в исходном документе. Распределение по семестрам не определено.",
            "caption",
            "muted",
          ),
        ]
        : []),
    ], true),
    ...(optional
      ? [
        gap(),
        card([
          text(
            d.is_optional ? "Факультатив" : "Дисциплина по выбору",
            "headlineStrong",
          ),
          gap(8),
          text(
            d.choice_group
              ? "Выбери одну альтернативу в этом блоке и семестре. Это твой личный маршрут; официальную запись уточняй в институте."
              : "Этот предмет попадёт в твой прогресс, если ты добавишь его в маршрут.",
            "subtext",
            "muted",
          ),
          gap(),
          button(
            chosen ? "Убрать из моего выбора" : "Добавить в мой маршрут",
            request("chosen", {
              id: plan.id,
              discipline_id: d.id,
              chosen: !chosen,
            }),
            chosen ? "secondary" : "primary",
          ),
        ]),
      ]
      : []),
    ...(!optional || chosen
      ? [
        gap(),
        button(
          completed
            ? "Убрать отметку о прохождении"
            : "Отметить как пройденное",
          request("completed", {
            id: plan.id,
            discipline_id: d.id,
            completed: !completed,
          }),
          completed ? "secondary" : "primary",
        ),
      ]
      : []),
    heading(
      "Мои заметки",
      "Ссылки, темы для повторения и личные планы. Видны только тебе.",
    ),
    input("Заметка к предмету", "note", 2000, true),
    gap(),
    button(
      "Сохранить заметку",
      request("note", {
        id: plan.id,
        discipline_id: d.id,
        note: "{{state.note}}",
      }),
      "secondary",
    ),
    heading("Запланировать занятие"),
    button(
      "Напоминание или календарь",
      page(
        route("/reminder", { id: plan.id, discipline: d.id }),
        "Запланировать",
      ),
      "secondary",
    ),
    gap(),
    card([
      button("Найти материалы в банке знаний", {
        actionType: "openDeepLink",
        location: "/services/knowledge-bank",
      }, "secondary"),
      gap(8),
      button("Открыть расписание", {
        actionType: "openDeepLink",
        location: "/schedule",
      }, "secondary"),
    ]),
    gap(),
    sourceCard(plan),
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
  const total = (key: "hours" | "credits") =>
    rows.some((x) => x[key] === null)
      ? null
      : rows.reduce((n, x) => n + (x[key] ?? 0), 0);
  const semesters = [...new Set(rows.map((x) => x.semester))].sort((a, b) =>
    (a ?? 99) - (b ?? 99)
  ).map((x) => x === null ? "?" : String(x));
  const controls = [...new Set(rows.flatMap((x) => x.control_forms))];
  return `Семестры: ${semesters.join(", ")}\n${fmt(total("hours"), "ч")} · ${
    fmt(total("credits"), "з.е.")
  }${controls.length ? `\n${controls.join(", ")}` : ""}`;
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
  return shell("Сравнение программ", "Два маршрута — понятные различия", [
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
      ...metadata(left),
    ]),
    gap(),
    card([
      tag("ПЛАН Б", "success"),
      gap(8),
      text(right.title, "headlineStrong"),
      gap(8),
      ...metadata(right),
    ]),
    gap(),
    text(
      "Сопоставляем точные названия дисциплин без учёта регистра и лишних пробелов. Сравнение не подтверждает возможность перезачёта. Одинаковый код в разных планах не считается совпадением предмета.",
      "subtext",
      "muted",
    ),
    heading(
      `${
        all.filter((x) => x.status === "changed").length
      } различий в общих предметах`,
      `${
        all.filter((x) => x.status === "same").length
      } совпадений по извлечённым данным`,
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
