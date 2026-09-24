import {
  appLink,
  durationLabel,
  eventView,
  extractCode,
  formatCode,
  normalizeCode,
  parseMoment,
  parseRoute,
  presentCard,
  queuePath,
  slots,
  stampLabel,
  statusView,
  textInput,
  whenLabel,
} from "./domain.ts";
import * as fx from "./fixtures.ts";

const assert = (v: unknown, message = "Assertion failed") => {
  if (!v) throw new Error(message);
};
const equal = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
};
const throws = (fn: () => unknown) => {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error("Expected an error");
};

Deno.test("codes accept spaces, lowercase and cyrillic lookalikes", () => {
  equal(normalizeCode("k7f 2qx"), "K7F2QX");
  equal(normalizeCode("K7F-2QX"), "K7F2QX");
  equal(normalizeCode("Р2НС9Т"), "P2HC9T");
  equal(normalizeCode("K7F2Q"), null);
  equal(normalizeCode("O0I1AB"), null);
  equal(formatCode("K7F2QX"), "K7F 2QX");
});

Deno.test("codes are extracted from app links, encoded pages and raw text", () => {
  const link = appLink(queuePath("K7F2QX"));
  assert(link.includes("page=%2Fq%3Fcode%3DK7F2QX"));
  equal(extractCode(link), "K7F2QX");
  equal(extractCode("/q?code=k7f2qx"), "K7F2QX");
  equal(
    extractCode(
      "mireaninja://services/apps/queue/run?page=%2Fq%3Fcode%3DM3N8RT",
    ),
    "M3N8RT",
  );
  equal(extractCode("  m3n 8rt "), "M3N8RT");
  equal(extractCode("https://example.com/?code=K7F2QXX"), null);
  equal(extractCode("hello"), null);
  equal(extractCode("x".repeat(700)), null);
});

Deno.test("routes keep only a valid code", () => {
  equal(parseRoute("/q?code=k7f2qx"), { path: "/q", code: "K7F2QX" });
  equal(parseRoute("/q?code=bad"), { path: "/q", code: "" });
  equal(parseRoute("/"), { path: "/", code: "" });
  throws(() => parseRoute("//evil"));
  throws(() => parseRoute("/../x"));
  throws(() => parseRoute("/q?code={{x}}"));
});

Deno.test("text input rejects templates and control characters", () => {
  equal(textInput("  Физика  ", 2, 80), "Физика");
  throws(() => textInput("a", 2, 80));
  throws(() => textInput("{{state.x}}", 0, 80));
  throws(() => textInput("a\nb", 0, 80));
  equal(textInput("a\nb", 0, 80, true), "a\nb");
});

Deno.test("moments are read as Moscow time and past moments open now", () => {
  const local = parseMoment("2026-09-23T14:20:00.000", fx.now);
  equal(new Date(local as number).toISOString(), "2026-09-23T11:20:00.000Z");
  equal(parseMoment("2026-09-23T12:00:00.000", fx.now), null);
  equal(parseMoment("now", fx.now), null);
  equal(
    parseMoment("2026-09-23T11:20:00Z", fx.now),
    Date.parse("2026-09-23T11:20:00Z"),
  );
  throws(() => parseMoment("2027-09-23T12:00:00", fx.now));
  throws(() => parseMoment("2026-02-30T12:00:00", fx.now));
  throws(() => parseMoment("tomorrow", fx.now));
});

Deno.test("labels follow the Moscow calendar", () => {
  equal(whenLabel(fx.now + 70 * 60000, fx.now), "сегодня в 13:40");
  equal(whenLabel(fx.now + 24 * 3600000, fx.now), "завтра в 12:30");
  equal(whenLabel(fx.now + 3 * 24 * 3600000, fx.now), "сб, 26 сен в 12:30");
  equal(stampLabel(fx.at(0, -3), fx.now, true), "12:29:57");
  equal(stampLabel(fx.at(60 * 24), fx.now), "22 сен, 12:30");
  equal(durationLabel(30), "меньше минуты");
  equal(durationLabel(420), "7 мин");
  equal(durationLabel(4200), "1 ч 10 мин");
});

Deno.test("slots start from the next bell and roll over to tomorrow", () => {
  equal(slots(fx.now).map((s) => s.label), [
    "12:40",
    "14:20",
    "16:20",
    "18:00",
  ]);
  const late = Date.UTC(2026, 8, 23, 17, 0);
  equal(slots(late).map((s) => s.label), [
    "завтра 09:00",
    "завтра 10:40",
    "завтра 12:40",
    "завтра 14:20",
  ]);
  equal(slots(fx.now)[0].value, "2026-09-23T09:40:00.000Z");
});

Deno.test("status reflects schedule, closing and finishing", () => {
  equal(statusView({ status: "open" }, fx.now).key, "open");
  equal(
    statusView({ status: "open", opens_at: fx.at(-10) }, fx.now).label,
    "Откроется сегодня в 12:40",
  );
  equal(statusView({ status: "closed" }, fx.now).key, "closed");
  equal(
    statusView({ status: "finished", opens_at: fx.at(-10) }, fx.now).key,
    "finished",
  );
});

Deno.test("cards explain the viewer's place and pace", () => {
  const waiting = presentCard(fx.mine, fx.now);
  equal(waiting.my_label, "Перед вами 2 человека");
  equal(waiting.eta_label, "≈ через 18 мин");
  equal(waiting.waiting_label, "9 человек в очереди");
  equal(waiting.code_label, "K7F 2QX");
  const next = presentCard({ ...fx.mine, my_pos: 1 }, fx.now);
  equal(next.my_label, "Вы следующий");
  const first = presentCard(
    { ...fx.mine, my_pos: 1, current_name: null },
    fx.now,
  );
  equal(first.my_label, "Вы первый в очереди");
  equal(presentCard(fx.called, fx.now).my_label, "Ваша очередь — подходите");
  equal(
    presentCard({ ...fx.mine, title: "{{state.x}}" }, fx.now).title,
    "｛｛state.x｝｝",
  );
});

Deno.test("history events are readable and gender neutral", () => {
  const view = (raw: Record<string, unknown>) =>
    eventView({ at: fx.at(1), ...raw }, fx.now);
  equal(
    view({ kind: "called", actor: null, target: "Петров Илья" }).subtitle,
    "Петров Илья · автоматически",
  );
  equal(
    view({ kind: "called", actor: "Иванова Анна", target: "Петров Илья" })
      .subtitle,
    "Петров Илья · вызывает Иванова Анна",
  );
  equal(
    view({
      kind: "called",
      actor: "Петров Илья",
      target: "Петров Илья",
      self: true,
    }).title,
    "Идёт сдавать",
  );
  equal(
    view({
      kind: "moved",
      actor: "Иванова Анна",
      target: "Егоров Марк",
      from: 5,
      to: 1,
    }).subtitle,
    "Егоров Марк: 5-е место → 1-е место · Иванова Анна",
  );
  equal(
    view({ kind: "let_ahead", actor: "А Б", target: "В Г", from: 2, to: 3 })
      .subtitle,
    "А Б пропускает В Г: места 2 и 3",
  );
  equal(
    view({ kind: "shuffled", actor: "А Б", to: 5 }).subtitle,
    "Порядок 5 участников перемешан случайно · А Б",
  );
  equal(
    view({ kind: "finished", actor: null }).subtitle,
    "Автоматически: 3 дня без активности",
  );
  equal(
    view({ kind: "reset", actor: "А Б", from: 3 }).subtitle,
    "А Б очищает список · было 3 человека",
  );
  for (
    const kind of [
      "created",
      "joined",
      "left",
      "done",
      "skipped",
      "removed",
      "opened",
      "closed",
      "reopened",
      "edited",
      "mode",
    ]
  ) {
    assert(
      view({ kind, actor: "А Б", target: "В Г", from: 1, to: 2 }).title !==
        "Событие",
      kind,
    );
  }
});
