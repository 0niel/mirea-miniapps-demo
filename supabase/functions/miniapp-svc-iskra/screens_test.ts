import { buildScreen } from "./screens.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function serialized(screen: unknown): string {
  return JSON.stringify(screen);
}

Deno.test("adult gate is mandatory before every route", () => {
  const screen = serialized(buildScreen("/matches", { adultConfirmed: false }));
  assertEquals(screen.includes("Мне уже исполнилось 18 лет"), true);
  assertEquals(screen.includes("/api/confirm"), true);
  assertEquals(screen.includes("Мои мэтчи"), false);
});

Deno.test("safety restrictions preempt onboarding", () => {
  const screen = serialized(buildScreen("/", {
    adultConfirmed: false,
    restrictionType: "banned",
    restrictionReason: "Нарушение правил",
    profile: null,
  }));
  assertEquals(screen.includes("Доступ к Искре ограничен"), true);
  assertEquals(screen.includes("Мне уже исполнилось 18 лет"), false);
});

Deno.test("unconfigured users receive onboarding", () => {
  const screen = serialized(
    buildScreen("/", { adultConfirmed: true, profile: null }),
  );
  assertEquals(screen.includes("Создай честную анкету"), true);
  assertEquals(screen.includes("/api/profile"), true);
});

Deno.test("moderators can review without publishing a dating profile", () => {
  const state = {
    adultConfirmed: true,
    isModerator: true,
    profile: null,
  };
  const home = serialized(buildScreen("/", state));
  const queue = serialized(buildScreen("/moderation", state, { queue: [] }));
  assertEquals(home.includes("Открыть модерацию"), true);
  assertEquals(queue.includes("Очередь пуста"), true);
});

Deno.test("active home renders a candidate and safety action", () => {
  const screen = serialized(buildScreen("/", {
    adultConfirmed: true,
    profile: { displayName: "Лев", status: "active", photoStatus: "none" },
    matchCount: 2,
    pendingLikes: 1,
  }, {
    candidate: {
      publicId: "9fb788a6-05d1-48e9-b8a8-d966ac60c724",
      displayName: "Аня",
      age: 21,
      status: "active",
      photoStatus: "none",
      interests: ["кино", "музыка"],
    },
  }));
  assertEquals(screen.includes("Аня, 21"), true);
  assertEquals(screen.includes("/api/decide"), true);
  assertEquals(screen.includes("/report?id="), true);
});

Deno.test("paused and banned states cannot browse discovery", () => {
  const paused = serialized(buildScreen("/", {
    adultConfirmed: true,
    profile: { displayName: "Лев", status: "paused" },
  }));
  const banned = serialized(buildScreen("/matches", {
    adultConfirmed: true,
    profile: { displayName: "Лев", status: "banned" },
  }));
  assertEquals(paused.includes("Искра на паузе"), true);
  assertEquals(banned.includes("Анкета заблокирована"), true);
});

Deno.test("contact is only rendered after bilateral consent", () => {
  const state = {
    adultConfirmed: true,
    profile: { displayName: "Лев", status: "active" },
  };
  const base = {
    matchId: "abc",
    profile: { publicId: "u2", displayName: "Аня", age: 21, status: "active" },
  };
  const waiting = serialized(buildScreen("/match", state, {
    id: "abc",
    matches: [{
      ...base,
      myConsent: true,
      theirConsent: false,
      contactHandle: null,
    }],
  }));
  const open = serialized(buildScreen("/match", state, {
    id: "abc",
    matches: [{
      ...base,
      myConsent: true,
      theirConsent: true,
      contactHandle: "anya_mirea",
    }],
  }));
  assertEquals(waiting.includes("t.me"), false);
  assertEquals(open.includes("https://t.me/anya_mirea"), true);
  assertEquals(open.includes("/api/contact/revoke"), true);
});

Deno.test("after-like state distinguishes a new mutual match", () => {
  const state = {
    adultConfirmed: true,
    profile: { displayName: "Лев", status: "active" },
  };
  const target = "9fb788a6-05d1-48e9-b8a8-d966ac60c724";
  const sent = serialized(buildScreen("/after-like", state, { id: target }));
  const matched = serialized(buildScreen("/after-like", state, {
    id: target,
    matches: [{
      matchId: "match-id",
      profile: { publicId: target, displayName: "Аня", age: 21 },
    }],
  }));
  assertEquals(sent.includes("Симпатия отправлена"), true);
  assertEquals(matched.includes("Это взаимно"), true);
  assertEquals(matched.includes("/match?id=match-id"), true);
});

Deno.test("moderation actions carry immutable targets", () => {
  const screen = serialized(buildScreen("/moderation", {
    adultConfirmed: true,
    isModerator: true,
    profile: { displayName: "Модератор", status: "active" },
  }, {
    queue: [{
      publicId: "public-target",
      openReports: 1,
      profile: {
        displayName: "Аня",
        age: 21,
        status: "active",
        photoStatus: "pending",
        photoVersion: "photo-version",
      },
      reports: [{
        reportId: "report-id",
        reason: "fake",
        details: "Описание",
      }],
    }],
  }));
  assertEquals(screen.includes("photo-version"), true);
  assertEquals(screen.includes("report-id"), true);
  assertEquals(screen.includes("dismiss_report"), true);
});

Deno.test("review moderation requires closing reports before restore", () => {
  const state = {
    adultConfirmed: true,
    isModerator: true,
    profile: { displayName: "Модератор", status: "active" },
  };
  const review = {
    publicId: "public-target",
    profile: {
      displayName: "Удалённая анкета",
      status: "paused",
      restrictionType: "review",
    },
  };
  const pending = serialized(buildScreen("/moderation", state, {
    queue: [{ ...review, openReports: 1, reports: [{}] }],
  }));
  assertEquals(pending.includes("Восстановить анкету"), false);
  assertEquals(pending.includes("Заблокировать анкету"), true);

  const cleared = serialized(buildScreen("/moderation", state, {
    queue: [{ ...review, openReports: 0, reports: [] }],
  }));
  assertEquals(cleared.includes("Восстановить анкету"), true);
  assertEquals(cleared.includes("Заблокировать анкету"), true);
});

Deno.test("moderation page stays below the proxy response limit", () => {
  const text = "я".repeat(500);
  const queue = Array.from({ length: 6 }, (_, subject) => ({
    publicId: `public-target-${subject}`,
    openReports: 5,
    profile: {
      displayName: "Имя пользователя",
      age: 21,
      bio: text,
      status: "active",
      photoStatus: "none",
    },
    reports: Array.from({ length: 5 }, (_, report) => ({
      reportId: `report-${subject}-${report}`,
      reason: "other",
      details: text,
      profileSnapshot: {
        displayName: "Имя пользователя",
        age: 21,
        bio: text,
      },
    })),
  }));
  const screen = serialized(buildScreen("/moderation", {
    adultConfirmed: true,
    isModerator: true,
    profile: { displayName: "Модератор", status: "active" },
  }, { queue }));
  assertEquals(new TextEncoder().encode(screen).length < 512 * 1024, true);
});
