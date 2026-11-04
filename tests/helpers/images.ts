// Hand-built image byte streams for metadata tests (structure only, not decodable pixels).

const bytes = (...parts: (number[] | string | Uint8Array)[]) => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array(out);
};
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

function jpegSegment(marker: number, payload: Uint8Array) {
  return bytes([0xff, marker], u16be(payload.length + 2), payload);
}

/** JPEG with JFIF, EXIF (with GPS text), XMP, COM, ICC and SOF0 (32×16). */
export function jpegWithMetadata() {
  return bytes(
    [0xff, 0xd8],
    jpegSegment(0xe0, bytes("JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0])),
    jpegSegment(0xe1, bytes("Exif\0\0MM\0*GPSLatitude 37.7749 GPSLongitude -122.4194")),
    jpegSegment(0xe1, bytes("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPS</x:xmpmeta>")),
    jpegSegment(0xfe, bytes("Shot on my phone at home")),
    jpegSegment(0xe2, bytes("ICC_PROFILE\0", [1, 1, 9, 9])),
    jpegSegment(0xe2, bytes("MPF\0", [0, 0])),
    jpegSegment(0xc0, bytes([8], u16be(16), u16be(32), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])),
    jpegSegment(0xda, bytes([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    [0x12, 0x34, 0xff, 0x00, 0x56],
    [0xff, 0xd9],
  );
}

function pngChunk(type: string, data: Uint8Array) {
  return bytes(u32be(data.length), type, data, [0, 0, 0, 0]);
}

/** PNG (4×3) with eXIf, tEXt and iTXt chunks. */
export function pngWithMetadata() {
  return bytes(
    [0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", bytes(u32be(4), u32be(3), [8, 2, 0, 0, 0])),
    pngChunk("eXIf", bytes("MM\0*GPS")),
    pngChunk("tEXt", bytes("Comment\0home kitchen")),
    pngChunk("iTXt", bytes("XML:com.adobe.xmp\0\0\0\0\0GPS")),
    pngChunk("IDAT", bytes([1, 2, 3])),
    pngChunk("IEND", new Uint8Array()),
  );
}

function riffChunk(fourcc: string, data: Uint8Array) {
  const pad = data.length % 2 ? [0] : [];
  return bytes(fourcc, u32le(data.length), data, pad);
}

/** Extended WebP (64×48) declaring and containing EXIF and XMP. */
export function webpWithMetadata() {
  const body = bytes(
    "WEBP",
    riffChunk("VP8X", bytes([0x0c | 0x10, 0, 0, 0], u24le(63), u24le(47))),
    riffChunk("VP8L", bytes([0x2f, 0, 0, 0, 0, 1, 2])),
    riffChunk("EXIF", bytes("MM\0*GPSLatitude")),
    riffChunk("XMP ", bytes("<x:xmpmeta>GPS</x:xmpmeta>")),
  );
  return bytes("RIFF", u32le(body.length), body);
}

export function contains(haystack: Uint8Array, needle: string) {
  return new TextDecoder("latin1").decode(haystack).includes(needle);
}
