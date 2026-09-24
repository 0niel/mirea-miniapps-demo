import { appLink, queuePath } from "./domain.ts";
import { encodePng, qrMatrix, qrPng } from "./qr.ts";

const assert = (v: unknown, message = "Assertion failed") => {
  if (!v) throw new Error(message);
};

async function inflate(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunks(
  png: Uint8Array<ArrayBuffer>,
): Map<string, Uint8Array<ArrayBuffer>> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out = new Map<string, Uint8Array<ArrayBuffer>>();
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    out.set(type, png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return out;
}

Deno.test("queue links fit a compact QR with finder patterns", () => {
  const matrix = qrMatrix(appLink(queuePath("K7F2QX")));
  assert(matrix.length >= 29 && matrix.length <= 41);
  for (
    const [r, c] of [[0, 0], [0, matrix.length - 7], [matrix.length - 7, 0]]
  ) {
    assert(matrix[r][c] && matrix[r + 6][c + 6] && matrix[r + 3][c + 3]);
    assert(!matrix[r + 1][c + 1]);
  }
});

Deno.test("png encodes a palette image with quiet zone and dark modules", async () => {
  const png = await encodePng([[true, false], [false, true]], 4, 1);
  assert(png[0] === 0x89 && png[1] === 0x50);
  const parts = chunks(png);
  const header = new DataView(
    parts.get("IHDR")!.buffer,
    parts.get("IHDR")!.byteOffset,
  );
  assert(header.getUint32(0) === 16 && header.getUint32(4) === 16);
  assert(parts.get("PLTE")!.length === 6);
  const raw = await inflate(parts.get("IDAT")!);
  assert(raw.length === 16 * 3);
  const pixel = (x: number, y: number) =>
    (raw[y * 3 + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
  assert(pixel(0, 0) === 0);
  assert(pixel(5, 5) === 1);
  assert(pixel(9, 5) === 0);
  assert(pixel(10, 10) === 1);
  assert(parts.has("IEND"));
});

Deno.test("queue QR renders at a crisp size", async () => {
  const png = await qrPng(appLink(queuePath("K7F2QX")));
  const header = chunks(png).get("IHDR")!;
  const size = new DataView(header.buffer, header.byteOffset).getUint32(0);
  assert(size >= 500 && size <= 800);
  assert(png.length < 12000);
});
