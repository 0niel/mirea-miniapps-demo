import { buildScreen } from "./screens.ts";
import type { Json } from "./domain.ts";
import * as fx from "./fixtures.ts";

const assert = (v: unknown, message = "Assertion failed") => {
  if (!v) throw new Error(message);
};
const widgets = new Set(
  "center appAvatar appBadge appBanner appButton appCard appChip appEmptyState appExpandableText appForEach appIconButton appIconTile appIf appImage appInputField appLineIcon appListGroup appListRow appLiveBadge appMetaPill appProgressRing appSectionTitle appStateScope appStepper appTag appText appToggle column expanded flexible row scaffold singleChildScrollView sizedBox wrap"
    .split(" "),
);
const actions = new Set(
  "confirm copyToClipboard fetch hapticFeedback multiAction networkRequest openPage openSheet pickDateTime pop reload runIf scanCode scheduleReminder setState share showToast"
    .split(" "),
);
const ctx = { now: fx.now, publicBase: "https://project.supabase.co" };
function nodes(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value as Json, ...Object.values(value).flatMap(nodes)];
}
const has = (screen: Json, needle: string) =>
  JSON.stringify(screen).includes(needle);
const find = (screen: Json, predicate: (n: Json) => boolean) =>
  nodes(screen).filter(predicate);
const requests = (screen: Json, url: string) =>
  find(screen, (n) => n.actionType === "networkRequest" && n.url === url);

const screens: [string, string, Json, Json?][] = [
  ["home", "/", fx.home],
  ["home-empty", "/", fx.emptyHome],
  ["new", "/new", fx.newState],
  ["new-no-group", "/new", {
    me: fx.newcomer,
    subjects: [],
    active_owned: 13,
    recent_titles: [],
  }],
  ["queue", "/q", fx.queueState, { code: fx.code }],
  ["queue-owner", "/q", fx.ownerQueueState, { code: fx.ownedCode }],
  ["queue-called", "/q", fx.calledState, { code: fx.code }],
  ["queue-visitor", "/q", fx.visitorState, { code: fx.code }],
  ["queue-scheduled", "/q", fx.scheduledState, { code: "S9H7DL" }],
  ["queue-finished", "/q", fx.finishedState, { code: "ARCH1V" }],
  ["queue-missing", "/q", { me: fx.me, queue: null }],
  ["history", "/history", fx.queueState, { code: fx.code }],
  ["edit", "/edit", fx.ownerQueueState, { code: fx.ownedCode }],
  ["edit-foreign", "/edit", fx.queueState, { code: fx.code }],
];

Deno.test("every screen uses only registered widgets and actions", () => {
  for (const [name, path, state, extra] of screens) {
    const screen = buildScreen(path, state, { ...ctx, ...extra });
    assert(screen.type === "scaffold", name);
    for (const n of nodes(screen)) {
      if (typeof n.actionType === "string") {
        assert(actions.has(n.actionType), `${name}: ${n.actionType}`);
      } else if (typeof n.type === "string") {
        assert(widgets.has(n.type), `${name}: ${n.type}`);
      }
    }
    assert(JSON.stringify(screen).length < 200000, name);
  }
});

Deno.test("home joins by code or QR and lists every kind of queue", () => {
  const screen = buildScreen("/", fx.home, ctx);
  assert(
    find(screen, (n) => n.type === "appInputField" && n.stateKey === "code")
      .length === 1,
  );
  assert(
    find(screen, (n) => n.actionType === "scanCode" && n.saveAs === "scan")
      .length === 1,
  );
  assert(requests(screen, "/api/resolve").length >= 2);
  assert(
    find(
      screen,
      (n) =>
        n.actionType === "openPage" &&
        n.path === "/q?code={{state.found.code}}",
    )
      .length >= 2,
  );
  assert(has(screen, "Ваша очередь!"));
  assert(has(screen, "Перед вами 2 человека · ≈ через 18 мин"));
  assert(has(screen, "Мои очереди") && has(screen, "M3N 8RT"));
  assert(has(screen, "Группа ИКБО-01-23"));
  assert(requests(screen, "/api/join").length === 1);
  assert(has(screen, "Откроется сегодня в 13:40"));
  assert(has(screen, "Недавние") && has(screen, "Завершённые · 1"));
  assert(screen.refreshIntervalSeconds === 10);
  assert(
    find(screen, (n) => n.type === "appProgressRing" && n.label === "3")
      .length === 1,
  );
});

Deno.test("empty home onboards without a group", () => {
  const screen = buildScreen("/", fx.emptyHome, ctx);
  assert(has(screen, "Пока нет очередей"));
  assert(has(screen, "Как это работает"));
  assert(!has(screen, "Группа "));
  assert(screen.refreshIntervalSeconds === 30);
});

Deno.test("create form offers subjects, modes, opening slots and limits", () => {
  const screen = buildScreen("/new", fx.newState, ctx);
  const chips = find(screen, (n) => n.type === "appChip").map((n) => n.label);
  assert(chips.includes("Физика · 12:40"));
  assert(chips.includes("Матанализ — защита ДЗ"));
  assert(
    !chips.filter((c) => c === "Физика — лаба 3").length ||
      chips.includes("Физика — лаба 3"),
  );
  assert(
    chips.includes("Сразу") && chips.includes("12:40") &&
      chips.includes("18:00"),
  );
  assert(
    has(screen, "По времени записи") && has(screen, "Порядок задаёт создатель"),
  );
  assert(
    find(screen, (n) => n.type === "appStepper" && n.stateKey === "capacity")
      .length === 1,
  );
  assert(has(screen, "Показать группе ИКБО-01-23"));
  const create = requests(screen, "/api/create")[0];
  assert(
    create &&
      object(create.body).capacity === "{{state.limit ? state.capacity : 0}}",
  );
  assert(has(screen, "/q?code={{state.created.code}}"));
  assert(
    find(screen, (n) => n.actionType === "fetch" && n.path === "/api/when")
      .length === 1,
  );
  const scope = object(object(screen.body).initial);
  assert(
    scope.group === true && scope.mode === "join" && scope.opens === "now",
  );
  const blank = buildScreen("/new", {
    me: fx.newcomer,
    subjects: [],
    active_owned: 13,
    recent_titles: [],
  }, ctx);
  assert(has(blank, "Выберите группу в расписании"));
  assert(has(blank, "13 активных очередей из 15"));
  assert(!has(blank, "Показать группе"));
});

Deno.test("participant sees place, pace, share tools and history", () => {
  const screen = buildScreen("/q", fx.queueState, { ...ctx, code: fx.code });
  assert(screen.refreshIntervalSeconds === 5);
  assert(
    find(
      screen,
      (n) =>
        n.type === "appProgressRing" && n.label === "3" &&
        n.sublabel === "место",
    )
      .length === 1,
  );
  assert(has(screen, "Перед вами 2 человека"));
  assert(has(screen, "Примерно через 18 мин"));
  assert(requests(screen, "/api/let_ahead").length === 1);
  assert(requests(screen, "/api/leave").length >= 1);
  assert(requests(screen, "/api/note").length === 1);
  assert(
    !requests(screen, "/api/next").length &&
      !requests(screen, "/api/move").length,
  );
  assert(
    find(
      screen,
      (n) => n.type === "appImage" && String(n.src).endsWith("/qr/K7F2QX.png"),
    )
      .length === 1,
  );
  assert(
    find(
      screen,
      (n) => n.actionType === "share" && String(n.text).includes("K7F 2QX"),
    ).length ===
      1,
  );
  assert(has(screen, "Сдаёт сейчас") && has(screen, "Петров Илья"));
  assert(has(screen, "запись 11:48:14"));
  assert(has(screen, "перемещён"));
  assert(has(screen, "Сдали · 4"));
  assert(has(screen, "Петров Илья · автоматически"));
  assert(has(screen, "Вся"));
  assert(has(screen, "Время записи ставит сервер"));
});

Deno.test("owner gets calling, ordering and lifecycle controls", () => {
  const screen = buildScreen("/q", fx.ownerQueueState, {
    ...ctx,
    code: fx.ownedCode,
  });
  assert(has(screen, "Принять и позвать"));
  assert(has(screen, "Сейчас: Петров Илья · дальше: Смирнова Алина"));
  assert(requests(screen, "/api/next").length === 1);
  assert(requests(screen, "/api/shuffle").length === 1);
  assert(requests(screen, "/api/move").length === 4);
  assert(requests(screen, "/api/skip").length === 2);
  assert(requests(screen, "/api/remove").length === 2);
  assert(requests(screen, "/api/status").length === 2);
  assert(requests(screen, "/api/reset").length === 1);
  assert(!requests(screen, "/api/delete").length);
  const sheets = find(screen, (n) => n.actionType === "openSheet");
  assert(sheets.length === 2);
  assert(sheets.every((n) => object(n.child).type === "appStateScope"));
  assert(object(object(sheets[1].child).initial).id === "{{item.id}}");
  const list = find(screen, (n) => n.type === "appForEach")[0];
  assert(list && list.items === "state.waiting");
  const items = object(object(screen.body).initial).waiting as Json[];
  assert(
    items.length === 9 && items[0].pos === 1 &&
      items[0].name === "Смирнова Алина",
  );
  assert(JSON.stringify(screen).length < 60000);
  assert(has(screen, "Ручных изменений: 3") && has(screen, "Жребий: 1"));
  assert(has(screen, "10/30 мест"));
  const joinMode = buildScreen("/q", {
    ...fx.ownerQueueState,
    queue: { ...object(fx.ownerQueueState.queue), mode: "join" },
  }, { ...ctx, code: fx.ownedCode });
  assert(!requests(joinMode, "/api/shuffle").length);
  assert(!requests(joinMode, "/api/move").length);
  assert(requests(joinMode, "/api/skip").length === 3);
});

Deno.test("called participant can finish or leave", () => {
  const screen = buildScreen("/q", fx.calledState, { ...ctx, code: fx.code });
  assert(has(screen, "Ваша очередь!"));
  assert(requests(screen, "/api/done").length === 1);
  assert(!requests(screen, "/api/let_ahead").length);
});

Deno.test("visitors can join with a note, scheduled queues offer a reminder", () => {
  const visitor = buildScreen("/q", fx.visitorState, { ...ctx, code: fx.code });
  const join = requests(visitor, "/api/join")[0];
  assert(join && object(join.body).note === "{{state.joinNote}}");
  assert(has(visitor, "вы будете 10-м"));
  const scheduled = buildScreen("/q", fx.scheduledState, {
    ...ctx,
    code: "S9H7DL",
  });
  assert(has(scheduled, "Запись откроется сегодня в 12:50"));
  const reminder =
    find(scheduled, (n) => n.actionType === "scheduleReminder")[0];
  assert(reminder && reminder.when === "2026-09-23T09:45:00.000Z");
  assert(!requests(scheduled, "/api/join").length);
  assert(scheduled.refreshIntervalSeconds === 5);
  const finished = buildScreen("/q", fx.finishedState, {
    ...ctx,
    code: "ARCH1V",
  });
  assert(has(finished, "Очередь завершена"));
  assert(!finished.refreshIntervalSeconds);
  assert(has(finished, "Автоматически: 3 дня без активности"));
});

Deno.test("missing queues and foreign edits fall back safely", () => {
  assert(
    has(
      buildScreen("/q", { me: fx.me, queue: null }, ctx),
      "Очередь не найдена",
    ),
  );
  assert(has(buildScreen("/edit", fx.queueState, ctx), "Только для создателя"));
  const edit = buildScreen("/edit", fx.ownerQueueState, {
    ...ctx,
    code: fx.ownedCode,
  });
  const scope = object(object(edit.body).initial);
  assert(scope.title === "Матанализ — защита ДЗ" && scope.mode === "owner");
  assert(scope.limit === true && scope.capacity === 30);
  assert(requests(edit, "/api/edit").length === 1);
  const history = buildScreen("/history", fx.queueState, {
    ...ctx,
    code: fx.code,
  });
  assert(has(history, "31 событие"));
  assert(
    find(history, (n) => n.type === "appListRow").length === fx.events.length,
  );
});

Deno.test("user text never becomes a template", () => {
  const evil = "{{state.secret}}";
  const screen = buildScreen("/q", {
    me: fx.me,
    queue: {
      ...object(fx.queueState.queue),
      title: evil,
      note: evil,
      owner_name: evil,
      waiting: fx.waiting.map((e) => ({ ...e, name: evil, note: evil })),
    },
  }, { ...ctx, code: fx.code });
  assert(!has(screen, "{{state.secret"));
});

function object(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
}
