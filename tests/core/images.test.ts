import { describe, expect, it } from "vitest";
import { ImageError, cleanImage, detectImageType } from "../../server/core/images";
import { contains, jpegWithMetadata, pngWithMetadata, webpWithMetadata } from "../helpers/images";

describe("cleanImage removes location and camera metadata", () => {
  it("JPEG: drops EXIF, XMP, comments and unknown APP segments; keeps JFIF, ICC and image data", () => {
    const input = jpegWithMetadata();
    expect(contains(input, "GPS")).toBe(true);
    const out = cleanImage(input);
    expect(out).toMatchObject({ type: "jpg", width: 32, height: 16 });
    expect(contains(out.bytes, "Exif")).toBe(false);
    expect(contains(out.bytes, "GPS")).toBe(false);
    expect(contains(out.bytes, "xmpmeta")).toBe(false);
    expect(contains(out.bytes, "Shot on my phone")).toBe(false);
    expect(contains(out.bytes, "MPF")).toBe(false);
    expect(contains(out.bytes, "JFIF")).toBe(true);
    expect(contains(out.bytes, "ICC_PROFILE")).toBe(true);
    // Entropy-coded data and end marker are untouched.
    expect(Array.from(out.bytes.slice(-7))).toEqual([0, 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9].slice(1));
  });

  it("PNG: drops eXIf and text chunks; keeps image chunks", () => {
    const out = cleanImage(pngWithMetadata());
    expect(out).toMatchObject({ type: "png", width: 4, height: 3 });
    expect(contains(out.bytes, "GPS")).toBe(false);
    expect(contains(out.bytes, "home kitchen")).toBe(false);
    expect(contains(out.bytes, "IDAT")).toBe(true);
    expect(contains(out.bytes, "IEND")).toBe(true);
  });

  it("WebP: drops EXIF and XMP chunks, clears their flags, and fixes the RIFF size", () => {
    const out = cleanImage(webpWithMetadata());
    expect(out).toMatchObject({ type: "webp", width: 64, height: 48 });
    expect(contains(out.bytes, "GPS")).toBe(false);
    expect(contains(out.bytes, "EXIF")).toBe(false);
    const flags = out.bytes[20]!;
    expect(flags & 0x0c).toBe(0);
    expect(flags & 0x10).toBe(0x10); // alpha flag kept
    const riffSize = new DataView(out.bytes.buffer, out.bytes.byteOffset).getUint32(4, true);
    expect(riffSize).toBe(out.bytes.length - 8);
  });

  it("rejects files that are not images, whatever their declared type", () => {
    expect(detectImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(() => cleanImage(new TextEncoder().encode("<html>"))).toThrow(ImageError);
    expect(() => cleanImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow(ImageError);
    expect(() => cleanImage(new Uint8Array())).toThrow(ImageError);
  });
});
