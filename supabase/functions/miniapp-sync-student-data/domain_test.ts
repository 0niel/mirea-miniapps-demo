import {
  manifestOf,
  rawUrl,
  readCapped,
  sha256,
  verifiedPayload,
} from "./domain.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}
function fails(action: () => unknown) {
  let failed = false;
  try {
    action();
  } catch {
    failed = true;
  }
  equal(failed, true);
}
const asset = {
  path: "curriculum/data/catalog-000.json",
  sha256: "a".repeat(64),
  bytes: 100,
  count: 2,
  dataset: "curriculum",
};
const manifest = {
  schema_version: 1,
  generated_at: "2026-09-06T00:00:00Z",
  assets: [asset],
};

Deno.test("manifest accepts bounded official artifacts and rejects path injection", () => {
  equal(manifestOf(manifest).assets.length, 1);
  equal(
    manifestOf({
      ...manifest,
      assets: [{
        ...asset,
        path: "curriculum/data/catalog-000-abcdef012345.json",
      }],
    }).assets.length,
    1,
  );
  for (
    const path of [
      "https://attacker.example/data",
      "../data.json",
      "curriculum/data/../../config",
      "curriculum/data/catalog-000.json?url=x",
    ]
  ) {
    fails(() => manifestOf({ ...manifest, assets: [{ ...asset, path }] }));
  }
});
Deno.test("manifest rejects duplicate, oversized and unknown datasets", () => {
  fails(() => manifestOf({ ...manifest, assets: [asset, asset] }));
  fails(() =>
    manifestOf({ ...manifest, assets: [{ ...asset, bytes: 1048577 }] })
  );
  fails(() => manifestOf({ ...manifest, assets: [{ ...asset, count: 201 }] }));
  fails(() =>
    manifestOf({ ...manifest, assets: [{ ...asset, dataset: "users" }] })
  );
  fails(() => manifestOf({ ...manifest, assets: [] }));
});
Deno.test("only immutable revisions are accepted", () => {
  equal(
    rawUrl("a".repeat(40), "data/manifest.json"),
    `https://raw.githubusercontent.com/0niel/mirea-miniapps-demo/${
      "a".repeat(40)
    }/data/manifest.json`,
  );
  fails(() => rawUrl("main", "data/manifest.json"));
});
Deno.test("payload hash and record count bind import to manifest", async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ schema_version: 1, plans: [{ id: "one" }] }),
  );
  const verified = {
    ...asset,
    dataset: "curriculum" as const,
    count: 1,
    bytes: bytes.length,
    sha256: await sha256(bytes),
  };
  equal((await verifiedPayload(verified, bytes)).schema_version, 1);
  let rejected = 0;
  for (
    const changed of [{ ...verified, count: 2 }, {
      ...verified,
      sha256: "b".repeat(64),
    }]
  ) {
    try {
      await verifiedPayload(changed, bytes);
    } catch {
      rejected++;
    }
  }
  equal(rejected, 2);
});
Deno.test("stream cap holds even when content length is absent", async () => {
  equal((await readCapped(new Response("test"), 4)).length, 4);
  let rejected = false;
  try {
    await readCapped(new Response("oversized"), 3);
  } catch {
    rejected = true;
  }
  equal(rejected, true);
});
