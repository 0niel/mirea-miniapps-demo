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
    0,
    1,
  ]);
  const sanitized = sanitizeImageBytes(jpeg);
  assert(sanitized.mime === "image/jpeg", "JPEG MIME was not detected");
  assert(sanitized.width === 80 && sanitized.height === 100, "Wrong size");
  assert(
    !new TextDecoder().decode(sanitized.bytes).includes("Exif"),
    "EXIF remained in sanitized output",
  );
  assert(
    sanitized.bytes.at(-2) === 0xff && sanitized.bytes.at(-1) === 0xd9,
    "JPEG trailing payload was retained",
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

Deno.test("PNG remains displayable without metadata", async () => {
  const source = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  const pngResult = await sanitizeImage(
    new Blob([source], { type: "application/octet-stream" }),
  );
  assert(pngResult.mime === "image/png", "PNG MIME was not retained");
  assert(
    pngResult.bytes[0] === 0x89 && pngResult.bytes[1] === 0x50,
    "Sanitized output is not PNG",
  );
  assert(pngResult.width === 1 && pngResult.height === 1, "Wrong PNG size");
});

Deno.test("WebP photos are accepted and retain their dimensions", async () => {
  const source = Uint8Array.from(
    atob("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"),
    (character) => character.charCodeAt(0),
  );
  const result = await sanitizeImage(
    new Blob([source], { type: "image/webp" }),
  );
  assert(result.mime === "image/webp", "WebP MIME was not detected");
  assert(result.extension === "webp", "Wrong WebP extension");
  assert(result.width === 1 && result.height === 1, "Wrong WebP size");
});
