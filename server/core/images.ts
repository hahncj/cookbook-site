// Image checks and metadata removal. Pure byte handling: runs on Workers and Node.
// Photos are re-encoded in the browser before upload (which already drops
// metadata); this is the server-side guarantee that stored photos carry no
// location or camera metadata even if a client skips that step.

export type ImageType = "jpg" | "png" | "webp";

export const IMAGE_CONTENT_TYPES: Record<ImageType, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export interface CleanImage {
  type: ImageType;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export class ImageError extends Error {}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && ascii(bytes, 1, 3) === "PNG" && bytes[0] === 0x89) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return null;
}

/** Validates, strips metadata, and reads dimensions. Throws ImageError for anything unusable. */
export function cleanImage(input: Uint8Array): CleanImage {
  const type = detectImageType(input);
  if (!type) throw new ImageError("Unsupported image format. Use JPEG, PNG or WebP.");
  const result = type === "jpg" ? cleanJpeg(input) : type === "png" ? cleanPng(input) : cleanWebp(input);
  if (result.width < 1 || result.height < 1 || result.width > 12000 || result.height > 12000) {
    throw new ImageError("Image dimensions are not valid.");
  }
  return { type, ...result };
}

// ---------- JPEG ----------

// Keep JFIF (APP0), ICC color profiles (APP2 "ICC_PROFILE") and Adobe (APP14,
// needed for correct colors). Drop everything else in APP1–APP15 (EXIF, XMP,
// IPTC/Photoshop, maker data) and comments (COM).
function keepJpegSegment(marker: number, bytes: Uint8Array, dataStart: number): boolean {
  if (marker === 0xfe) return false; // COM
  if (marker < 0xe0 || marker > 0xef) return true; // not an APPn segment
  if (marker === 0xe0 || marker === 0xee) return true; // APP0, APP14
  if (marker === 0xe2) return ascii(bytes, dataStart, 11) === "ICC_PROFILE";
  return false;
}

function cleanJpeg(bytes: Uint8Array) {
  const out: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new ImageError("Damaged JPEG.");
    let marker = bytes[offset + 1]!;
    while (marker === 0xff) {
      offset++; // fill bytes
      marker = bytes[offset + 1]!;
    }
    if (marker === 0xd9) {
      out.push(bytes.subarray(offset, offset + 2));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) throw new ImageError("Damaged JPEG.");
    const segmentEnd = offset + 2 + length;
    // SOF markers carry the dimensions (C0–CF except C4, C8, CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
    }
    if (marker === 0xda) {
      // Start of scan: entropy-coded data follows; copy the rest unchanged.
      out.push(bytes.subarray(offset));
      offset = bytes.length;
      break;
    }
    if (keepJpegSegment(marker, bytes, offset + 4)) out.push(bytes.subarray(offset, segmentEnd));
    offset = segmentEnd;
  }
  if (!width || !height) throw new ImageError("Damaged JPEG.");
  return { width, height, bytes: concat(out) };
}

// ---------- PNG ----------

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function cleanPng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let width = 0;
  let height = 0;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new ImageError("Damaged PNG.");
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
    }
    if (!PNG_DROP.has(type)) out.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  if (!width || !height) throw new ImageError("Damaged PNG.");
  return { width, height, bytes: concat(out) };
}

// ---------- WebP ----------

function cleanWebp(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [];
  let offset = 12;
  let width = 0;
  let height = 0;
  while (offset + 8 <= bytes.length) {
    const fourcc = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (offset + 8 + size > bytes.length) throw new ImageError("Damaged WebP.");
    const data = offset + 8;
    if (fourcc === "VP8X") {
      width = 1 + (bytes[data + 4]! | (bytes[data + 5]! << 8) | (bytes[data + 6]! << 16));
      height = 1 + (bytes[data + 7]! | (bytes[data + 8]! << 8) | (bytes[data + 9]! << 16));
      const copy = bytes.slice(offset, Math.min(end, bytes.length));
      copy[8] = copy[8]! & ~0x0c; // clear the EXIF and XMP flags
      chunks.push(copy);
    } else if (fourcc === "VP8 " && !width) {
      width = view.getUint16(data + 6, true) & 0x3fff;
      height = view.getUint16(data + 8, true) & 0x3fff;
      chunks.push(bytes.subarray(offset, Math.min(end, bytes.length)));
    } else if (fourcc === "VP8L" && !width) {
      const b = bytes.subarray(data + 1, data + 5);
      width = 1 + (b[0]! | ((b[1]! & 0x3f) << 8));
      height = 1 + ((b[1]! >> 6) | (b[2]! << 2) | ((b[3]! & 0x0f) << 10));
      chunks.push(bytes.subarray(offset, Math.min(end, bytes.length)));
    } else if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      chunks.push(bytes.subarray(offset, Math.min(end, bytes.length)));
    }
    offset = end;
  }
  if (!width || !height) throw new ImageError("Damaged WebP.");
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return { width, height, bytes: concat([header, body]) };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
