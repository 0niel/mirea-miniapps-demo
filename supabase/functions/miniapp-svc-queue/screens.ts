import {
  appLink,
  appTitle,
  count,
  eventView,
  formatCode,
  type Json,
  list,
  modes,
  number,
  object,
  people,
  presentCard,
  presentQueue,
  queuePath,
  safeText,
  slots,
  statusView,
  string,
  toTime,
} from "./domain.ts";

type Node = Json;
type Ctx = { code: string; now: number; publicBase: string };

const t = (
  data: unknown,
  variant = "body",
  color?: string,
  extra: Json = {},
): Node => ({
  type: "appText",
  data: safeText(data),
  variant,
  ...(color ? { color } : {}),
  ...extra,
});
const dyn = (
  data: string,
  variant = "body",
  color?: string,
  extra: Json = {},
): Node => ({
  type: "appText",
  data,
  variant,
  ...(color ? { color } : {}),
  ...extra,
});
const gap = (height = 12): Node => ({ type: "sizedBox", height });
const hgap = (width = 8): Node => ({ type: "sizedBox", width });
const col = (children: Node[], extra: Json = {}): Node => ({
  type: "column",
  crossAxisAlignment: "stretch",
  children,
  ...extra,
});
const row = (children: Node[], extra: Json = {}): Node => ({
  type: "row",
  crossAxisAlignment: "center",
  children,
  ...extra,
});
const expanded = (child: Node): Node => ({ type: "expanded", child });
const card = (children: Node[], extra: Json = {}): Node => ({
  type: "appCard",
  padding: 16,
  radius: 20,
  child: col(children),
  ...extra,
});
const wrap = (children: Node[], spacing = 8): Node => ({
  type: "wrap",
  spacing,
  runSpacing: spacing,
  children,
});
const open = (path: string, title = appTitle): Node => ({
  actionType: "openPage",
  path,
  title,
});
const toast = (message: string, type = "success"): Node => ({
  actionType: "showToast",
  message,
  type,
});
const multi = (...actions: Node[]): Node => ({
  actionType: "multiAction",
  sync: true,
  actions,
});
const set = (key: string, value: unknown): Node => ({
  actionType: "setState",
  key,
  value,
});
const setValues = (values: Json): Node => ({ actionType: "setState", values });
const runIf = (condition: string, then: Node, otherwise?: Node): Node => ({
  actionType: "runIf",
  condition,
  then,
  ...(otherwise ? { else: otherwise } : {}),
});
const haptic = (style = "light"): Node => ({
  actionType: "hapticFeedback",
  style,
});
const confirm = (
  title: string,
  message: string,
  label: string,
  onConfirm: Node,
  danger = false,
): Node => ({
  actionType: "confirm",
  title,
  message,
  confirmLabel: label,
  cancelLabel: "Отмена",
  isDanger: danger,
  onConfirm,
});
const reload: Node = { actionType: "reload" };
const pop: Node = { actionType: "pop" };
const goHome: Node = { actionType: "reload", target: "root" };
const btn = (
  label: string,
  onPressed: Node,
  variant = "primary",
  extra: Json = {},
): Node => ({
  type: "appButton",
  label,
  onPressed,
  variant,
  expanded: true,
  loadingLabel: "Подождите…",
  ...extra,
});
const small = (
  label: string,
  onPressed: Node,
  icon?: string,
  variant = "ghost",
) =>
  btn(label, onPressed, variant, {
    expanded: false,
    size: "small",
    ...(icon ? { icon } : {}),
  });
const iconButton = (
  icon: string,
  tooltip: string,
  onPressed: Node,
  tone = "tonal",
  extra: Json = {},
): Node => ({
  type: "appIconButton",
  icon,
  tooltip,
  onPressed,
  tone,
  ...extra,
});
const tag = (label: string, tone = "mute", extra: Json = {}): Node => ({
  type: "appTag",
  label,
  tone,
  ...extra,
});
const badge = (label: string, tone = "neutral", icon?: string): Node => ({
  type: "appBadge",
  label,
  tone,
  ...(icon ? { icon } : {}),
});
const avatar = (name: unknown, size = 40): Node => ({
  type: "appAvatar",
  name: safeText(name),
  size,
});
const tile = (emoji: string, color = "accent", size = 44): Node => ({
  type: "appIconTile",
  emoji,
  size,
  radius: Math.round(size / 3),
  color,
});
const iconTile = (icon: string, color = "accent", size = 40): Node => ({
  type: "appIconTile",
  icon,
  size,
  radius: Math.round(size / 3),
  color,
});
const empty = (
  title: string,
  subtitle: string,
  child?: Node,
  emoji = "🎟️",
): Node => ({
  type: "appEmptyState",
  emoji,
  title,
  subtitle,
  ...(child ? { child } : {}),
});
const section = (title: string, subtitle?: string, extra: Json = {}): Node => ({
  type: "appSectionTitle",
  title,
  topMargin: 22,
  bottomPadding: 10,
  ...(subtitle ? { subtitle } : {}),
  ...extra,
});
const banner = (message: string, tone = "accent", extra: Json = {}): Node => ({
  type: "appBanner",
  message,
  tone,
  ...extra,
});

function api(
  path: string,
  body: Json,
  success: Node,
  options: { key?: string } = {},
): Node {
  const key = options.key ?? "res";
  return {
    actionType: "networkRequest",
    url: path,
    method: "post",
    contentType: "application/json",
    body,
    saveAs: key,
    onError: toast(
      "Не получилось. Проверьте соединение и попробуйте ещё раз.",
      "error",
    ),
    results: [
      {
        statusCode: 200,
        action: runIf(
          `state.${key}.ok`,
          success,
          toast(`{{state.${key}.message}}`, "warning"),
        ),
      },
      {
        statusCode: 403,
        action: toast("Это может сделать только создатель очереди", "error"),
      },
      {
        statusCode: 404,
        action: toast("Очередь или участник уже недоступны", "warning"),
      },
      {
        statusCode: 429,
        action: toast("Лимит действий на сегодня исчерпан", "warning"),
      },
    ],
  };
}

const done = (message: string): Node => multi(toast(message), reload, haptic());

function shell(children: Node[], initial: Json = {}, refresh = 0): Node {
  return {
    type: "scaffold",
    ...(refresh ? { refreshIntervalSeconds: refresh } : {}),
    body: {
      type: "appStateScope",
      initial: { res: null, ...initial },
      child: {
        type: "singleChildScrollView",
        padding: { left: 16, right: 16, top: 12, bottom: 28 },
        child: col(children),
      },
    },
  };
}

const resolveCode = (raw: string): Node =>
  api(
    "/api/resolve",
    { raw },
    multi(set("code", ""), open("/q?code={{state.found.code}}", "Очередь")),
    { key: "found" },
  );

const scan: Node = multi(
  set("scan", ""),
  { actionType: "scanCode", saveAs: "scan" },
  runIf("state.scan != ''", resolveCode("{{state.scan}}")),
);

function joinCard(): Node {
  const find = runIf(
    "len(trim(state.code)) == 0",
    toast("Введите код очереди", "warning"),
    resolveCode("{{state.code}}"),
  );
  return card([
    row([
      tile("🎟️"),
      hgap(12),
      expanded(col([
        t("Встать в очередь", "headlineStrong"),
        gap(2),
        t(
          "Введите код или отсканируйте QR у одногруппника",
          "caption",
          "muted",
        ),
      ])),
    ]),
    gap(14),
    row([
      expanded({
        type: "appInputField",
        stateKey: "code",
        placeholder: "Код, например K7F 2QX",
        leadingIcon: "key",
        maxLength: 12,
        onSubmitted: find,
      }),
      hgap(8),
      iconButton("qr", "Сканировать QR-код", scan, "primary"),
    ]),
    gap(10),
    btn("Найти очередь", find, "secondary", { icon: "arrowRight" }),
  ]);
}

function ringValue(card: Json): number {
  const waiting = Math.max(1, number(card.waiting, 1));
  return Math.max(0.08, Math.min(1, 1 - number(card.ahead, 0) / waiting));
}

function myQueueCard(c: Json): Node {
  const now = c.my_state === "current";
  const subtitle = [string(c.my_label), string(c.eta_label)].filter(Boolean)
    .join(" · ");
  return {
    type: "appCard",
    padding: 14,
    radius: 20,
    tinted: now,
    onTap: open(queuePath(string(c.code)), "Очередь"),
    semanticsLabel: `${string(c.title)}. ${subtitle}`,
    child: row([
      now ? tile("🔔", "success", 60) : {
        type: "appProgressRing",
        value: ringValue(c),
        size: 60,
        strokeWidth: 6,
        label: `${number(c.my_pos, 0)}`,
        sublabel: "место",
        color: number(c.ahead, 0) === 0 ? "warn" : "accent",
      },
      hgap(14),
      expanded(col([
        t(c.title, "headlineStrong", undefined, { maxLines: 2 }),
        gap(3),
        t(subtitle, "caption", now ? "success" : "muted", { maxLines: 2 }),
        gap(8),
        wrap([
          badge(string(c.mode_short), "neutral", string(c.mode_icon)),
          ...(c.current_name && !now
            ? [badge(`Сдаёт: ${string(c.current_name)}`, "lecture")]
            : []),
        ], 6),
      ])),
      hgap(6),
      { type: "appLineIcon", icon: "chevronR", size: 18, color: "muted" },
    ]),
  };
}

function statusTag(c: Json): Node {
  return c.live === true
    ? tag(string(c.status_label), "live", { withDot: true })
    : tag(string(c.status_label), string(c.status_tone));
}

function queueRow(c: Json, subtitle: string, first: boolean): Node {
  return {
    type: "appListRow",
    title: string(c.title),
    subtitle,
    isFirst: first,
    showChevron: true,
    leading: tile(
      c.status_key === "finished"
        ? "🏁"
        : c.status_key === "scheduled"
        ? "⏰"
        : c.status_key === "closed"
        ? "🔒"
        : "🎟️",
      c.status_key === "finished" ? "muted" : "accent",
      40,
    ),
    onTap: open(queuePath(string(c.code)), "Очередь"),
  };
}

function groupCard(c: Json): Node {
  const join = api(
    "/api/join",
    { code: string(c.code), note: "" },
    multi(
      toast("Вы в очереди · {{state.joined.position}}-е место"),
      open(queuePath(string(c.code)), "Очередь"),
      haptic(),
    ),
    { key: "joined" },
  );
  return {
    type: "appCard",
    padding: 14,
    radius: 20,
    onTap: open(queuePath(string(c.code)), "Очередь"),
    child: col([
      t(c.title, "headlineStrong", undefined, { maxLines: 2 }),
      gap(3),
      t(
        `${string(c.owner_name)} · ${string(c.waiting_label)}`,
        "caption",
        "muted",
        { maxLines: 2 },
      ),
      gap(12),
      row([
        expanded(wrap([
          statusTag(c),
          badge(string(c.mode_short), "neutral", string(c.mode_icon)),
          ...(c.current_name
            ? [badge(`Сдаёт: ${string(c.current_name)}`, "lecture")]
            : []),
        ], 6)),
        hgap(8),
        c.status_key === "open"
          ? btn("Встать", join, "primary", {
            expanded: false,
            size: "small",
            icon: "plus",
          })
          : small(
            "Открыть",
            open(queuePath(string(c.code)), "Очередь"),
            "arrowRight",
          ),
      ], { crossAxisAlignment: "end" }),
    ]),
  };
}

function howItWorks(): Node {
  const step = (icon: string, title: string, text: string): Node =>
    row([
      iconTile(icon, "accent", 36),
      hgap(12),
      expanded(col([
        t(title, "labelStrong"),
        gap(2),
        t(text, "caption", "muted"),
      ])),
    ], { crossAxisAlignment: "start" });
  return card([
    t("Как это работает", "captionStrong", "muted"),
    gap(12),
    step(
      "plus",
      "Создайте очередь",
      "Выберите предмет и порядок: по времени записи или вручную.",
    ),
    gap(12),
    step(
      "qr",
      "Позовите группу",
      "Покажите QR или отправьте код — вход в пару касаний.",
    ),
    gap(12),
    step(
      "bell",
      "Следите за местом",
      "Пришлём уведомление, когда вы следующий и когда подошла очередь.",
    ),
    gap(12),
    step(
      "shield",
      "Всё прозрачно",
      "Время записи и каждое действие видны участникам в истории.",
    ),
  ]);
}

function home(state: Json, ctx: Ctx): Node {
  const me = object(state.me);
  const present = (key: string) =>
    list(state[key]).map((c) => presentCard(c, ctx.now));
  const mine = present("mine"), owned = present("owned");
  const group = present("group"), recent = present("recent");
  const archive = present("archive");
  const calledHere = mine.filter((c) => c.my_state === "current");
  const nothing = !mine.length && !owned.length && !group.length &&
    !recent.length;
  const refresh = mine.length || owned.length ? 10 : 30;
  return shell(
    [
      ...calledHere.flatMap((c) => [{
        type: "appBanner",
        title: "Ваша очередь!",
        message: `${string(c.title)} — подходите, вас вызвали.`,
        tone: "success",
        icon: "bell",
        actionLabel: "Открыть",
        onAction: open(queuePath(string(c.code)), "Очередь"),
      }, gap(12)]),
      joinCard(),
      gap(10),
      btn("Создать очередь", open("/new", "Новая очередь"), "tonal", {
        icon: "plus",
      }),
      ...(mine.length
        ? [
          section(
            "Я в очереди",
            "Место обновляется само каждые несколько секунд",
            {
              meta: `${mine.length}`,
            },
          ),
          ...mine.flatMap((c) => [myQueueCard(c), gap(10)]),
        ]
        : []),
      ...(owned.length
        ? [
          section("Мои очереди", "Вы управляете этими очередями", {
            action: "Создать",
            onActionTap: open("/new", "Новая очередь"),
          }),
          {
            type: "appListGroup",
            showDividers: true,
            children: owned.map((c, i) =>
              queueRow(
                c,
                `${string(c.waiting_label)} · ${string(c.status_label)} · ${
                  string(c.code_label)
                }`,
                i === 0,
              )
            ),
          },
        ]
        : []),
      ...(group.length
        ? [
          section(
            `Группа ${safeText(me.group)}`,
            "Очереди одногруппников — можно встать без кода",
          ),
          ...group.flatMap((c) => [groupCard(c), gap(10)]),
        ]
        : []),
      ...(recent.length
        ? [
          section("Недавние", "Очереди, которые вы открывали"),
          {
            type: "appListGroup",
            showDividers: true,
            children: recent.map((c, i) =>
              queueRow(
                c,
                `${string(c.owner_name)} · ${string(c.waiting_label)}`,
                i === 0,
              )
            ),
          },
        ]
        : []),
      ...(nothing
        ? [
          gap(18),
          empty(
            "Пока нет очередей",
            me.has_group === true
              ? "Создайте очередь на сдачу лабы — одногруппники увидят её здесь."
              : "Создайте очередь на сдачу лабы или попросите код у одногруппников.",
            undefined,
            "🎟️",
          ),
        ]
        : []),
      ...(archive.length
        ? [
          gap(18),
          {
            type: "appChip",
            label: `Завершённые · ${archive.length}`,
            leadingIcon: "clock",
            selected: "{{state.archiveOpen}}",
            onTap: { actionType: "setState", key: "archiveOpen", toggle: true },
          },
          {
            type: "appIf",
            condition: "state.archiveOpen",
            child: col([
              gap(10),
              {
                type: "appListGroup",
                showDividers: true,
                children: archive.map((c, i) =>
                  queueRow(
                    c,
                    `${
                      c.is_owner ? "Вы создатель" : string(c.owner_name)
                    } · сдали ${number(c.done, 0)}`,
                    i === 0,
                  )
                ),
              },
            ]),
          },
        ]
        : []),
      gap(18),
      howItWorks(),
    ],
    { code: "", scan: "", found: null, joined: null, archiveOpen: false },
    refresh,
  );
}

function modeOption(value: string): Node {
  const mode = modes[value];
  return {
    type: "appCard",
    padding: 14,
    radius: 18,
    color: `{{state.mode == '${value}' ? 'tint' : 'surface2'}}`,
    semanticsLabel: mode.title,
    onTap: multi(set("mode", value), haptic("selection")),
    child: row([
      iconTile(mode.icon, "accent", 40),
      hgap(12),
      expanded(col([
        t(mode.title, "labelStrong"),
        gap(3),
        t(mode.rule, "caption", "muted"),
      ])),
      hgap(8),
      {
        type: "appIf",
        condition: `state.mode == '${value}'`,
        child: {
          type: "appLineIcon",
          icon: "check",
          size: 22,
          color: "accent",
        },
        else: { type: "sizedBox", width: 22 },
      },
    ], { crossAxisAlignment: "start" }),
  };
}

function openingPicker(now: number): Node[] {
  const options = [{ value: "now", label: "Сразу" }, ...slots(now)];
  const customChip: Node = {
    type: "appChip",
    label: "{{state.customLabel != '' ? state.customLabel : 'Своё время'}}",
    leadingIcon: "calendar",
    selected: "{{state.customIso != '' && state.opens == state.customIso}}",
    onTap: multi(
      set("customRaw", ""),
      { actionType: "pickDateTime", saveAs: "customRaw", mode: "datetime" },
      runIf("state.customRaw != ''", {
        actionType: "fetch",
        path: "/api/when",
        method: "POST",
        body: { iso: "{{state.customRaw}}" },
        saveAs: "custom",
        onResult: runIf(
          "state.custom.ok",
          setValues({
            opens: "{{state.custom.iso}}",
            customIso: "{{state.custom.iso}}",
            customLabel: "{{state.custom.label}}",
          }),
          multi(
            set("opens", "now"),
            toast("{{state.custom.message}}", "warning"),
          ),
        ),
        onError: toast("Не удалось проверить время", "error"),
      }),
    ),
  };
  return [
    wrap([
      ...options.map((o): Node => ({
        type: "appChip",
        label: string(o.label),
        selected: `{{state.opens == '${string(o.value)}'}}`,
        onTap: set("opens", string(o.value)),
      })),
      customChip,
    ]),
    gap(8),
    dyn(
      `{{state.opens == 'now' ? 'Встать в очередь можно будет сразу.' : 'До открытия встать нельзя — все начинают одновременно, порядок решит время записи.'}}`,
      "caption",
      "muted",
    ),
  ];
}

function newQueue(state: Json, ctx: Ctx): Node {
  const me = object(state.me);
  const subjects = list(state.subjects);
  const recentTitles = Array.isArray(state.recent_titles)
    ? state.recent_titles.map(safeText).filter(Boolean)
    : [];
  const hasGroup = me.has_group === true;
  const active = number(state.active_owned, 0);
  const submit = api(
    "/api/create",
    {
      title: "{{state.title}}",
      note: "{{state.note}}",
      mode: "{{state.mode}}",
      opens: "{{state.opens}}",
      capacity: "{{state.limit ? state.capacity : 0}}",
      group: "{{state.group}}",
      join_self: "{{state.join_self}}",
    },
    multi(
      toast("Очередь создана — делитесь кодом"),
      pop,
      open("/q?code={{state.created.code}}", "Очередь"),
      haptic("medium"),
    ),
    { key: "created" },
  );
  const suggestions = [
    ...subjects.map((s) => ({
      title: safeText(s.name),
      icon: s.today === true ? "clock" : s.lab === true ? "flask" : "book",
      label: s.today === true && string(s.time)
        ? `${safeText(s.name)} · ${string(s.time).slice(0, 5)}`
        : safeText(s.name),
    })),
    ...recentTitles
      .filter((title) => !subjects.some((s) => safeText(s.name) === title))
      .map((title) => ({ title, icon: "refresh", label: title })),
  ].slice(0, 14);
  return shell([
    ...(active >= 12
      ? [
        banner(
          `У вас ${
            count(active, [
              "активная очередь",
              "активные очереди",
              "активных очередей",
            ])
          } из 15. Завершите ненужные.`,
          "warn",
        ),
        gap(12),
      ]
      : []),
    section(
      "Что сдаём",
      suggestions.length
        ? "Выберите предмет или впишите своё название"
        : hasGroup
        ? "Впишите название очереди"
        : "Выберите группу в расписании — здесь появятся ваши предметы",
      { topMargin: 4 },
    ),
    ...(suggestions.length
      ? [
        wrap(suggestions.map((s, i): Node => ({
          type: "appChip",
          label: s.label,
          leadingIcon: s.icon,
          selected: `{{state.subject == ${i}}}`,
          onTap: setValues({ subject: i, title: s.title }),
        }))),
        gap(12),
      ]
      : []),
    card([
      {
        type: "appInputField",
        stateKey: "title",
        label: "Название",
        placeholder: "Например, Физика — лаба 3",
        maxLength: 80,
      },
      gap(12),
      {
        type: "appInputField",
        stateKey: "note",
        label: "Комментарий",
        placeholder: "Аудитория, что сдаём, правила",
        multiline: true,
        minLines: 2,
        maxLines: 5,
        maxLength: 280,
        showCounter: false,
      },
    ]),
    section("Порядок", "Выбор виден всем участникам"),
    modeOption("join"),
    gap(8),
    modeOption("owner"),
    section("Когда открыть запись"),
    ...openingPicker(ctx.now),
    section("Участники"),
    card([
      {
        type: "appToggle",
        stateKey: "limit",
        label: "Ограничить число мест",
      },
      {
        type: "appIf",
        condition: "state.limit",
        child: col([
          gap(10),
          row([
            expanded(t("Мест в очереди", "body")),
            { type: "appStepper", stateKey: "capacity", min: 2, max: 200 },
          ]),
        ]),
      },
      gap(10),
      ...(hasGroup
        ? [
          {
            type: "appToggle",
            stateKey: "group",
            label: `Показать группе ${safeText(me.group)}`,
          },
          gap(4),
          t(
            "Одногруппники увидят очередь на главной и смогут встать без кода.",
            "caption",
            "muted",
          ),
          gap(10),
        ]
        : []),
      {
        type: "appToggle",
        stateKey: "join_self",
        label: "Сразу записать меня",
      },
      gap(4),
      dyn(
        "{{state.opens == 'now' ? 'Вы встанете первым — как создатель очереди.' : 'Для отложенного открытия запишитесь вместе со всеми.'}}",
        "caption",
        "muted",
      ),
    ]),
    gap(18),
    btn(
      "Создать очередь",
      runIf(
        "len(trim(state.title)) < 2",
        toast("Добавьте название — хотя бы 2 символа", "warning"),
        submit,
      ),
      "primary",
      { icon: "check", size: "large", loadingLabel: "Создаём…" },
    ),
    gap(10),
    t(
      "Код и QR появятся сразу после создания. Очередь без активности 3 дня завершится сама.",
      "caption",
      "muted",
      { align: "center" },
    ),
  ], {
    title: "",
    note: "",
    subject: -1,
    mode: "join",
    opens: "now",
    customRaw: "",
    customIso: "",
    customLabel: "",
    custom: null,
    limit: false,
    capacity: 25,
    group: hasGroup,
    join_self: false,
    created: null,
  });
}

function qrUrl(ctx: Ctx, code: string): string {
  return ctx.publicBase
    ? `${
      ctx.publicBase.replace(/\/$/, "")
    }/functions/v1/miniapp-svc-queue/qr/${code}.png`
    : "";
}

function shareCard(q: Json, ctx: Ctx): Node {
  const code = string(q.code);
  const link = appLink(queuePath(code));
  const text = `Очередь «${string(q.title)}» в Mirea Ninja
Код: ${formatCode(code)}
${link}`;
  const src = qrUrl(ctx, code);
  return card([
    row([
      expanded(col([
        t("Код очереди", "caption", "muted"),
        gap(2),
        t(formatCode(code), "sectionLarge", undefined, { maxLines: 1 }),
      ])),
      hgap(8),
      iconButton("clipboard", "Скопировать код", {
        actionType: "copyToClipboard",
        text: code,
        message: "Код скопирован",
      }, "tonal"),
    ]),
    ...(src
      ? [
        gap(14),
        {
          type: "center",
          child: {
            type: "appImage",
            src,
            width: 176,
            height: 176,
            radius: 16,
            fit: "contain",
            semanticLabel: `QR-код очереди ${formatCode(code)}`,
          },
        },
        gap(8),
        t(
          "Нажмите на QR, чтобы показать его на весь экран",
          "caption",
          "muted",
          {
            align: "center",
          },
        ),
      ]
      : []),
    gap(14),
    row([
      expanded(btn("Поделиться", { actionType: "share", text }, "secondary", {
        icon: "share",
      })),
      hgap(8),
      iconButton("link", "Скопировать ссылку", {
        actionType: "copyToClipboard",
        text: link,
        message: "Ссылка скопирована",
      }, "tonal"),
    ]),
  ]);
}

function statBlock(value: string, label: string, color?: string): Node {
  return expanded(col([
    t(value, "metric", color),
    gap(2),
    t(label, "caption", "muted", { maxLines: 1 }),
  ], { crossAxisAlignment: "start" }));
}

function headerCard(q: Json, ctx: Ctx): Node {
  const status = statusView(q, ctx.now);
  const mode = modes[string(q.mode)] ?? modes.join;
  const counts = object(q.counts);
  return card([
    row([
      expanded(wrap([
        status.live
          ? { type: "appLiveBadge", label: "Запись открыта" }
          : tag(status.label, status.tone),
        badge(mode.short, "neutral", mode.icon),
      ], 6)),
    ]),
    gap(12),
    t(q.title, "heading"),
    ...(string(q.note)
      ? [gap(6), {
        type: "appExpandableText",
        text: string(q.note),
        maxLines: 3,
        variant: "subtext",
        color: "muted",
        expandLabel: "Подробнее",
        collapseLabel: "Свернуть",
      }]
      : []),
    gap(12),
    wrap([
      { type: "appMetaPill", text: string(q.owner_name), icon: "user" },
      ...(string(q.group_name)
        ? [{ type: "appMetaPill", text: string(q.group_name), icon: "people" }]
        : []),
      ...(q.capacity
        ? [{
          type: "appMetaPill",
          text: `${number(counts.waiting, 0) + number(counts.current, 0)}/${
            number(q.capacity, 0)
          } мест`,
          icon: "grid",
        }]
        : []),
      {
        type: "appMetaPill",
        text: `создана ${string(q.created_label)}`,
        icon: "clock",
      },
    ], 6),
    gap(16),
    row([
      statBlock(`${number(counts.waiting, 0)}`, "в очереди"),
      statBlock(`${number(counts.done, 0)}`, "сдали", "success"),
      statBlock(string(q.avg_label) || "—", "в среднем"),
    ], { crossAxisAlignment: "start" }),
  ]);
}

function reminderAt(q: Json, now: number): string {
  const opens = toTime(q.opens_at);
  if (opens == null || opens <= now) return "";
  const at = opens - 5 * 60000 > now + 60000 ? opens - 5 * 60000 : opens;
  return new Date(at).toISOString();
}

function myCard(q: Json, ctx: Ctx): Node | null {
  const code = string(q.code);
  const my = q.my ? object(q.my) : null;
  const status = statusView(q, ctx.now);
  const counts = object(q.counts);
  const waiting = number(counts.waiting, 0);
  const hasCurrent = number(counts.current, 0) > 0;
  const leave = confirm(
    "Выйти из очереди?",
    "Место освободится. Вернуться можно будет только в конец списка.",
    "Выйти",
    api("/api/leave", { code }, done("Вы вышли из очереди")),
    true,
  );
  const noteEditor = (note: string): Node[] => [
    gap(10),
    {
      type: "appChip",
      label: note ? `Заметка: ${note}` : "Добавить заметку",
      leadingIcon: "pencil",
      selected: "{{state.noteOpen}}",
      onTap: { actionType: "setState", key: "noteOpen", toggle: true },
    },
    {
      type: "appIf",
      condition: "state.noteOpen",
      child: col([
        gap(10),
        {
          type: "appInputField",
          stateKey: "myNote",
          placeholder: "Что сдаёте — видно всем",
          maxLength: 60,
        },
        gap(8),
        btn(
          "Сохранить заметку",
          api(
            "/api/note",
            { code, note: "{{state.myNote}}" },
            multi(set("noteOpen", false), done("Заметка сохранена")),
          ),
          "secondary",
          { size: "small" },
        ),
      ]),
    },
  ];
  if (my && my.state === "current") {
    return {
      type: "appCard",
      padding: 16,
      radius: 22,
      color: "successTint",
      child: col([
        row([
          tile("🔔", "success", 56),
          hgap(14),
          expanded(col([
            t("Ваша очередь!", "heading"),
            gap(3),
            t(
              `Вызов в ${
                string(my.called_label)
              }. Когда закончите — отметьте сдачу, следующий получит уведомление.`,
              "caption",
              "muted",
            ),
          ])),
        ]),
        gap(14),
        btn(
          "Отметить сдачу",
          api("/api/done", { code }, done("Готово! Следующего уже позвали")),
          "primary",
          { icon: "check", size: "large" },
        ),
        gap(8),
        btn("Выйти из очереди", leave, "ghost", { icon: "door" }),
      ]),
    };
  }
  if (my) {
    const pos = number(my.pos, 1);
    const ahead = pos - 1;
    const headline = pos === 1
      ? hasCurrent ? "Вы следующий" : "Вы первый в очереди"
      : `Перед вами ${people(ahead)}`;
    const eta = string(object(q).my_eta);
    return {
      type: "appCard",
      padding: 16,
      radius: 22,
      tinted: true,
      child: col([
        row([
          {
            type: "appProgressRing",
            value: Math.max(0.08, 1 - ahead / Math.max(1, waiting)),
            size: 76,
            strokeWidth: 7,
            label: `${pos}`,
            sublabel: "место",
            color: pos === 1 ? "warn" : "accent",
          },
          hgap(16),
          expanded(col([
            t(headline, "heading"),
            gap(4),
            t(
              eta ||
                (pos === 1 && !hasCurrent
                  ? "Можно идти — отметьте это, чтобы все видели."
                  : "Пришлём уведомление, когда будете следующим и когда вас вызовут."),
              "caption",
              "muted",
            ),
            gap(6),
            t(`Записались в ${string(my.joined_label)}`, "micro", "muted"),
          ])),
        ]),
        ...(pos === 1 && !hasCurrent && status.key !== "scheduled"
          ? [
            gap(14),
            btn(
              "Иду сдавать",
              api(
                "/api/start",
                { code },
                done("Удачи! Все видят, что вы сдаёте"),
              ),
              "primary",
              { icon: "arrowRight", size: "large" },
            ),
          ]
          : []),
        gap(12),
        row([
          expanded(btn(
            "Пропустить",
            confirm(
              "Пропустить следующего вперёд?",
              "Вы поменяетесь местами с участником за вами. Запись появится в истории.",
              "Пропустить",
              api(
                "/api/let_ahead",
                { code },
                done("Вы пропустили участника вперёд"),
              ),
            ),
            "outline",
            { icon: "swap", enabled: pos < waiting },
          )),
          hgap(8),
          expanded(btn("Выйти", leave, "ghost", { icon: "door" })),
        ]),
        ...noteEditor(string(my.note)),
      ]),
    };
  }
  if (status.key === "finished") {
    return banner(
      "Очередь завершена. Историю и итоги можно посмотреть ниже.",
      "accent",
    );
  }
  if (status.key === "closed") {
    return banner(
      "Создатель закрыл запись. Список ниже продолжает двигаться.",
      "warn",
    );
  }
  if (
    q.capacity && waiting + number(counts.current, 0) >= number(q.capacity, 0)
  ) {
    return banner(
      "Все места заняты. Загляните позже — кто-то может выйти.",
      "warn",
    );
  }
  if (status.key === "scheduled") {
    const at = reminderAt(q, ctx.now);
    return card([
      row([
        tile("⏰", "accent", 52),
        hgap(14),
        expanded(col([
          t(`Запись откроется ${string(q.opens_label)}`, "headlineStrong"),
          gap(3),
          t(
            "До этого встать нельзя никому, включая создателя. Экран обновится сам.",
            "caption",
            "muted",
          ),
        ])),
      ], { crossAxisAlignment: "start" }),
      ...(at
        ? [
          gap(14),
          btn(
            "Напомнить перед открытием",
            {
              actionType: "scheduleReminder",
              title: "Скоро откроется очередь ⏰",
              body: `${string(q.title)} — запись ${string(q.opens_label)}`,
              when: at,
              saveAs: "reminder",
              onResult: toast("Напомним перед открытием"),
              onCancel: toast("Не удалось поставить напоминание", "warning"),
            },
            "secondary",
            { icon: "bell" },
          ),
        ]
        : []),
    ], { radius: 22 });
  }
  const place = waiting + 1;
  return card([
    row([
      tile("🙋", "accent", 52),
      hgap(14),
      expanded(col([
        t("Встать в очередь", "heading"),
        gap(3),
        t(
          waiting
            ? `Сейчас ${people(waiting)} · вы будете ${place}-м`
            : "Очередь пуста — вы будете первым",
          "caption",
          "muted",
        ),
      ])),
    ]),
    gap(14),
    {
      type: "appInputField",
      stateKey: "joinNote",
      placeholder: "Что сдаёте — необязательно",
      leadingIcon: "pencil",
      maxLength: 60,
    },
    gap(10),
    btn(
      "Встать в очередь",
      api(
        "/api/join",
        { code, note: "{{state.joinNote}}" },
        multi(
          set("joinNote", ""),
          toast("Вы в очереди · {{state.res.position}}-е место"),
          reload,
          haptic("medium"),
        ),
      ),
      "primary",
      { icon: "plus", size: "large", loadingLabel: "Записываем…" },
    ),
    gap(8),
    t(
      "Ваше имя и точное время записи увидят участники очереди.",
      "caption",
      "muted",
      { align: "center" },
    ),
  ], { radius: 22 });
}

function ownerPanel(q: Json, ctx: Ctx): Node {
  const code = string(q.code);
  const status = statusView(q, ctx.now);
  const counts = object(q.counts);
  const waiting = number(counts.waiting, 0);
  const current = number(counts.current, 0);
  const next = string(q.next_name);
  const finished = status.key === "finished";
  const nowName = string(object(list(q.current_list)[0]).name);
  const callLabel = current
    ? next ? "Принять и позвать" : "Принять сдачу"
    : "Позвать следующего";
  const flow = [
    nowName ? `Сейчас: ${nowName}` : "",
    next ? `дальше: ${next}` : "",
  ].filter(Boolean).join(" · ");
  return card([
    row([
      expanded(t("Управление", "headlineStrong")),
      tag("Вы создатель", "accent"),
    ]),
    gap(4),
    t(
      q.mode === "owner"
        ? "Вы задаёте порядок. Все действия попадают в историю."
        : "Порядок — по времени записи. Вы вызываете участников и отмечаете неявку.",
      "caption",
      "muted",
    ),
    ...(!finished && (waiting || current)
      ? [
        gap(14),
        ...(flow ? [t(flow, "caption", "ink", { maxLines: 2 }), gap(8)] : []),
        btn(
          callLabel,
          api(
            "/api/next",
            { code },
            done(next ? `Позвали: ${next}` : "Отмечено"),
          ),
          "primary",
          { icon: "bell", size: "large", loadingLabel: "Зовём…" },
        ),
      ]
      : []),
    ...(!finished && q.mode === "owner" && waiting >= 2
      ? [
        gap(8),
        btn(
          "Тянуть жребий",
          confirm(
            "Перемешать участников?",
            "Порядок ожидающих станет случайным. Каждый получит уведомление, а в истории появится запись.",
            "Перемешать",
            api("/api/shuffle", { code }, done("Порядок перемешан")),
          ),
          "outline",
          { icon: "refresh" },
        ),
      ]
      : []),
    ...(!finished
      ? [
        gap(12),
        {
          type: "appToggle",
          value: q.status === "open",
          label: "Запись открыта",
          onChange: api(
            "/api/status",
            { code, status: q.status === "open" ? "closed" : "open" },
            done(q.status === "open" ? "Запись закрыта" : "Запись открыта"),
          ),
        },
      ]
      : []),
    gap(12),
    wrap([
      small(
        "Настройки",
        open(`/edit?code=${code}`, "Настройки очереди"),
        "settings",
      ),
      small(
        "Новый круг",
        confirm(
          "Начать новый круг?",
          "Список очистится, код и QR останутся прежними — удобно для еженедельных сдач. История сохранится.",
          "Очистить",
          api("/api/reset", { code }, done("Очередь очищена")),
          true,
        ),
        "refresh",
      ),
      finished
        ? small(
          "Открыть снова",
          api(
            "/api/status",
            { code, status: "open" },
            done("Очередь снова открыта"),
          ),
          "lock",
        )
        : small(
          "Завершить",
          confirm(
            "Завершить очередь?",
            "Записаться и двигаться будет нельзя. Итоги и история останутся, открыть снова можно в любой момент.",
            "Завершить",
            api(
              "/api/status",
              { code, status: "finished" },
              done("Очередь завершена"),
            ),
            true,
          ),
          "check",
        ),
      ...(waiting + current === 0
        ? [small(
          "Удалить",
          confirm(
            "Удалить очередь?",
            "Очередь, её код и история исчезнут для всех. Это действие нельзя отменить.",
            "Удалить",
            api(
              "/api/delete",
              { code },
              multi(toast("Очередь удалена"), goHome),
            ),
            true,
          ),
          "trash",
        )]
        : []),
    ], 6),
  ], { radius: 22 });
}

function entrySheet(
  q: Json,
  seed: Json,
  title: string,
  subtitle: string,
): Node {
  const code = string(q.code);
  const close = (message: string) =>
    multi(toast(message), pop, reload, haptic());
  return {
    actionType: "openSheet",
    title,
    subtitle,
    child: {
      type: "appStateScope",
      initial: { res: null, ...seed },
      child: col([
        ...(q.mode === "owner"
          ? [{
            type: "appIf",
            condition: "!state.current && state.pos > 1",
            child: col([
              btn(
                "Поднять в начало",
                api(
                  "/api/move",
                  { code, entry: "{{state.id}}", to: 1 },
                  close("Участник теперь первый"),
                ),
                "secondary",
                { icon: "chevronU" },
              ),
              gap(8),
            ]),
          }]
          : []),
        btn(
          "{{state.current ? 'Не пришёл — в конец очереди' : 'Отправить в конец'}}",
          api(
            "/api/skip",
            { code, entry: "{{state.id}}" },
            close("Участник перенесён в конец"),
          ),
          "outline",
          { icon: "chevronD" },
        ),
        gap(8),
        btn(
          "Убрать из очереди",
          confirm(
            "Убрать участника?",
            "{{state.name}} получит уведомление, а в истории появится запись.",
            "Убрать",
            api(
              "/api/remove",
              { code, entry: "{{state.id}}" },
              close("Участник убран"),
            ),
            true,
          ),
          "destructiveOutline",
          { icon: "close" },
        ),
        gap(12),
        t("Каждое действие видно участникам в истории.", "caption", "muted", {
          align: "center",
        }),
      ]),
    },
  };
}

export function entryItem(e: Json, queueGroup = ""): Json {
  const group = string(e.group);
  return {
    id: string(e.id),
    name: string(e.name),
    pos: number(e.pos, 0),
    pos_label: `${number(e.pos, 0)}`,
    me: e.me === true,
    moved: e.moved === true,
    note: string(e.note),
    details: [
      string(e.joined_label) ? `запись ${string(e.joined_label)}` : "",
      group && group !== queueGroup ? group : "",
    ].filter(Boolean).join(" · "),
  };
}

function entryTemplate(q: Json, total: number): Node {
  const owner = q.is_owner === true;
  const code = string(q.code);
  const move = (to: string, icon: string, tooltip: string) =>
    iconButton(
      icon,
      tooltip,
      api(
        "/api/move",
        { code, entry: "{{item.id}}", to },
        multi(reload, haptic("selection")),
      ),
      "plain",
      { size: "compact" },
    );
  const actions = entrySheet(
    q,
    {
      id: "{{item.id}}",
      name: "{{item.name}}",
      pos: "{{item.pos}}",
      current: false,
    },
    "{{item.name}}",
    "Место {{item.pos_label}}",
  );
  const controls: Node[] = !owner ? [] : q.mode === "owner"
    ? [
      hgap(4),
      {
        type: "appIf",
        condition: "item.pos > 1",
        child: move("{{item.pos - 1}}", "chevronU", "Выше"),
      },
      {
        type: "appIf",
        condition: `item.pos < ${total}`,
        child: move("{{item.pos + 1}}", "chevronD", "Ниже"),
      },
    ]
    : [
      hgap(4),
      iconButton("more", "Действия", actions, "plain", { size: "compact" }),
    ];
  return col([
    {
      type: "appCard",
      padding: 12,
      radius: 16,
      tinted: "{{item.me}}",
      semanticsLabel: "{{item.pos_label}}. {{item.name}}",
      ...(owner ? { onTap: actions } : {}),
      child: row([
        {
          type: "appIconTile",
          size: 38,
          radius: 12,
          color: "{{item.pos == 1 ? 'warn' : item.me ? 'accent' : 'muted'}}",
          child: dyn(
            "{{item.pos_label}}",
            "labelStrong",
            "{{item.pos == 1 ? 'warn' : item.me ? 'accent' : 'ink'}}",
          ),
        },
        hgap(12),
        expanded(col([
          row([
            {
              type: "flexible",
              child: dyn("{{item.name}}", "labelStrong", undefined, {
                maxLines: 1,
              }),
            },
            {
              type: "appIf",
              condition: "item.me",
              child: row([hgap(6), badge("вы", "accent")], {
                mainAxisSize: "min",
              }),
            },
          ]),
          gap(2),
          dyn("{{item.details}}", "caption", "muted", { maxLines: 1 }),
          {
            type: "appIf",
            condition: "item.moved",
            child: col([
              gap(6),
              wrap([badge("перемещён", "warn", "swap")], 6),
            ]),
          },
          {
            type: "appIf",
            condition: "item.note != ''",
            child: col([
              gap(4),
              dyn("«{{item.note}}»", "caption", "ink", { maxLines: 2 }),
            ]),
          },
        ])),
        ...controls,
      ]),
    },
    gap(8),
  ]);
}

function currentCard(q: Json, e: Json): Node {
  const owner = q.is_owner === true;
  return {
    type: "appCard",
    padding: 14,
    radius: 18,
    tinted: true,
    semanticsLabel: `Сейчас сдаёт ${string(e.name)}`,
    child: row([
      avatar(e.name, 44),
      hgap(12),
      expanded(col([
        { type: "appLiveBadge", label: "Сдаёт сейчас" },
        gap(6),
        t(e.name, "headlineStrong", undefined, { maxLines: 1 }),
        gap(2),
        t(
          [
            string(e.called_label) ? `с ${string(e.called_label)}` : "",
            string(e.group),
            string(e.note) ? `«${string(e.note)}»` : "",
          ].filter(Boolean).join(" · "),
          "caption",
          "muted",
          { maxLines: 2 },
        ),
      ], { crossAxisAlignment: "start" })),
      ...(owner
        ? [
          hgap(4),
          iconButton(
            "more",
            "Действия",
            entrySheet(
              q,
              {
                id: string(e.id),
                name: string(e.name),
                pos: 0,
                current: true,
              },
              string(e.name),
              "Сейчас сдаёт",
            ),
            "plain",
            { size: "compact" },
          ),
        ]
        : []),
    ]),
  };
}

function eventRows(events: Json[], ctx: Ctx): Node {
  return {
    type: "appListGroup",
    showDividers: true,
    children: events.map((raw, i) => {
      const ev = eventView(raw, ctx.now);
      return {
        type: "appListRow",
        title: string(ev.title),
        subtitle: string(ev.subtitle),
        meta: string(ev.at),
        icon: string(ev.icon),
        iconColor: string(ev.color),
        isFirst: i === 0,
        dense: true,
        showChevron: false,
        strong: ev.mine === true,
      };
    }),
  };
}

function rulesCard(q: Json): Node {
  const mode = modes[string(q.mode)] ?? modes.join;
  const shuffles = number(q.shuffles, 0), moves = number(q.moves, 0);
  return card([
    row([
      iconTile("shield", "accent", 36),
      hgap(12),
      expanded(t(`Правила: ${mode.title.toLowerCase()}`, "labelStrong")),
    ]),
    gap(10),
    t(mode.rule, "caption", "muted"),
    gap(6),
    t(
      "Время записи ставит сервер с точностью до секунды — подделать его нельзя.",
      "caption",
      "muted",
    ),
    ...(shuffles || moves
      ? [
        gap(10),
        wrap([
          ...(moves
            ? [badge(`Ручных изменений: ${moves}`, "warn", "swap")]
            : []),
          ...(shuffles
            ? [badge(`Жребий: ${shuffles}`, "warn", "refresh")]
            : []),
        ], 6),
      ]
      : []),
  ]);
}

function notFound(): Node {
  return shell([
    gap(24),
    empty(
      "Очередь не найдена",
      "Проверьте код — возможно, создатель удалил очередь.",
      btn("На главную", goHome, "secondary", { icon: "home" }),
      "🔎",
    ),
  ]);
}

function queuePage(state: Json, ctx: Ctx): Node {
  const raw = state.queue ? object(state.queue) : null;
  if (!raw || !string(raw.code)) return notFound();
  const q = presentQueue(raw, ctx.now);
  const status = statusView(q, ctx.now);
  const waiting = list(q.waiting_list);
  const current = list(q.current_list);
  const doneList = list(q.done_list);
  const events = list(q.events);
  const my = q.my ? object(q.my) : null;
  if (my && my.state === "waiting") {
    const ahead = number(my.pos, 1) - 1;
    const avg = q.avg == null ? null : number(q.avg, 0);
    if (avg) {
      const seconds = (ahead + (current.length ? 0.5 : 0)) * avg;
      q.my_eta = seconds < 60
        ? "Совсем скоро — будьте рядом"
        : `Примерно через ${
          seconds < 3600
            ? `${Math.round(seconds / 60)} мин`
            : `${Math.floor(seconds / 3600)} ч ${
              Math.round((seconds % 3600) / 60)
            } мин`
        } · по среднему темпу`;
    }
  }
  const opens = toTime(q.opens_at);
  const active = waiting.length + current.length > 0;
  const refresh = status.key === "finished"
    ? 0
    : active || (opens != null && opens - ctx.now < 30 * 60000)
    ? 5
    : 15;
  const mine = myCard(q, ctx);
  return shell([
    headerCard(q, ctx),
    gap(12),
    ...(q.is_owner === true ? [ownerPanel(q, ctx), gap(12)] : []),
    ...(mine ? [mine, gap(12)] : []),
    shareCard(q, ctx),
    ...(current.length
      ? [
        section("Сейчас", undefined),
        ...current.flatMap((e) => [currentCard(q, e), gap(8)]),
      ]
      : []),
    section(
      "Очередь",
      q.mode === "owner" ? "Порядок задаёт создатель" : "По времени записи",
      { meta: `${waiting.length}` },
    ),
    ...(waiting.length
      ? [{
        type: "appForEach",
        items: "state.waiting",
        as: "column",
        template: entryTemplate(q, waiting.length),
      }]
      : [
        card([
          t(
            status.key === "finished"
              ? "Никого не осталось — очередь завершена."
              : current.length
              ? "Больше никого — после текущего участника очередь пуста."
              : "Пока никого. Поделитесь кодом, чтобы позвать одногруппников.",
            "caption",
            "muted",
            { align: "center" },
          ),
        ]),
      ]),
    ...(doneList.length
      ? [
        gap(10),
        {
          type: "appChip",
          label: `Сдали · ${doneList.length}`,
          leadingIcon: "check",
          selected: "{{state.doneOpen}}",
          onTap: { actionType: "setState", key: "doneOpen", toggle: true },
        },
        {
          type: "appIf",
          condition: "state.doneOpen",
          child: col([
            gap(10),
            {
              type: "appListGroup",
              showDividers: true,
              children: doneList.map((e, i) => ({
                type: "appListRow",
                title: string(e.name),
                subtitle: [
                  string(e.called_label) && string(e.ended_label)
                    ? `${string(e.called_label)} → ${string(e.ended_label)}`
                    : string(e.ended_label),
                  string(e.took_label),
                ].filter(Boolean).join(" · "),
                leading: avatar(e.name, 36),
                isFirst: i === 0,
                dense: true,
                showChevron: false,
                strong: e.me === true,
              })),
            },
          ]),
        },
      ]
      : []),
    section("История", "Каждое действие видно всем участникам", {
      ...(number(q.events_total, 0) > events.length
        ? {
          action: "Вся",
          onActionTap: open(`/history?code=${string(q.code)}`, "История"),
        }
        : {}),
    }),
    eventRows(events, ctx),
    gap(12),
    rulesCard(q),
  ], {
    waiting: waiting.map((e) => entryItem(e, string(q.group_name))),
    doneOpen: false,
    noteOpen: false,
    myNote: my ? string(my.note) : "",
    joinNote: "",
    reminder: null,
  }, refresh);
}

function historyPage(state: Json, ctx: Ctx): Node {
  const raw = state.queue ? object(state.queue) : null;
  if (!raw || !string(raw.code)) return notFound();
  const q = presentQueue(raw, ctx.now);
  const events = list(q.events);
  const kinds = (names: string[]) =>
    events.filter((e) => names.includes(string(e.kind))).length;
  return shell([
    card([
      t(q.title, "headlineStrong"),
      gap(4),
      t(
        `${
          count(number(q.events_total, 0), ["событие", "события", "событий"])
        } · создана ${string(q.created_label)}`,
        "caption",
        "muted",
      ),
      gap(12),
      row([
        statBlock(`${kinds(["joined"])}`, "записей"),
        statBlock(`${kinds(["called"])}`, "вызовов"),
        statBlock(
          `${kinds(["moved", "skipped", "removed", "shuffled"])}`,
          "правок",
          "warn",
        ),
      ], { crossAxisAlignment: "start" }),
    ]),
    section("Все события", "Сначала новые"),
    ...(events.length ? [eventRows(events, ctx)] : [
      empty(
        "Событий пока нет",
        "Здесь появится каждое действие в очереди.",
        undefined,
        "📜",
      ),
    ]),
  ]);
}

function editPage(state: Json, ctx: Ctx): Node {
  const raw = state.queue ? object(state.queue) : null;
  if (!raw || !string(raw.code)) return notFound();
  const q = presentQueue(raw, ctx.now);
  const me = object(state.me);
  if (q.is_owner !== true) {
    return shell([
      gap(24),
      empty(
        "Только для создателя",
        "Настройки очереди может менять только тот, кто её создал.",
        btn("К очереди", pop, "secondary"),
        "🔒",
      ),
    ]);
  }
  const code = string(q.code);
  const opens = toTime(q.opens_at);
  const scheduled = opens != null && opens > ctx.now;
  const openingIso = scheduled
    ? new Date(opens as number).toISOString()
    : "now";
  const save = api(
    "/api/edit",
    {
      code,
      title: "{{state.title}}",
      note: "{{state.note}}",
      mode: "{{state.mode}}",
      opens: "{{state.opens}}",
      capacity: "{{state.limit ? state.capacity : 0}}",
      group: "{{state.group}}",
    },
    multi(toast("Настройки сохранены"), pop, reload, haptic()),
  );
  const hasGroup = me.has_group === true;
  return shell([
    card([
      {
        type: "appInputField",
        stateKey: "title",
        label: "Название",
        maxLength: 80,
      },
      gap(12),
      {
        type: "appInputField",
        stateKey: "note",
        label: "Комментарий",
        placeholder: "Аудитория, что сдаём, правила",
        multiline: true,
        minLines: 2,
        maxLines: 5,
        maxLength: 280,
        showCounter: false,
      },
    ]),
    section("Порядок", "Смена режима попадёт в историю"),
    modeOption("join"),
    gap(8),
    modeOption("owner"),
    section(
      "Когда открыть запись",
      scheduled ? `Сейчас: откроется ${string(q.opens_label)}` : undefined,
    ),
    ...openingPicker(ctx.now),
    section("Участники"),
    card([
      { type: "appToggle", stateKey: "limit", label: "Ограничить число мест" },
      {
        type: "appIf",
        condition: "state.limit",
        child: col([
          gap(10),
          row([
            expanded(t("Мест в очереди", "body")),
            { type: "appStepper", stateKey: "capacity", min: 2, max: 200 },
          ]),
        ]),
      },
      ...((hasGroup || string(q.group_name))
        ? [
          gap(10),
          {
            type: "appToggle",
            stateKey: "group",
            label: `Показать группе ${
              safeText(string(q.group_name) || string(me.group))
            }`,
          },
        ]
        : []),
    ]),
    gap(18),
    btn(
      "Сохранить",
      runIf(
        "len(trim(state.title)) < 2",
        toast("Добавьте название — хотя бы 2 символа", "warning"),
        save,
      ),
      "primary",
      { icon: "check", size: "large", loadingLabel: "Сохраняем…" },
    ),
  ], {
    title: string(q.title),
    note: string(q.note),
    mode: string(q.mode) || "join",
    opens: openingIso,
    customIso: scheduled ? openingIso : "",
    customLabel: scheduled ? string(q.opens_label) : "",
    customRaw: "",
    custom: null,
    limit: q.capacity != null && number(q.capacity, 0) > 0,
    capacity: number(q.capacity, 0) || 25,
    group: string(q.group_name) !== "",
  });
}

export function buildScreen(
  path: string,
  stateInput: unknown,
  extra: Json = {},
): Node {
  const state = object(stateInput);
  const ctx: Ctx = {
    code: string(extra.code),
    now: number(extra.now, Date.now()),
    publicBase: string(extra.publicBase),
  };
  if (path === "/") return home(state, ctx);
  if (path === "/new") return newQueue(state, ctx);
  if (path === "/q") return queuePage(state, ctx);
  if (path === "/history") return historyPage(state, ctx);
  if (path === "/edit") return editPage(state, ctx);
  return shell([
    gap(24),
    empty(
      "Страница не найдена",
      "Вернитесь к списку очередей.",
      btn("К очередям", goHome, "secondary"),
      "🧭",
    ),
  ]);
}
