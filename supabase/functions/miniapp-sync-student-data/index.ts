import { createClient } from "@supabase/supabase-js";
import {
  manifestOf,
  rawUrl,
  readCapped,
  REPOSITORY,
  verifiedPayload,
} from "./domain.ts";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }
  if (request.method === "POST") {
    try {
      const body = new TextDecoder().decode(
        await readCapped(new Response(request.body ?? new Uint8Array()), 1024),
      ).trim();
      if (body !== "" && body !== "{}") {
        return json(
          { error: "This endpoint accepts no import parameters" },
          400,
        );
      }
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
  }
  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  async function control(
    action: string,
    payload: Record<string, unknown> = {},
  ) {
    const { data, error } = await client.rpc("student_data_sync_control", {
      p_action: action,
      p_payload: payload,
    });
    if (error) throw new Error("Sync state unavailable");
    return data;
  }
  let lease: string | undefined;
  try {
    if (request.method === "GET") return json(await control("status"));
    const job = await control("acquire");
    if (!job.acquired) return json(await control("status"), 202);
    lease = job.lease;
    let revision = job.revision;
    let cursor: number = job.cursor;
    let manifest = job.manifest;
    const started = Date.now();
    const fetchSource = async (url: string, limit: number) =>
      await readCapped(
        await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: {
            "User-Agent": "Mirea-Student-Miniapps",
            Accept: "application/vnd.github+json",
          },
        }),
        limit,
      );
    if (!manifest || cursor >= job.total || job.error) {
      const commits = JSON.parse(new TextDecoder().decode(
        await fetchSource(
          `https://api.github.com/repos/${REPOSITORY}/commits?path=data/manifest.json&sha=main&per_page=1`,
          65_536,
        ),
      ));
      const latest: string = commits?.[0]?.sha;
      if (!/^[0-9a-f]{40}$/.test(latest ?? "")) {
        throw new Error("Published dataset unavailable");
      }
      if (latest === revision && manifest && cursor >= job.total) {
        await control("release", { lease });
        lease = undefined;
        return json(await control("status"));
      }
      if (latest !== revision || !manifest) {
        revision = latest;
        manifest = manifestOf(
          JSON.parse(new TextDecoder().decode(
            await fetchSource(
              rawUrl(revision, "data/manifest.json"),
              1_048_576,
            ),
          )),
        );
        await control("begin", { lease, revision, manifest });
        cursor = 0;
      }
    }
    manifest = manifestOf(manifest);
    let processed = 0;
    while (
      cursor < manifest.assets.length && processed < 8 &&
      Date.now() - started < 40_000
    ) {
      const asset = manifest.assets[cursor];
      const payload = await verifiedPayload(
        asset,
        await fetchSource(rawUrl(revision, asset.path), asset.bytes),
      );
      const name = asset.dataset === "curriculum"
        ? "learning_roadmap_import"
        : "student_discounts_import";
      const { error } = await client.rpc(name, { p_payload: payload });
      if (error) {
        console.error(
          "Dataset import failed",
          asset.dataset,
          asset.path,
          error.code,
        );
        throw new Error("Dataset validation failed; previous data retained");
      }
      await control("advance", { lease, cursor: cursor + 1 });
      cursor++;
      processed++;
    }
    await control("release", { lease });
    lease = undefined;
    return json(
      await control("status"),
      cursor < manifest.assets.length ? 202 : 200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync unavailable";
    console.error("Student dataset sync failed", message);
    if (lease) {
      try {
        await control("release", {
          lease,
          error: "Обновление не завершено. Сохранены предыдущие данные.",
        });
      } catch {
        console.error("Sync lease release failed");
      }
    }
    return json(
      { error: "Data refresh unavailable; previous data retained" },
      503,
    );
  }
});
