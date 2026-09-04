const baseUrl = required("ISKRA_SMOKE_URL");
const secretKey = required("ISKRA_SMOKE_SECRET");
const serviceHeaders = {
  apikey: secretKey,
  Authorization: `Bearer ${secretKey}`,
  "User-Agent": "supabase-js-deno/2.110.2",
};
const users: string[] = [];

try {
  const first = await createUser();
  const second = await createUser();
  await onboard(first, {
    displayName: "Альфа",
    age: "23",
    gender: "man",
    lookingFor: "woman",
    intent: "relationship",
    bio: "Люблю музыку и прогулки",
    interests: "музыка, прогулки",
    avatarEmoji: "🎧",
  });
  await onboard(second, {
    displayName: "Бета",
    age: "22",
    gender: "woman",
    lookingFor: "man",
    intent: "relationship",
    bio: "Люблю музыку и кино",
    interests: "музыка, кино",
    avatarEmoji: "🌙",
  });

  const firstCandidate = await dispatch(first, "candidate");
  const secondCandidate = await dispatch(second, "candidate");
  const firstProfile = asObject(firstCandidate.candidate);
  const secondProfile = asObject(secondCandidate.candidate);
  equal(firstProfile.sameIntent, true, "same intent");
  equal(
    JSON.stringify(firstProfile.sharedInterests),
    JSON.stringify(["музыка"]),
    "shared interests",
  );

  await edge(first, "/api/decide", {
    targetId: firstProfile.publicId,
    decision: "like",
    opener: "Музыка — уже хороший повод познакомиться",
  });
  const afterFirstLike = await dispatch(first, "state");
  await edge(first, "/api/decide", {
    targetId: firstProfile.publicId,
    decision: "like",
    opener: "Повторный запрос",
  });
  const afterRepeatedLike = await dispatch(first, "state");
  equal(afterFirstLike.decisionsRemaining, 39, "first decision quota");
  equal(afterRepeatedLike.decisionsRemaining, 39, "idempotent decision quota");

  const mutual = await edge(second, "/api/decide", {
    targetId: secondProfile.publicId,
    decision: "like",
    opener: "Тоже люблю музыку",
  });
  equal(mutual.matched, true, "mutual match");
  const firstMatches = asArray((await dispatch(first, "matches")).matches);
  const matchId = String(asObject(firstMatches[0]).matchId);
  equal(firstMatches.length, 1, "first match count");

  await edge(first, "/api/contact", { matchId, handle: "alpha_test" });
  const waiting = asObject(
    asArray((await dispatch(first, "matches")).matches)[0],
  );
  equal(waiting.myConsent, true, "first consent");
  equal(waiting.theirConsent, false, "second consent pending");
  equal(waiting.contactHandle, null, "contact stays private");

  await edge(second, "/api/contact", { matchId, handle: "beta_test" });
  const openedForFirst = asObject(
    asArray((await dispatch(first, "matches")).matches)[0],
  );
  const openedForSecond = asObject(
    asArray((await dispatch(second, "matches")).matches)[0],
  );
  equal(openedForFirst.contactHandle, "beta_test", "second contact opened");
  equal(openedForSecond.contactHandle, "alpha_test", "first contact opened");

  await edge(first, "/api/contact/revoke", { matchId });
  const revoked = asObject(
    asArray((await dispatch(second, "matches")).matches)[0],
  );
  equal(revoked.contactHandle, null, "revoked contact hidden");

  await edge(second, "/api/pause");
  equal(
    asObject((await dispatch(second, "state")).profile).status,
    "paused",
    "pause",
  );
  await edge(second, "/api/resume");
  equal(
    asObject((await dispatch(second, "state")).profile).status,
    "active",
    "resume",
  );

  await edge(first, "/api/block", { targetId: firstProfile.publicId });
  equal(
    asArray((await dispatch(first, "matches")).matches).length,
    0,
    "blocked match removed",
  );
  const home = await edgeScreen(first, "/");
  equal(
    home.includes("Сегодня осталось решений: 39 из 40"),
    true,
    "home state",
  );

  console.log(JSON.stringify({
    onboarding: true,
    recommendations: true,
    decisionIdempotency: true,
    mutualMatch: true,
    bilateralConsent: true,
    contactRevocation: true,
    pauseResume: true,
    blockRemovesMatch: true,
    screenBytes: new TextEncoder().encode(home).length,
  }));
} finally {
  for (const userId of users) {
    try {
      await edge(userId, "/api/delete");
    } catch (error) {
      console.error("Profile cleanup failed", error);
    }
    await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: serviceHeaders,
    });
  }
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function createUser(): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...serviceHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `iskra-state-${crypto.randomUUID()}@example.invalid`,
      password: `Qq9!${crypto.randomUUID()}aA`,
      email_confirm: true,
    }),
  });
  const body = await json(response);
  const userId = String(body.id);
  users.push(userId);
  return userId;
}

async function onboard(
  userId: string,
  profile: Record<string, unknown>,
): Promise<void> {
  await edge(userId, "/api/confirm", {
    adultAccepted: true,
    safetyAccepted: true,
  });
  await edge(userId, "/api/profile", profile);
}

async function edge(
  userId: string,
  path: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${baseUrl}/functions/v1/miniapp-svc-iskra`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "mirea",
        slug: "iskra",
        kind: "api",
        path,
        method: "POST",
        userId,
        body,
      }),
    },
  );
  return await json(response);
}

async function edgeScreen(userId: string, path: string): Promise<string> {
  const response = await fetch(
    `${baseUrl}/functions/v1/miniapp-svc-iskra`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: "mirea",
        slug: "iskra",
        kind: "screen",
        path,
        userId,
      }),
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text;
}

async function dispatch(
  userId: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/iskra_dispatch`, {
    method: "POST",
    headers: { ...serviceHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_user_id: userId,
      p_action: action,
      p_payload: payload,
    }),
  });
  return await json(response);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
