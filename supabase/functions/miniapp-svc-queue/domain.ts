export type Json = Record<string, unknown>;
export const slug = "queue";
export const appTitle = "Очереди";
export const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const codePattern = /^[2-9A-HJ-NP-Z]{6}$/;
const lookalikes: Record<string, string> = {
  "А": "A",
  "В": "B",
  "Е": "E",
  "К": "K",
  "М": "M",
  "Н": "H",
  "Р": "P",
  "С": "C",
  "Т": "T",
  "У": "Y",
  "Х": "X",
};

export class InputError extends Error {
  constructor(message = "Проверьте заполненные поля", public status = 422) {
    super(message);
  }
}
export const object = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
export const list = (v: unknown): Json[] =>
  Array.isArray(v) ? v.map(object) : [];
export const string = (v: unknown): string => typeof v === "string" ? v : "";
export const number = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : fallback;
export const safeText = (v: unknown): string =>
  string(v).replace(/\{\{/g, "｛｛").replace(/\}\}/g, "｝｝");
export const uuid = (v: unknown): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    string(v),
  );

export function textInput(
  v: unknown,
  min: number,
  max: number,
  multiline = false,
): string {
  const s = string(v).trim();
  if (
    [...s].length < min || [...s].length > max || /\{\{|\}\}/.test(s) ||
    [...s].some((c) => {
      const code = c.charCodeAt(0);
      return (code < 32 || code === 127) &&
        !(multiline && [9, 10, 13].includes(code));
    })
  ) throw new InputError();
  return s;
}

export function normalizeCode(raw: unknown): string | null {
  const cleaned = [...string(raw).toUpperCase()]
    .map((c) => lookalikes[c] ?? c)
    .join("")
    .replace(/[\s\-_.·•]/g, "");
  return codePattern.test(cleaned) ? cleaned : null;
}

export function extractCode(raw: unknown): string | null {
  let text = string(raw).trim();
  if (!text || text.length > 600) return null;
  for (let i = 0; i < 3; i++) {
    const match = /code=([A-Za-z0-9]{6})(?![A-Za-z0-9])/.exec(text);
    if (match) return normalizeCode(match[1]);
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return normalizeCode(text);
}

export function parseRoute(raw: unknown): { path: string; code: string } {
  const s = string(raw) || "/";
  if (
    !s.startsWith("/") || s.startsWith("//") || /[\\\r\n{}]/.test(s) ||
    s.length > 500 || /(?:^|\/)\.{1,2}(?:\/|\?|$)/.test(s)
  ) throw new InputError("Страница не найдена", 404);
  const url = new URL(s, "https://miniapp.invalid");
  return {
    path: url.pathname,
    code: normalizeCode(url.searchParams.get("code")) ?? "",
  };
}

export const queuePath = (code: string) => `/q?code=${code}`;
export const appLink = (page: string) =>
  `https://mirea.ninja/app/services/apps/${slug}/run?page=${
    encodeURIComponent(page)
  }`;
export const formatCode = (code: string) =>
  code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
export const count = (n: number, forms: [string, string, string]): string =>
  `${n} ${plural(n, forms)}`;
export const people = (n: number) =>
  count(n, ["человек", "человека", "человек"]);

export function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return b.length >= 20 && difference === 0;
}

const mskOffset = 3 * 60 * 60 * 1000;
const months = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];
const weekdays = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const pad = (n: number) => String(n).padStart(2, "0");
const msk = (time: number) => new Date(time + mskOffset);
const dayIndex = (time: number) => Math.floor((time + mskOffset) / 86400000);

export function toTime(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) {
    return Number.isFinite(v.getTime()) ? v.getTime() : null;
  }
  const time = Date.parse(string(v));
  return Number.isFinite(time) ? time : null;
}

export function clock(v: unknown, seconds = false): string {
  const time = toTime(v);
  if (time == null) return "";
  const d = msk(time);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${
    seconds ? ":" + pad(d.getUTCSeconds()) : ""
  }`;
}

export function dayLabel(v: unknown, now: number): string {
  const time = toTime(v);
  if (time == null) return "";
  const diff = dayIndex(time) - dayIndex(now);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  if (diff === -1) return "вчера";
  const d = msk(time);
  return `${weekdays[d.getUTCDay()]}, ${d.getUTCDate()} ${
    months[d.getUTCMonth()]
  }`;
}

export const whenLabel = (v: unknown, now: number): string =>
  toTime(v) == null ? "" : `${dayLabel(v, now)} в ${clock(v)}`;

export function stampLabel(v: unknown, now: number, seconds = false): string {
  const time = toTime(v);
  if (time == null) return "";
  if (dayIndex(time) === dayIndex(now)) return clock(time, seconds);
  const d = msk(time);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${clock(time)}`;
}

export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "меньше минуты";
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export function parseMoment(raw: unknown, now: number): number | null {
  const s = string(raw).trim();
  if (!s || s === "now") return null;
  const local =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/
      .exec(s);
  let time: number;
  if (local) {
    const [, y, mo, d, h, mi, sec] = local.map(Number);
    time = Date.UTC(y, mo - 1, d, h, mi, sec || 0) - mskOffset;
    const back = msk(time);
    if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) {
      throw new InputError("Некорректное время");
    }
  } else if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/
      .test(s)
  ) {
    time = Date.parse(s);
  } else throw new InputError("Некорректное время");
  if (!Number.isFinite(time)) throw new InputError("Некорректное время");
  if (time > now + 60 * 86400000) {
    throw new InputError("Можно запланировать не дальше чем на 60 дней");
  }
  return time <= now + 30000 ? null : time;
}

export const bells = [
  "09:00",
  "10:40",
  "12:40",
  "14:20",
  "16:20",
  "18:00",
  "19:40",
];

export function slots(now: number, limit = 4): Json[] {
  const result: Json[] = [];
  const today = dayIndex(now);
  for (const day of [today, today + 1]) {
    for (const bell of bells) {
      const [h, m] = bell.split(":").map(Number);
      const time = day * 86400000 + (h * 60 + m) * 60000 - mskOffset;
      if (time < now + 5 * 60000) continue;
      result.push({
        value: new Date(time).toISOString(),
        label: day === today ? bell : `завтра ${bell}`,
      });
      if (result.length >= limit) return result;
    }
  }
  return result;
}

export const modes: Record<
  string,
  { title: string; short: string; icon: string; rule: string }
> = {
  join: {
    title: "По времени записи",
    short: "По записи",
    icon: "clock",
    rule:
      "Место определяется моментом записи — время видно у каждого. Создатель не может переставлять участников, только вызывать следующего и отмечать неявку.",
  },
  owner: {
    title: "Порядок задаёт создатель",
    short: "Решает создатель",
    icon: "swap",
    rule:
      "Создатель может переставлять участников и тянуть жребий. Каждое перемещение сохраняется в истории, а участник получает уведомление.",
  },
};

export type StatusView = {
  key: "open" | "scheduled" | "closed" | "finished";
  label: string;
  tone: string;
  live: boolean;
};

export function statusView(q: Json, now: number): StatusView {
  const status = string(q.status);
  if (status === "finished") {
    return { key: "finished", label: "Завершена", tone: "mute", live: false };
  }
  if (status === "closed") {
    return {
      key: "closed",
      label: "Запись закрыта",
      tone: "warn",
      live: false,
    };
  }
  const opens = toTime(q.opens_at);
  if (opens != null && opens > now) {
    return {
      key: "scheduled",
      label: `Откроется ${whenLabel(opens, now)}`,
      tone: "info",
      live: false,
    };
  }
  return { key: "open", label: "Запись открыта", tone: "live", live: true };
}

export function etaLabel(ahead: number, avg: number | null, current: boolean) {
  if (avg == null || avg <= 0) return "";
  const seconds = (ahead + (current ? 0.5 : 0)) * avg;
  if (seconds < 60) return "совсем скоро";
  return `≈ через ${durationLabel(seconds)}`;
}

export function positionLabel(pos: number): string {
  return `${pos}-й`;
}

export function presentCard(raw: Json, now: number): Json {
  const status = statusView(raw, now);
  const waiting = number(raw.waiting, 0);
  const myState = string(raw.my_state);
  const myPos = number(raw.my_pos, 0);
  const avg = raw.avg_seconds == null ? null : number(raw.avg_seconds, 0);
  const current = string(raw.current_name) !== "";
  const ahead = Math.max(0, myPos - 1);
  const mode = modes[string(raw.mode)] ?? modes.join;
  return {
    ...raw,
    code: string(raw.code),
    title: safeText(raw.title),
    note: safeText(raw.note),
    owner_name: safeText(raw.owner_name),
    current_name: safeText(raw.current_name),
    group_name: safeText(raw.group_name),
    status_key: status.key,
    status_label: status.label,
    status_tone: status.tone,
    live: status.live,
    mode_short: mode.short,
    mode_icon: mode.icon,
    waiting,
    done: number(raw.done, 0),
    code_label: formatCode(string(raw.code)),
    waiting_label: waiting ? `${people(waiting)} в очереди` : "Пока никого",
    my_state: myState,
    my_pos: myPos,
    ahead,
    is_owner: raw.is_owner === true,
    my_label: myState === "current"
      ? "Ваша очередь — подходите"
      : myState === "waiting"
      ? ahead === 0
        ? current ? "Вы следующий" : "Вы первый в очереди"
        : `Перед вами ${people(ahead)}`
      : "",
    eta_label: myState === "waiting" ? etaLabel(ahead, avg, current) : "",
  };
}

export function presentEntry(raw: Json, now: number): Json {
  return {
    ...raw,
    id: string(raw.id),
    name: safeText(raw.name),
    group: safeText(raw.group),
    note: safeText(raw.note),
    me: raw.me === true,
    moved: raw.moved === true,
    pos: number(raw.pos, 0),
    joined_label: stampLabel(raw.joined_at, now, true),
    called_label: stampLabel(raw.called_at, now),
    ended_label: stampLabel(raw.ended_at, now),
    took_label: toTime(raw.called_at) != null && toTime(raw.ended_at) != null
      ? durationLabel(
        ((toTime(raw.ended_at) ?? 0) - (toTime(raw.called_at) ?? 0)) / 1000,
      )
      : "",
  };
}

export function presentQueue(raw: Json, now: number): Json {
  const card = presentCard(raw, now);
  const waiting = list(raw.waiting).map((e) => presentEntry(e, now));
  const current = list(raw.current).map((e) => presentEntry(e, now));
  const done = list(raw.done_list).map((e) => presentEntry(e, now));
  const my = raw.my ? presentEntry(object(raw.my), now) : null;
  const counts = object(raw.counts);
  const avg = raw.avg_seconds == null ? null : number(raw.avg_seconds, 0);
  return {
    ...card,
    waiting_list: waiting,
    current_list: current,
    done_list: done,
    my,
    counts: {
      waiting: number(counts.waiting, 0),
      current: number(counts.current, 0),
      done: number(counts.done, 0),
      left: number(counts.left, 0),
    },
    avg,
    avg_label: avg == null ? "" : durationLabel(avg),
    shuffles: number(raw.shuffles, 0),
    moves: number(raw.moves, 0),
    events: list(raw.events),
    events_total: number(raw.events_total, 0),
    next_name: waiting[0] ? string(waiting[0].name) : "",
    opens_label: toTime(raw.opens_at) == null
      ? ""
      : whenLabel(raw.opens_at, now),
    opens_at_ms: toTime(raw.opens_at),
    created_label: stampLabel(raw.created_at, now),
  };
}

const posWord = (n: unknown) => `${number(n, 0)}-е место`;

export function eventView(raw: Json, now: number): Json {
  const actor = safeText(raw.actor) || "Участник";
  const target = safeText(raw.target) || "Участник";
  const kind = string(raw.kind);
  const at = stampLabel(raw.at, now, true);
  const views: Record<string, [string, string, string, string]> = {
    created: ["Очередь создана", actor, "plus", "accent"],
    joined: [
      "Запись в очередь",
      `${target} → ${posWord(raw.to)}`,
      "user",
      "accent",
    ],
    left: ["Выход из очереди", target, "door", "muted"],
    let_ahead: [
      "Пропуск вперёд",
      `${actor} пропускает ${target}: места ${number(raw.from, 0)} и ${
        number(raw.to, 0)
      }`,
      "swap",
      "success",
    ],
    called: [
      raw.self === true ? "Идёт сдавать" : "Вызов",
      raw.self === true
        ? target
        : raw.actor == null
        ? `${target} · автоматически`
        : `${target} · вызывает ${actor}`,
      "bell",
      "success",
    ],
    done: [
      "Сдача завершена",
      raw.self === true ? target : `${target} · отмечает ${actor}`,
      "check",
      "success",
    ],
    skipped: [
      "Перенос в конец",
      `${target}: ${raw.from == null ? "вызов" : posWord(raw.from)} → ${
        posWord(raw.to)
      } · ${actor}`,
      "chevronD",
      "warn",
    ],
    removed: ["Удаление из очереди", `${target} · ${actor}`, "close", "danger"],
    moved: [
      "Перестановка",
      `${target}: ${posWord(raw.from)} → ${posWord(raw.to)} · ${actor}`,
      "swap",
      "warn",
    ],
    shuffled: [
      "Жребий",
      `Порядок ${
        count(number(raw.to, 0), ["участника", "участников", "участников"])
      } перемешан случайно · ${actor}`,
      "refresh",
      "warn",
    ],
    opened: ["Запись открыта", actor, "lock", "success"],
    closed: ["Запись закрыта", actor, "lock", "warn"],
    finished: [
      "Очередь завершена",
      raw.actor == null ? "Автоматически: 3 дня без активности" : actor,
      "check",
      "muted",
    ],
    reopened: ["Очередь снова открыта", actor, "refresh", "accent"],
    reset: [
      "Новый круг",
      `${actor} очищает список${
        number(raw.from, 0) ? ` · было ${people(number(raw.from, 0))}` : ""
      }`,
      "refresh",
      "accent",
    ],
    edited: ["Настройки изменены", actor, "pencil", "muted"],
    mode: [
      number(raw.to, 0) === 1
        ? "Режим: порядок задаёт создатель"
        : "Режим: по времени записи",
      actor,
      "settings",
      "warn",
    ],
  };
  const [title, subtitle, icon, color] = views[kind] ??
    ["Событие", actor, "info", "muted"];
  return {
    id: number(raw.id, 0),
    kind,
    title,
    subtitle,
    icon,
    color,
    at,
    mine: raw.actor_me === true || raw.target_me === true,
    by_owner: raw.actor_owner === true && raw.self !== true,
  };
}
