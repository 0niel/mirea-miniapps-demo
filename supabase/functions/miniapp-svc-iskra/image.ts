export type SanitizedImage = {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
};

const maxBytes = 5_242_880;
const maxDimension = 5000;
const maxPixels = 13_000_000;
export async function sanitizeImage(source: Blob): Promise<SanitizedImage> {
  if (source.size === 0 || source.size > maxBytes) {
    throw new Error("Invalid photo size");
  }
  const input = new Uint8Array(await source.arrayBuffer());
  const orientation = jpegOrientation(input);
  const validated = sanitizeImageBytes(input);
  if (validated.mime !== "image/jpeg" || orientation === 1) return validated;
  const bytes = concat([
    validated.bytes.slice(0, 2),
    exifOrientationSegment(orientation),
    validated.bytes.slice(2),
  ]);
  if (bytes.length > maxBytes) throw new Error("Invalid photo size");
  return {
    ...validated,
    bytes,
  };
}

function exifOrientationSegment(orientation: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let position = 2;
  while (position + 4 < bytes.length && bytes[position] === 0xff) {
    const marker = bytes[position + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = readU16(bytes, position + 2);
    const end = position + 2 + length;
    if (length < 2 || end > bytes.length) break;
    if (
      marker === 0xe1 && length >= 14 &&
      bytes[position + 4] === 0x45 && bytes[position + 5] === 0x78 &&
      bytes[position + 6] === 0x69 && bytes[position + 7] === 0x66 &&
      bytes[position + 8] === 0 && bytes[position + 9] === 0
    ) {
      const tiff = position + 10;
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
      if (!little && !big) return 1;
      const u16 = (offset: number) =>
        little
          ? bytes[offset] + bytes[offset + 1] * 256
          : readU16(bytes, offset);
      const u32 = (offset: number) =>
        little
          ? (bytes[offset] + bytes[offset + 1] * 256 +
            bytes[offset + 2] * 65536 + bytes[offset + 3] * 16777216) >>> 0
          : readU32(bytes, offset);
      if (u16(tiff + 2) !== 42) return 1;
      const directory = tiff + u32(tiff + 4);
      if (directory + 2 > end) return 1;
      const entries = u16(directory);
      for (let index = 0; index < entries; index++) {
        const entry = directory + 2 + index * 12;
        if (entry + 12 > end) return 1;
        if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    position = end;
  }
  return 1;
}

export function sanitizeImageBytes(bytes: Uint8Array): SanitizedImage {
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error("Invalid photo size");
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return sanitizeJpeg(bytes);
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d &&
    bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return sanitizePng(bytes);
  }
  if (
    bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) return sanitizeWebp(bytes);
  throw new Error("Invalid photo type");
}

function sanitizeJpeg(bytes: Uint8Array): SanitizedImage {
  const chunks: Uint8Array[] = [bytes.slice(0, 2)];
  let position = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  let sawEnd = false;

  while (position < bytes.length) {
    if (bytes[position] !== 0xff) throw new Error("Invalid JPEG structure");
    const markerStart = position;
    while (position < bytes.length && bytes[position] === 0xff) position++;
    if (position >= bytes.length) throw new Error("Invalid JPEG structure");
    const marker = bytes[position];

    if (marker === 0xd9) {
      chunks.push(new Uint8Array([0xff, 0xd9]));
      sawEnd = true;
      position++;
      break;
    }
    if (marker === 0x00 || marker === 0xd8) {
      throw new Error("Invalid JPEG marker");
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(new Uint8Array([0xff, marker]));
      position++;
      continue;
    }
    if (position + 2 >= bytes.length) throw new Error("Truncated JPEG");
    const length = readU16(bytes, position + 1);
    if (length < 2) throw new Error("Invalid JPEG segment");
    const segmentEnd = position + 1 + length;
    if (segmentEnd > bytes.length) throw new Error("Truncated JPEG");

    if (isStartOfFrame(marker)) {
      if (length < 8) throw new Error("Invalid JPEG frame");
      height = readU16(bytes, position + 4);
      width = readU16(bytes, position + 6);
      assertDimensions(width, height);
    }

    if (marker === 0xda) {
      sawScan = true;
      chunks.push(bytes.slice(markerStart, segmentEnd));
      position = segmentEnd;
      const scanStart = position;
      while (position < bytes.length) {
        if (bytes[position] !== 0xff) {
          position++;
          continue;
        }
        let next = position + 1;
        while (next < bytes.length && bytes[next] === 0xff) next++;
        if (next >= bytes.length) throw new Error("Truncated JPEG scan");
        const scanMarker = bytes[next];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          position = next + 1;
          continue;
        }
        chunks.push(bytes.slice(scanStart, position));
        break;
      }
      continue;
    }

    const isMetadata = (marker >= 0xe1 && marker <= 0xed) ||
      marker === 0xef || marker === 0xfe;
    if (!isMetadata) chunks.push(bytes.slice(markerStart, segmentEnd));
    position = segmentEnd;
  }

  if (!width || !height || !sawScan || !sawEnd) {
    throw new Error("Invalid JPEG image");
  }
  return {
    bytes: concat(chunks),
    mime: "image/jpeg",
    extension: "jpg",
    width,
    height,
  };
}

function sanitizePng(bytes: Uint8Array): SanitizedImage {
  const chunks: Uint8Array[] = [bytes.slice(0, 8)];
  const decoder = new TextDecoder("ascii");
  let position = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;

  while (position + 12 <= bytes.length) {
    const length = readU32(bytes, position);
    const end = position + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG");
    const typeBytes = bytes.slice(position + 4, position + 8);
    const type = decoder.decode(typeBytes);
    const expectedCrc = readU32(bytes, position + 8 + length);
    const actualCrc = crc32(bytes.slice(position + 4, position + 8 + length));
    if (expectedCrc !== actualCrc) throw new Error("Invalid PNG checksum");

    if (!sawHeader && type !== "IHDR") throw new Error("Invalid PNG header");
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new Error("Invalid PNG header");
      width = readU32(bytes, position + 8);
      height = readU32(bytes, position + 12);
      assertDimensions(width, height);
      const bitDepth = bytes[position + 16];
      const colorType = bytes[position + 17];
      const validDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        ([4, 6].includes(colorType) && [8, 16].includes(bitDepth));
      if (
        !validDepth ||
        bytes[position + 18] !== 0 || bytes[position + 19] !== 0 ||
        bytes[position + 20] > 1
      ) {
        throw new Error("Unsupported PNG encoding");
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      sawData = true;
    } else if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      throw new Error("Animated images are not supported");
    } else if (type === "IEND") {
      if (length !== 0) throw new Error("Invalid PNG end");
      sawEnd = true;
    } else if ((typeBytes[0] & 0x20) === 0 && type !== "PLTE") {
      throw new Error("Unsupported PNG chunk");
    }

    if (
      ["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "sRGB"].includes(
        type,
      )
    ) {
      chunks.push(bytes.slice(position, end));
    }
    position = end;
    if (sawEnd) break;
  }

  if (!sawHeader || !sawData || !sawEnd) {
    throw new Error("Invalid PNG image");
  }
  return {
    bytes: concat(chunks),
    mime: "image/png",
    extension: "png",
    width,
    height,
  };
}

function sanitizeWebp(bytes: Uint8Array): SanitizedImage {
  if (readU32Le(bytes, 4) !== bytes.length - 8) {
    throw new Error("Invalid WebP size");
  }
  const chunks: Uint8Array[] = [];
  let position = 12;
  let width = 0;
  let height = 0;
  let sawImage = false;
  while (position + 8 <= bytes.length) {
    const type = ascii(bytes, position, position + 4);
    const length = readU32Le(bytes, position + 4);
    const end = position + 8 + length;
    const paddedEnd = end + (length & 1);
    if (end > bytes.length || paddedEnd > bytes.length) {
      throw new Error("Truncated WebP");
    }
    if (type === "ANIM" || type === "ANMF") {
      throw new Error("Animated images are not supported");
    }
    if (type === "VP8X") {
      if (length < 10 || (bytes[position + 8] & 0x02) !== 0) {
        throw new Error("Invalid WebP header");
      }
      width = 1 + readU24Le(bytes, position + 12);
      height = 1 + readU24Le(bytes, position + 15);
      assertDimensions(width, height);
      const chunk = bytes.slice(position, paddedEnd);
      chunk[8] &= 0xd3;
      chunks.push(chunk);
    } else if (type === "VP8 ") {
      if (
        length < 10 || bytes[position + 11] !== 0x9d ||
        bytes[position + 12] !== 0x01 || bytes[position + 13] !== 0x2a
      ) throw new Error("Invalid WebP frame");
      width = readU16Le(bytes, position + 14) & 0x3fff;
      height = readU16Le(bytes, position + 16) & 0x3fff;
      assertDimensions(width, height);
      sawImage = true;
      chunks.push(bytes.slice(position, paddedEnd));
    } else if (type === "VP8L") {
      if (length < 5 || bytes[position + 8] !== 0x2f) {
        throw new Error("Invalid WebP frame");
      }
      width = 1 + bytes[position + 9] +
        ((bytes[position + 10] & 0x3f) << 8);
      height = 1 + ((bytes[position + 10] & 0xc0) >> 6) +
        (bytes[position + 11] << 2) +
        ((bytes[position + 12] & 0x0f) << 10);
      assertDimensions(width, height);
      sawImage = true;
      chunks.push(bytes.slice(position, paddedEnd));
    } else if (!["EXIF", "XMP ", "ICCP"].includes(type)) {
      chunks.push(bytes.slice(position, paddedEnd));
    }
    position = paddedEnd;
  }
  if (!sawImage || !width || !height || position !== bytes.length) {
    throw new Error("Invalid WebP image");
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode("RIFF"), 0);
  writeU32Le(header, 4, body.length + 4);
  header.set(new TextEncoder().encode("WEBP"), 8);
  return {
    bytes: concat([header, body]),
    mime: "image/webp",
    extension: "webp",
    width,
    height,
  };
}

function isStartOfFrame(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf);
}

function assertDimensions(width: number, height: number): void {
  if (
    width < 1 || height < 1 || width > maxDimension ||
    height > maxDimension || width * height > maxPixels
  ) {
    throw new Error("Invalid photo dimensions");
  }
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 + bytes[offset + 3]
  ) >>> 0;
}

function readU16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readU24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000;
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] + bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000
  ) >>> 0;
}

function writeU32Le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
