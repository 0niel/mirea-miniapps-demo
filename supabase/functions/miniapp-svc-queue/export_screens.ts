import { buildScreen } from "./screens.ts";
import { appLink, type Json, object, queuePath } from "./domain.ts";
import { qrPng } from "./qr.ts";
import * as fx from "./fixtures.ts";

const root = new URL("../../../", import.meta.url);
const ctx = { now: fx.now, publicBase: "https://project.supabase.co" };
const states: Record<string, [string, Json, Json?, Json?]> = {
  "queue-home": ["/", fx.home],
  "queue-home-archive": ["/", fx.home, {}, { archiveOpen: true }],
  "queue-home-empty": ["/", fx.emptyHome],
  "queue-new": ["/new", fx.newState],
  "queue-new-filled": ["/new", fx.newState, {}, {
    subject: 0,
    title: "Физика — лаба 3",
    mode: "owner",
    opens: "2026-09-23T09:40:00.000Z",
    limit: true,
    capacity: 30,
  }],
  "queue-new-no-group": ["/new", {
    me: fx.newcomer,
    subjects: [],
    active_owned: 13,
    recent_titles: [],
  }],
  "queue-member": ["/q", fx.queueState, { code: fx.code }, { doneOpen: true }],
  "queue-owner": ["/q", fx.ownerQueueState, { code: fx.ownedCode }],
  "queue-called": ["/q", fx.calledState, { code: fx.code }],
  "queue-visitor": ["/q", fx.visitorState, { code: fx.code }],
  "queue-scheduled": ["/q", fx.scheduledState, { code: "S9H7DL" }],
  "queue-finished": ["/q", fx.finishedState, { code: "ARCH1V" }],
  "queue-missing": ["/q", { me: fx.me, queue: null }],
  "queue-history": ["/history", fx.queueState, { code: fx.code }],
  "queue-edit": ["/edit", fx.ownerQueueState, { code: fx.ownedCode }],
};
const output = new URL("artifacts/screens/queue/", root);
await Deno.mkdir(output, { recursive: true });
for (const [name, [path, state, extra, initial]] of Object.entries(states)) {
  const screen = buildScreen(path, state, { ...ctx, ...extra });
  if (initial) {
    const scope = object(screen.body);
    scope.initial = { ...object(scope.initial), ...initial };
  }
  await Deno.writeTextFile(
    new URL(`${name}.json`, output),
    JSON.stringify(screen, null, 2) + "\n",
  );
}
await Deno.writeFile(
  new URL("qr.png", output),
  await qrPng(appLink(queuePath(fx.code))),
);
console.log(`Exported ${Object.keys(states).length} screens`);
