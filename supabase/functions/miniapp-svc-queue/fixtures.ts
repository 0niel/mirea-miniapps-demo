import type { Json } from "./domain.ts";

export const now = Date.UTC(2026, 8, 23, 9, 30, 0);
export const at = (minutes: number, seconds = 0) =>
  new Date(now - minutes * 60000 + seconds * 1000).toISOString();
export const code = "K7F2QX";
export const ownedCode = "M3N8RT";
export const me: Json = {
  name: "Дмитриев Сергей",
  group: "ИКБО-01-23",
  has_group: true,
};
export const newcomer: Json = {
  name: "Студент #4F9D",
  group: null,
  has_group: false,
};

const card = (extra: Json): Json => ({
  code,
  title: "Физика — лаба 3",
  note: "Ауд. А-214. Сдаём по две лабы за подход.",
  mode: "join",
  status: "open",
  group_name: "ИКБО-01-23",
  opens_at: null,
  capacity: null,
  owner_name: "Иванова Анна",
  is_owner: false,
  waiting: 9,
  done: 4,
  current_name: "Петров Илья",
  my_state: null,
  my_pos: null,
  my_called_at: null,
  avg_seconds: 420,
  updated_at: at(1),
  finished_at: null,
  ...extra,
});

export const mine = card({ my_state: "waiting", my_pos: 3 });
export const called = card({
  code: "C4LL3D",
  title: "Информатика — зачёт",
  my_state: "current",
  my_pos: null,
  my_called_at: at(2),
  current_name: "Дмитриев Сергей",
  waiting: 6,
});
export const owned = card({
  code: ownedCode,
  title: "Матанализ — защита ДЗ",
  note: "",
  mode: "owner",
  owner_name: "Дмитриев Сергей",
  is_owner: true,
  waiting: 12,
  done: 0,
  current_name: null,
  avg_seconds: null,
});
export const groupOpen = card({
  code: "Q2W4ZP",
  title: "Программирование — лаба 5",
  owner_name: "Кузнецов Артём",
  waiting: 5,
  done: 1,
  current_name: null,
});
export const groupScheduled = card({
  code: "S9H7DL",
  title: "Английский — устный зачёт",
  owner_name: "Лебедева Вера",
  opens_at: new Date(now + 70 * 60000).toISOString(),
  waiting: 0,
  done: 0,
  current_name: null,
});
export const recent = card({
  code: "R3C3NT",
  title: "Химия — отработка",
  group_name: null,
  owner_name: "Орлова Мария",
  status: "closed",
  waiting: 3,
});
export const archived = card({
  code: "ARCH1V",
  title: "Физика — лаба 2",
  status: "finished",
  finished_at: at(60 * 24 * 7),
  waiting: 0,
  done: 21,
});

export const home: Json = {
  me,
  mine: [called, mine],
  owned: [owned],
  group: [groupOpen, groupScheduled],
  recent: [recent],
  archive: [archived],
};
export const emptyHome: Json = {
  me: newcomer,
  mine: [],
  owned: [],
  group: [],
  recent: [],
  archive: [],
};

const names = [
  "Смирнова Алина",
  "Козлов Дмитрий",
  "Дмитриев Сергей",
  "Новикова Полина",
  "Морозов Кирилл",
  "Волкова Дарья",
  "Соколов Никита",
  "Лебедева Вера",
  "Егоров Марк",
];
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const waiting: Json[] = names.map((name, i) => ({
  id: id(i + 1),
  name,
  group: i === 6 ? "ИКБО-02-23" : "ИКБО-01-23",
  note: i === 0 ? "Лабы 3 и 4" : i === 3 ? "Только отчёт" : "",
  state: "waiting",
  pos: i + 1,
  joined_at: at(48 - i * 3, i * 7),
  called_at: null,
  ended_at: null,
  moved: i === 4,
  me: name === "Дмитриев Сергей",
}));
export const current: Json = {
  id: id(20),
  name: "Петров Илья",
  group: "ИКБО-01-23",
  note: "Лаба 3",
  state: "current",
  pos: null,
  joined_at: at(55),
  called_at: at(6),
  ended_at: null,
  moved: false,
  me: false,
};
export const doneList: Json[] = [
  ["Ковалёва Ирина", 13, 6],
  ["Попов Андрей", 21, 13],
  ["Зайцева Ксения", 28, 21],
  ["Фёдоров Глеб", 36, 28],
].map(([name, from, to], i) => ({
  id: id(30 + i),
  name,
  group: "ИКБО-01-23",
  note: "",
  state: "done",
  pos: null,
  joined_at: at(70 - i),
  called_at: at(from as number),
  ended_at: at(to as number),
  moved: false,
  me: false,
}));
export const events: Json[] = [
  {
    id: 30,
    kind: "called",
    actor: null,
    target: "Петров Илья",
    self: false,
    at: at(6),
  },
  {
    id: 29,
    kind: "done",
    actor: "Ковалёва Ирина",
    target: "Ковалёва Ирина",
    self: true,
    at: at(6, -2),
  },
  {
    id: 28,
    kind: "let_ahead",
    actor: "Новикова Полина",
    target: "Морозов Кирилл",
    from: 4,
    to: 5,
    at: at(9),
  },
  {
    id: 27,
    kind: "skipped",
    actor: "Иванова Анна",
    target: "Егоров Марк",
    actor_owner: true,
    from: 2,
    to: 9,
    at: at(15),
  },
  {
    id: 26,
    kind: "joined",
    actor: "Егоров Марк",
    target: "Егоров Марк",
    self: true,
    to: 9,
    at: at(24),
  },
  {
    id: 25,
    kind: "called",
    actor: "Иванова Анна",
    target: "Ковалёва Ирина",
    actor_owner: true,
    at: at(13),
  },
  {
    id: 24,
    kind: "joined",
    actor: "Дмитриев Сергей",
    target: "Дмитриев Сергей",
    self: true,
    to: 3,
    actor_me: true,
    target_me: true,
    at: at(42, 14),
  },
  {
    id: 1,
    kind: "created",
    actor: "Иванова Анна",
    actor_owner: true,
    at: at(90),
  },
];

export const queue: Json = {
  ...mine,
  created_at: at(90),
  round_started_at: at(90),
  counts: { waiting: 9, current: 1, done: 4, left: 1 },
  shuffles: 0,
  moves: 1,
  current: [current],
  waiting,
  done_list: doneList,
  my: waiting[2],
  events,
  events_total: 31,
};
export const queueState: Json = { me, queue };
export const ownerQueueState: Json = {
  me,
  queue: {
    ...queue,
    ...owned,
    counts: { waiting: 9, current: 1, done: 4, left: 1 },
    my: null,
    waiting: waiting.map((e) => ({ ...e, me: false })),
    shuffles: 1,
    moves: 3,
    capacity: 30,
  },
};
export const calledState: Json = {
  me,
  queue: {
    ...queue,
    my: { ...current, name: "Дмитриев Сергей", me: true },
    current: [{ ...current, name: "Дмитриев Сергей", me: true }],
    my_state: "current",
    my_pos: null,
  },
};
export const visitorState: Json = {
  me,
  queue: { ...queue, my: null, my_state: null, my_pos: null },
};
export const scheduledState: Json = {
  me,
  queue: {
    ...queue,
    ...groupScheduled,
    counts: { waiting: 0, current: 0, done: 0, left: 0 },
    current: [],
    waiting: [],
    done_list: [],
    my: null,
    opens_at: new Date(now + 20 * 60000).toISOString(),
    events: [events[7]],
    events_total: 1,
  },
};
export const finishedState: Json = {
  me,
  queue: {
    ...queue,
    ...archived,
    counts: { waiting: 0, current: 0, done: 21, left: 2 },
    current: [],
    waiting: [],
    my: null,
    events: [
      { id: 80, kind: "finished", actor: null, at: at(60 * 24) },
      ...events,
    ],
  },
};
export const newState: Json = {
  me,
  subjects: [
    { name: "Физика", today: true, time: "12:40:00", lab: true },
    { name: "Программирование", today: false, time: null, lab: true },
    { name: "Математический анализ", today: false, time: null, lab: false },
    { name: "Иностранный язык", today: false, time: null, lab: true },
  ],
  active_owned: 1,
  recent_titles: ["Физика — лаба 3", "Матанализ — защита ДЗ"],
};
