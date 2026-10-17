import { base64url } from "jose";
import { describe, expect, test } from "vitest";
import {
  encodePattern,
  fitSize,
  thresholdBits,
} from "../../src/client/selfhost/ImageProcessing";
import { decodePatternData } from "../../src/core/PatternDecoder";

describe("self-host image processing", () => {
  test("encodePattern round-trips through the engine's decoder", () => {
    for (const [w, h, scale] of [
      [2, 2, 0],
      [37, 11, 1],
      [128, 64, 2],
    ]) {
      const bits = Array.from({ length: w * h }, (_, i) => (i * 7) % 3 === 0);
      const encoded = encodePattern(w, h, scale, bits.map(Number));
      const d = decodePatternData(encoded, base64url.decode);
      expect([d.width, d.height, d.scale]).toEqual([w, h, scale]);
      for (let i = 0; i < w * h; i++) {
        const set = (d.bytes[3 + (i >> 3)] & (1 << (i & 7))) !== 0;
        expect(set).toBe(bits[i]);
      }
    }
  });

  test("encodePattern refuses sizes the renderer can't hold", () => {
    expect(() => encodePattern(1, 4, 0, [])).toThrow();
    expect(() => encodePattern(129, 65, 0, [])).toThrow();
  });

  test("thresholdBits marks dark cells, or light ones when inverted", () => {
    const luma = Uint8Array.from([0, 100, 200, 255]);
    expect(Array.from(thresholdBits(luma, 128, false))).toEqual([1, 1, 0, 0]);
    expect(Array.from(thresholdBits(luma, 128, true))).toEqual([0, 0, 1, 1]);
  });

  test("fitSize keeps the aspect ratio and never upscales", () => {
    expect(fitSize(4000, 2000, 1024, 1024)).toEqual({
      width: 1024,
      height: 512,
    });
    expect(fitSize(300, 200, 1024, 1024)).toEqual({ width: 300, height: 200 });
  });
});
