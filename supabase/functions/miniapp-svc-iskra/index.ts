import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  booleanOf,
  constantTimeEqual,
  extractTemporaryUpload,
  isUuid,
  type JsonObject,
  objectOf,
  profilePayload,
  type ProxyRequest,
  publicError,
  stringOf,
  userTextOf,
} from "./domain.ts";
import { sanitizeImage } from "./image.ts";
import { buildScreen } from "./screens.ts";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32_768) return json({ error: "Payload too large" }, 413);

  let input: ProxyRequest;
  try {
    input = await request.json() as ProxyRequest;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (
    input.kind === "maintenance"
      ? !isMaintenanceRequest(request)
      : !isFromProxy(request)
  ) {
    return json({ error: "Forbidden" }, 403);
  }

  if (input.organizationId !== "mirea" || input.slug !== "iskra") {
    return json({ error: "Invalid proxy context" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Service configuration unavailable" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (input.kind === "maintenance") {
      const cleanupUser = "00000000-0000-0000-0000-000000000000";
      for (let batch = 0; batch < 5; batch++) {
        if (await drainCleanup(supabase, cleanupUser) === 0) break;
      }
      return json({ ok: true }, 200);
    }
    if (!isUuid(input.userId)) {
      return json({ error: "Invalid proxy context" }, 403);
    }
    if ((input.kind ?? "screen") === "screen") {
      return await screenResponse(supabase, input.userId, input.path);
    }
    if (input.kind === "api") {
      if ((input.method ?? "GET").toUpperCase() !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      return await apiResponse(
        supabase,
        input.userId,
        input.path,
        input.body,
        supabaseUrl,
      );
    }
    return json({ error: "Invalid request kind" }, 400);
  } catch (error) {
    console.error("Iskra request failed", error);
    const failure = publicError(
      error instanceof Error ? error.message : "Unknown error",
      error instanceof DispatchError ? error.code : "",
    );
    return json({ error: failure.message }, failure.status);
  }
});

async function screenResponse(
  supabase: SupabaseClient,
  userId: string,
  rawPath: string | undefined,
): Promise<Response> {
  const route = parseRoute(rawPath);
  const state = await dispatch(supabase, userId, "state");
  const stateObject = objectOf(state);
  delete stateObject.temporaryUploadPrefix;
  const extra: JsonObject = { id: route.id, origin: route.origin };

  if (
    stateObject.adultConfirmed === true &&
    route.path === "/moderation" && stateObject.isModerator === true
  ) {
    extra.queue =
      objectOf(await dispatch(supabase, userId, "moderation_queue")).queue;
  }

  if (stateObject.adultConfirmed === true && stateObject.profile) {
    const status = stringOf(objectOf(stateObject.profile).status);
    if (status !== "banned" && status !== "paused" && route.path === "/") {
      extra.candidate =
        objectOf(await dispatch(supabase, userId, "candidate")).candidate;
    }
    if (["/matches", "/match", "/after-like"].includes(route.path)) {
      extra.matches =
        objectOf(await dispatch(supabase, userId, "matches")).matches;
    }
  }

  const signable: JsonObject = { state: stateObject, ...extra };
  if ("candidate" in signable) {
    signable.candidate = redactUnapprovedPhotoPaths(signable.candidate);
  }
  if ("matches" in signable) {
    signable.matches = redactUnapprovedPhotoPaths(signable.matches);
  }
  const signed = await attachSignedPhotoUrls(supabase, signable);
  const signedObject = objectOf(signed);
  return json(
    buildScreen(route.path, signedObject.state, signedObject),
    200,
  );
}

async function apiResponse(
  supabase: SupabaseClient,
  userId: string,
  rawPath: string | undefined,
  rawBody: unknown,
  supabaseUrl: string,
): Promise<Response> {
  const path = parseRoute(rawPath).path;
  const body = objectOf(rawBody);

  if (path === "/api/confirm") {
    await dispatch(supabase, userId, "confirm_adult", {
      adultAccepted: booleanOf(body.adultAccepted),
      safetyAccepted: booleanOf(body.safetyAccepted),
    });
    return json({ ok: true }, 200);
  }

  if (path === "/api/profile") {
    await dispatch(supabase, userId, "save_profile", profilePayload(body));
    return json({ ok: true }, 200);
  }

  if (path === "/api/photo") {
    return await savePrivatePhoto(supabase, userId, body.photoUrl, supabaseUrl);
  }

  if (path === "/api/decide") {
    const result = objectOf(
      await dispatch(supabase, userId, "decide", {
        targetId: stringOf(body.targetId, 36),
        decision: stringOf(body.decision, 8),
        opener: userTextOf(body.opener, 240),
      }),
    );
    return json({ ok: true, matched: result.matched === true }, 200);
  }

  if (path === "/api/contact") {
    await dispatch(supabase, userId, "set_contact", {
      matchId: stringOf(body.matchId, 36),
      handle: stringOf(body.handle, 32).replace(/^@/, ""),
    });
    return json({ ok: true }, 200);
  }

  if (path === "/api/contact/revoke") {
    await dispatch(supabase, userId, "revoke_contact", {
      matchId: stringOf(body.matchId, 36),
    });
    return json({ ok: true }, 200);
  }

  if (path === "/api/pause" || path === "/api/resume") {
    await dispatch(
      supabase,
      userId,
      path.endsWith("pause") ? "pause" : "resume",
    );
    return json({ ok: true }, 200);
  }

  if (path === "/api/block") {
    await dispatch(supabase, userId, "block", {
      targetId: stringOf(body.targetId, 36),
    });
    return json({ ok: true }, 200);
  }

  if (path === "/api/report") {
    await dispatch(supabase, userId, "report", {
      targetId: stringOf(body.targetId, 36),
      reason: stringOf(body.reason, 20),
      details: userTextOf(body.details, 500),
    });
    return json({ ok: true }, 200);
  }

  if (path === "/api/delete") {
    await dispatch(supabase, userId, "delete_profile");
    return json({ ok: true }, 200);
  }

  if (path === "/api/moderate") {
    await dispatch(supabase, userId, "moderate", {
      targetId: stringOf(body.targetId, 36),
      moderationAction: stringOf(body.moderationAction, 24),
      photoVersion: stringOf(body.photoVersion, 32),
      reportId: stringOf(body.reportId, 36),
      note: userTextOf(body.note, 500),
    });
    return json({ ok: true }, 200);
  }

  return json({ error: "API route not found" }, 404);
}

async function savePrivatePhoto(
  supabase: SupabaseClient,
  userId: string,
  photoUrl: unknown,
  supabaseUrl: string,
): Promise<Response> {
  const uploadState = objectOf(await dispatch(supabase, userId, "state"));
  const expectedPrefix = stringOf(uploadState.temporaryUploadPrefix, 100);
  const temporaryPath = extractTemporaryUpload(
    photoUrl,
    supabaseUrl,
    userId,
    expectedPrefix,
  );
  if (!temporaryPath) return json({ error: "Invalid photo" }, 422);

  const reservation = objectOf(
    await dispatch(
      supabase,
      userId,
      "reserve_photo",
      { temporaryPath },
    ),
  );
  const reservationId = stringOf(reservation.reservationId, 36);
  if (!isUuid(reservationId)) throw new Error("Photo reservation failed");
  let stage = "download";
  try {
    const { data: source, error: downloadError } = await supabase.storage
      .from("mini-app-uploads")
      .download(temporaryPath);
    if (downloadError || !source) throw new Error("Photo download failed");
    await enqueueCleanup(
      supabase,
      userId,
      "mini-app-uploads",
      temporaryPath,
    );
    stage = "sanitize";
    const sanitized = await sanitizeImage(source);
    const privatePath =
      `profiles/${crypto.randomUUID()}.${sanitized.extension}`;
    await enqueueCleanup(
      supabase,
      userId,
      "iskra-photos",
      privatePath,
      300,
    );
    stage = "upload";
    const { error: uploadError } = await supabase.storage
      .from("iskra-photos")
      .upload(privatePath, sanitized.bytes, {
        contentType: sanitized.mime,
        upsert: false,
      });
    if (uploadError) throw new Error("Photo upload failed");
    stage = "persist";
    await dispatch(supabase, userId, "set_photo", {
      path: privatePath,
      reservationId,
    });
    return json({ ok: true, status: "pending" }, 200);
  } catch (error) {
    console.error(`Photo ${stage} failed`, error);
    await cancelPhotoReservation(supabase, userId, reservationId);
    await enqueueCleanup(
      supabase,
      userId,
      "mini-app-uploads",
      temporaryPath,
    ).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Invalid photo";
    if (
      stage === "sanitize" || message.startsWith("Invalid photo") ||
      message.includes("images")
    ) {
      const invalidType = message.includes("type");
      return json(
        {
          error: message.includes("size")
            ? "Invalid photo size"
            : invalidType
            ? "Unsupported photo type"
            : message,
          code: `photo_${stage}`,
        },
        message.includes("size") ? 413 : invalidType ? 415 : 422,
      );
    }
    throw error;
  }
}

async function cancelPhotoReservation(
  supabase: SupabaseClient,
  userId: string,
  reservationId: string,
): Promise<void> {
  try {
    await dispatch(supabase, userId, "cancel_photo", { reservationId });
  } catch (error) {
    console.error("Photo reservation cleanup failed", error);
  }
}

async function enqueueCleanup(
  supabase: SupabaseClient,
  userId: string,
  bucketId: string,
  objectPath: string,
  delaySeconds = 0,
): Promise<void> {
  await dispatch(supabase, userId, "enqueue_cleanup", {
    bucketId,
    objectPath,
    delaySeconds,
  });
}

async function drainCleanup(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const batch = objectOf(await dispatch(supabase, userId, "cleanup_batch"));
  const items = Array.isArray(batch.items) ? batch.items : [];
  const grouped = new Map<string, string[]>();
  for (const value of items) {
    const item = objectOf(value);
    const bucket = stringOf(item.bucketId, 40);
    const path = typeof item.objectPath === "string" &&
        item.objectPath.length > 0 && item.objectPath.length <= 1024
      ? item.objectPath
      : "";
    if (!path || !["mini-app-uploads", "iskra-photos"].includes(bucket)) {
      throw new Error("Invalid cleanup batch");
    }
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), path]);
  }
  const results: JsonObject[] = [];
  let failed = false;
  for (const [bucketId, paths] of grouped) {
    const { error } = await supabase.storage.from(bucketId).remove(paths);
    failed ||= Boolean(error);
    for (const objectPath of paths) {
      results.push({
        bucketId,
        objectPath,
        ok: !error,
        error: error?.message ?? "",
      });
    }
  }
  if (results.length > 0) {
    await dispatch(supabase, userId, "cleanup_results", { items: results });
  }
  if (failed) throw new Error("Media cleanup failed");
  return results.length;
}

class DispatchError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DispatchError";
  }
}

async function dispatch(
  supabase: SupabaseClient,
  userId: string,
  action: string,
  payload: JsonObject = {},
): Promise<unknown> {
  const { data, error } = await supabase.rpc("iskra_dispatch", {
    p_user_id: userId,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw new DispatchError(error.message, error.code ?? "");
  return data;
}

async function attachSignedPhotoUrls(
  supabase: SupabaseClient,
  value: unknown,
): Promise<unknown> {
  const paths = new Set<string>();
  collectPhotoPaths(value, paths);
  const signedUrls = new Map<string, string>();
  if (paths.size > 0) {
    const orderedPaths = [...paths];
    const { data } = await supabase.storage.from("iskra-photos")
      .createSignedUrls(orderedPaths, 300);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        signedUrls.set(item.path, item.signedUrl);
      }
    }
  }
  return replacePhotoPaths(value, signedUrls);
}

function collectPhotoPaths(value: unknown, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPhotoPaths(item, paths);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key === "photoPath" && typeof child === "string" && child) {
      paths.add(child);
    } else collectPhotoPaths(child, paths);
  }
}

function replacePhotoPaths(
  value: unknown,
  signedUrls: Map<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replacePhotoPaths(item, signedUrls));
  }
  if (!value || typeof value !== "object") return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key === "photoPath") {
      result.photoUrl = typeof child === "string"
        ? signedUrls.get(child) ?? null
        : null;
    } else {
      result[key] = replacePhotoPaths(child, signedUrls);
    }
  }
  return result;
}

function redactUnapprovedPhotoPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUnapprovedPhotoPaths);
  if (!value || typeof value !== "object") return value;
  const source = value as JsonObject;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "photoPath" && source.photoStatus !== "approved") continue;
    result[key] = redactUnapprovedPhotoPaths(child);
  }
  return result;
}

function parseRoute(
  rawPath: string | undefined,
): { path: string; id: string; origin: string } {
  try {
    const route = new URL(rawPath ?? "/", "https://iskra.local");
    return {
      path: route.pathname.startsWith("/") ? route.pathname : "/",
      id: route.searchParams.get("id") ?? "",
      origin: route.searchParams.get("from") ?? "",
    };
  } catch {
    return { path: "/", id: "", origin: "" };
  }
}

function isFromProxy(request: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (request.headers.get("Authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  return constantTimeEqual(token, expected);
}

function isMaintenanceRequest(request: Request): boolean {
  const expected = Deno.env.get("ISKRA_CLEANUP_SECRET") ?? "";
  const token = request.headers.get("X-Iskra-Cleanup-Secret") ?? "";
  return constantTimeEqual(token, expected);
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders,
  });
}
