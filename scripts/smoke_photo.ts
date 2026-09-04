import jpegJs from "jpeg-js";

const baseUrl = required("ISKRA_SMOKE_URL");
const secretKey = required("ISKRA_SMOKE_SECRET");
const publicKey = required("ISKRA_SMOKE_PUBLIC");
const format = Deno.env.get("ISKRA_SMOKE_FORMAT") === "webp" ? "webp" : "jpeg";
const serviceHeaders = {
  apikey: secretKey,
  Authorization: `Bearer ${secretKey}`,
  "User-Agent": "supabase-js-deno/2.110.2",
};

let userId = "";
let accessToken = "";
let temporaryPath = "";
let privatePath = "";

try {
  const password = `Qq9!${crypto.randomUUID()}aA`;
  const email = `iskra-smoke-${crypto.randomUUID()}@example.invalid`;
  const created = await request(`${baseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...serviceHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  userId = String(created.id);

  const session = await request(
    `${baseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: publicKey,
        "Content-Type": "application/json",
        "User-Agent": "supabase-js-deno/2.110.2",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  accessToken = String(session.access_token);

  await edge("api", "/api/confirm", {
    adultAccepted: true,
    safetyAccepted: true,
  });
  await edge("api", "/api/profile", {
    displayName: "Тест",
    age: "23",
    gender: "other",
    lookingFor: "everyone",
    intent: "communication",
    bio: "Проверка загрузки",
    interests: "музыка, прогулки",
    avatarEmoji: "✨",
  });

  const before = await dispatch("state") as Record<string, unknown>;
  const prefix = String(before.temporaryUploadPrefix);
  const source = format === "webp" ? webp() : image(1600, 1200);
  const extension = format === "webp" ? "webp" : "jpg";
  const contentType = format === "webp" ? "image/webp" : "image/jpeg";
  temporaryPath = `${prefix}/${crypto.randomUUID()}.${extension}`;
  await request(
    `${baseUrl}/storage/v1/object/mini-app-uploads/${temporaryPath}`,
    {
      method: "POST",
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
        "x-upsert": "false",
        "User-Agent": "supabase-js-deno/2.110.2",
      },
      body: Uint8Array.from(source).buffer,
    },
  );

  const startedAt = performance.now();
  const saved = await edge("api", "/api/photo", {
    photoUrl:
      `${baseUrl}/storage/v1/object/public/mini-app-uploads/${temporaryPath}`,
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  const after = await dispatch("state") as Record<string, unknown>;
  const profile = after.profile as Record<string, unknown>;
  privatePath = String(profile.photoPath ?? "");
  const photoScreen = await edge("screen", "/photo");
  const invalidPath = `${prefix}/${crypto.randomUUID()}.jpg`;
  await request(
    `${baseUrl}/storage/v1/object/mini-app-uploads/${invalidPath}`,
    {
      method: "POST",
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "image/jpeg",
        "x-upsert": "false",
        "User-Agent": "supabase-js-deno/2.110.2",
      },
      body: new TextEncoder().encode("not an image").buffer,
    },
  );
  const invalidResponse = await edgeResponse("api", "/api/photo", {
    photoUrl:
      `${baseUrl}/storage/v1/object/public/mini-app-uploads/${invalidPath}`,
  });
  await remove("mini-app-uploads", invalidPath);
  const afterInvalid = await dispatch("state") as Record<string, unknown>;
  if (
    invalidResponse.status !== 415 ||
    afterInvalid.photosRemaining !== after.photosRemaining
  ) throw new Error("Failed photo attempt was not refunded");

  console.log(JSON.stringify({
    temporaryUpload: 200,
    format,
    photoSave: saved.status,
    elapsedMs,
    photoStatus: profile.photoStatus,
    privatePath: Boolean(privatePath),
    signedPhoto: photoScreen.text.includes(
      "/storage/v1/object/sign/iskra-photos/",
    ),
    failedAttemptRefunded: true,
    screenBytes: new TextEncoder().encode(photoScreen.text).length,
    inputBytes: source.length,
  }));
} finally {
  await remove("iskra-photos", privatePath);
  await remove("mini-app-uploads", temporaryPath);
  if (userId) {
    try {
      await edge("api", "/api/delete");
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

async function request(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function edge(
  kind: "api" | "screen",
  path: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; text: string }> {
  const response = await edgeResponse(kind, path, body);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return { status: response.status, text };
}

function edgeResponse(
  kind: "api" | "screen",
  path: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(
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
        kind,
        path,
        method: "POST",
        userId,
        body,
      }),
    },
  );
}

function dispatch(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return request(`${baseUrl}/rest/v1/rpc/iskra_dispatch`, {
    method: "POST",
    headers: { ...serviceHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_user_id: userId,
      p_action: action,
      p_payload: payload,
    }),
  });
}

async function remove(bucket: string, path: string): Promise<void> {
  if (!path) return;
  await fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });
}

function image(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(x * 255 / width);
      data[offset + 1] = Math.round(y * 255 / height);
      data[offset + 2] = 160;
      data[offset + 3] = 255;
    }
  }
  return Uint8Array.from(jpegJs.encode({ data, width, height }, 75).data);
}

function webp(): Uint8Array {
  return Uint8Array.from(
    atob("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"),
    (character) => character.charCodeAt(0),
  );
}
