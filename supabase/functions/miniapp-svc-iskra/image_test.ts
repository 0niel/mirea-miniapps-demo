import { sanitizeImage, sanitizeImageBytes } from "./image.ts";

function assert(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

Deno.test("JPEG metadata is stripped and dimensions are retained", () => {
  const jpeg = new Uint8Array([
    0xff,
    0xd8,
    ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]),
    ...segment(0xc0, [8, 0, 100, 0, 80, 1, 1, 0x11, 0]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
    1,
    2,
    3,
    0xff,
    0xd9,
  ]);
  const sanitized = sanitizeImageBytes(jpeg);
  assert(sanitized.mime === "image/jpeg", "JPEG MIME was not detected");
  assert(sanitized.width === 80 && sanitized.height === 100, "Wrong size");
  assert(
    !new TextDecoder().decode(sanitized.bytes).includes("Exif"),
    "EXIF remained in sanitized output",
  );
});

Deno.test("spoofed and oversized-dimension images are rejected", () => {
  let spoofedRejected = false;
  try {
    sanitizeImageBytes(new TextEncoder().encode("not an image"));
  } catch {
    spoofedRejected = true;
  }
  assert(spoofedRejected, "Spoofed image was accepted");

  let dimensionsRejected = false;
  try {
    sanitizeImageBytes(
      new Uint8Array([
        0xff,
        0xd8,
        ...segment(0xc0, [8, 0x13, 0x89, 0, 10, 1, 1, 0x11, 0]),
        ...segment(0xda, [1, 1, 0, 0, 63, 0]),
        1,
        0xff,
        0xd9,
      ]),
    );
  } catch {
    dimensionsRejected = true;
  }
  assert(dimensionsRejected, "Oversized dimensions were accepted");
});

Deno.test("PNG and JPEG are decoded and re-encoded as bounded JPEG", async () => {
  const source = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  const pngResult = await sanitizeImage(
    new Blob([source], { type: "application/octet-stream" }),
  );
  assert(pngResult.mime === "image/jpeg", "PNG was not normalized to JPEG");
  assert(
    pngResult.bytes[0] === 0xff && pngResult.bytes[1] === 0xd8,
    "Normalized output is not JPEG",
  );
  const normalized = new Uint8Array(pngResult.bytes.length);
  normalized.set(pngResult.bytes);
  const jpegResult = await sanitizeImage(
    new Blob([normalized.buffer], { type: "image/png" }),
  );
  assert(
    jpegResult.width === 1 && jpegResult.height === 1,
    "JPEG decode failed",
  );
});
