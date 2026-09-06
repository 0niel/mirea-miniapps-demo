export type Asset = {
  path: string;
  sha256: string;
  bytes: number;
  count: number;
  dataset: "curriculum" | "discounts";
};
export type Manifest = {
  schema_version: 1;
  generated_at: string;
  assets: Asset[];
};
export const REPOSITORY = "0niel/mirea-miniapps-demo";

export function manifestOf(value: unknown): Manifest {
  const manifest = value as Manifest;
  if (
    !manifest || manifest.schema_version !== 1 ||
    !Number.isFinite(Date.parse(manifest.generated_at)) ||
    !Array.isArray(manifest.assets) || manifest.assets.length < 1 ||
    manifest.assets.length > 4096
  ) throw new Error("Invalid manifest");
  const paths = new Set<string>();
  let bytes = 0;
  for (const asset of manifest.assets) {
    const allowedPath = asset.dataset === "curriculum"
      ? /^curriculum\/data\/catalog-\d{3,5}(?:-[0-9a-f]{12})?\.json$/
      : asset.dataset === "discounts" &&
        asset.path === "discounts/data/catalog.json";
    if (
      !(allowedPath === true ||
        allowedPath instanceof RegExp && allowedPath.test(asset.path)) ||
      !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      !Number.isInteger(asset.bytes) || asset.bytes < 2 ||
      asset.bytes > 1_048_576 ||
      !Number.isInteger(asset.count) || asset.count < 1 || asset.count > 200 ||
      paths.has(asset.path)
    ) throw new Error("Invalid asset");
    paths.add(asset.path);
    bytes += asset.bytes;
  }
  if (bytes > 134_217_728) throw new Error("Dataset too large");
  return manifest;
}

export function rawUrl(revision: string, path: string): string {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Invalid revision");
  return `https://raw.githubusercontent.com/${REPOSITORY}/${revision}/${path}`;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function readCapped(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error("Source unavailable");
  if (Number(response.headers.get("content-length")) > limit) {
    throw new Error("Source too large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("Source too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function verifiedPayload(
  asset: Asset,
  bytes: Uint8Array,
): Promise<Record<string, unknown>> {
  if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) {
    throw new Error("Source checksum mismatch");
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  const entries = asset.dataset === "curriculum" ? data.plans : data.offers;
  if (
    data.schema_version !== 1 || !Array.isArray(entries) ||
    entries.length !== asset.count
  ) {
    throw new Error("Source count mismatch");
  }
  return data;
}
