import { convertIndexedToRgb, decode as decodePng } from "fast-png";
import type { DecodedPng } from "fast-png";
import jpegJs from "jpeg-js";

export type SanitizedImage = {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
  width: number;
  height: number;
};

const maxBytes = 5_242_880;
const maxDimension = 5000;
const maxPixels = 13_000_000;
const storedMaxDimension = 1024;

type PixelImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

export async function sanitizeImage(source: Blob): Promise<SanitizedImage> {
  if (source.size === 0 || source.size > maxBytes) {
    throw new Error("Invalid photo size");
  }
  const input = new Uint8Array(await source.arrayBuffer());
  const orientation = jpegOrientation(input);
  const validated = sanitizeImageBytes(input);
  let image: PixelImage;
  try {
    image = validated.mime === "image/jpeg"
      ? decodeJpeg(validated.bytes)
      : decodePngToRgba(validated.bytes);
  } catch (error) {
    throw new Error("Invalid photo encoding", { cause: error });
  }
  if (image.width !== validated.width || image.height !== validated.height) {
    throw new Error("Invalid photo dimensions");
  }
  image = applyOrientation(image, orientation);
  if (Math.max(image.width, image.height) > storedMaxDimension) {
    const factor = storedMaxDimension / Math.max(image.width, image.height);
    image = resizeBilinear(
      image,
      Math.max(1, Math.round(image.width * factor)),
      Math.max(1, Math.round(image.height * factor)),
    );
  }
  compositeTransparency(image.data);
  const output = jpegJs.encode(image, 84).data;
  return {
    bytes: Uint8Array.from(output),
    mime: "image/jpeg",
    extension: "jpg",
    width: image.width,
    height: image.height,
  };
}

function decodeJpeg(bytes: Uint8Array): PixelImage {
  const decoded = jpegJs.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 13,
    maxMemoryUsageInMB: 64,
  });
  return {
    data: Uint8Array.from(decoded.data),
    width: decoded.width,
    height: decoded.height,
  };
}

function decodePngToRgba(bytes: Uint8Array): PixelImage {
  const decoded = decodePng(bytes, { checkCrc: true });
  if (decoded.depth !== 8) throw new Error("Unsupported PNG bit depth");
  let channels = decoded.channels;
  let source = decoded.data;
  if (decoded.palette) {
    source = convertIndexedToRgb(decoded);
    channels = decoded.palette[0]?.length ?? 0;
  }
  if (channels < 1 || channels > 4) throw new Error("Invalid PNG channels");
  const expected = decoded.width * decoded.height * channels;
  if (source.length !== expected) throw new Error("Invalid PNG data length");
  const output = new Uint8Array(decoded.width * decoded.height * 4);
  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel++) {
    const input = pixel * channels;
    const target = pixel * 4;
    if (channels === 1 || channels === 2) {
      const gray = source[input];
      output[target] = gray;
      output[target + 1] = gray;
      output[target + 2] = gray;
      output[target + 3] = channels === 2
        ? source[input + 1]
        : transparentGray(decoded, gray);
    } else {
      output[target] = source[input];
      output[target + 1] = source[input + 1];
      output[target + 2] = source[input + 2];
      output[target + 3] = channels === 4
        ? source[input + 3]
        : transparentRgb(decoded, source, input);
    }
  }
  return { data: output, width: decoded.width, height: decoded.height };
}

function transparentGray(decoded: DecodedPng, gray: number): number {
  return decoded.transparency?.[0] === gray ? 0 : 255;
}

function transparentRgb(
  decoded: DecodedPng,
  data: ArrayLike<number>,
  offset: number,
): number {
  const transparent = decoded.transparency;
  return transparent?.length === 3 && transparent[0] === data[offset] &&
      transparent[1] === data[offset + 1] &&
      transparent[2] === data[offset + 2]
    ? 0
    : 255;
}

function applyOrientation(image: PixelImage, orientation: number): PixelImage {
  if (orientation === 1) return image;
  const swapped = orientation >= 5;
  const width = swapped ? image.height : image.width;
  const height = swapped ? image.width : image.height;
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      let targetX = x;
      let targetY = y;
      if (orientation === 2) targetX = image.width - 1 - x;
      if (orientation === 3) {
        targetX = image.width - 1 - x;
        targetY = image.height - 1 - y;
      }
      if (orientation === 4) targetY = image.height - 1 - y;
      if (orientation === 5) {
        targetX = y;
        targetY = x;
      }
      if (orientation === 6) {
        targetX = image.height - 1 - y;
        targetY = x;
      }
      if (orientation === 7) {
        targetX = image.height - 1 - y;
        targetY = image.width - 1 - x;
      }
      if (orientation === 8) {
        targetX = y;
        targetY = image.width - 1 - x;
      }
      const source = (y * image.width + x) * 4;
      const target = (targetY * width + targetX) * 4;
      output.set(image.data.subarray(source, source + 4), target);
    }
  }
  return { data: output, width, height };
}

function resizeBilinear(
  image: PixelImage,
  width: number,
  height: number,
): PixelImage {
  const output = new Uint8Array(width * height * 4);
  const xScale = image.width / width;
  const yScale = image.height / height;
  for (let y = 0; y < height; y++) {
    const sourceY = Math.max(
      0,
      Math.min(image.height - 1, (y + 0.5) * yScale - 0.5),
    );
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(y0 + 1, image.height - 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < width; x++) {
      const sourceX = Math.max(
        0,
        Math.min(image.width - 1, (x + 0.5) * xScale - 0.5),
      );
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(x0 + 1, image.width - 1);
      const xWeight = sourceX - x0;
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = image.data[(y0 * image.width + x0) * 4 + channel] *
            (1 - xWeight) +
          image.data[(y0 * image.width + x1) * 4 + channel] * xWeight;
        const bottom = image.data[(y1 * image.width + x0) * 4 + channel] *
            (1 - xWeight) +
          image.data[(y1 * image.width + x1) * 4 + channel] * xWeight;
        output[target + channel] = Math.round(
          top * (1 - yWeight) + bottom * yWeight,
        );
      }
    }
  }
  return { data: output, width, height };
}

function compositeTransparency(data: Uint8Array): void {
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] / 255;
    data[offset] = Math.round(data[offset] * alpha + 255 * (1 - alpha));
    data[offset + 1] = Math.round(
      data[offset + 1] * alpha + 255 * (1 - alpha),
    );
    data[offset + 2] = Math.round(
      data[offset + 2] * alpha + 255 * (1 - alpha),
    );
    data[offset + 3] = 255;
  }
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

  if (!width || !height || !sawScan || !sawEnd || position !== bytes.length) {
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
      if (
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

  if (!sawHeader || !sawData || !sawEnd || position !== bytes.length) {
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
