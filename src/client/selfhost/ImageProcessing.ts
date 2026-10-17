// Turning a player's picture into something the game can use: a downscaled
// PNG for skins and flags, or a 2-colour bitmap for territory patterns.

export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// onload rather than img.decode(): decode() can stall in a background tab.
export function loadImageUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** Size that fits `w`×`h` inside `maxW`×`maxH`, never upscaling. */
export function fitSize(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const k = Math.min(1, maxW / w, maxH / h);
  return {
    width: Math.max(1, Math.round(w * k)),
    height: Math.max(1, Math.round(h * k)),
  };
}

/**
 * Re-encodes the image as PNG no larger than `maxW`×`maxH`. Re-encoding also
 * strips whatever else the file carried (metadata, other formats).
 */
export function toPng(
  img: HTMLImageElement,
  maxW: number,
  maxH: number,
): { base64: string; dataUrl: string; width: number; height: number } {
  const { width, height } = fitSize(
    img.naturalWidth,
    img.naturalHeight,
    maxW,
    maxH,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/png");
  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    width,
    height,
  };
}

export interface PatternOptions {
  /** Cells across; the height follows the picture's aspect ratio. */
  cells: number;
  /** 0–255 luminance cut: darker cells become the second colour. */
  threshold: number;
  invert: boolean;
}

// Engine limits (PatternDecoder.ts, WebGLFrameBuilder.ts): 2–129 by 2–65
// cells, at most 1024 bytes of bitmap per player.
export const PATTERN_MAX_W = 128;
export const PATTERN_MAX_H = 64;
const PATTERN_MAX_CELLS = 8192;

/** Grayscale cells of the picture, row-major, plus their dimensions. */
export function patternCells(
  img: HTMLImageElement,
  cells: number,
): { width: number; height: number; luma: Uint8Array } {
  let width = Math.max(2, Math.min(PATTERN_MAX_W, Math.round(cells)));
  let height = Math.max(
    2,
    Math.min(
      PATTERN_MAX_H,
      Math.round((width * img.naturalHeight) / img.naturalWidth),
    ),
  );
  while (width * height > PATTERN_MAX_CELLS) {
    width = Math.max(2, width - 2);
    height = Math.max(
      2,
      Math.min(
        PATTERN_MAX_H,
        Math.round((width * img.naturalHeight) / img.naturalWidth),
      ),
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // transparent areas read as light
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = Math.round(
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2],
    );
  }
  return { width, height, luma };
}

/** 1 = second colour, per cell. */
export function thresholdBits(
  luma: Uint8Array,
  threshold: number,
  invert: boolean,
): Uint8Array {
  const bits = new Uint8Array(luma.length);
  for (let i = 0; i < luma.length; i++) {
    const dark = luma[i] < threshold;
    bits[i] = dark !== invert ? 1 : 0;
  }
  return bits;
}

/**
 * Encodes a bitmap in the engine's pattern format (PatternDecoder.ts):
 * [0][scale | (w-2)<<3][(w-2)>>5 | (h-2)<<2] then 1 bit per cell, row-major,
 * least significant bit first; base64url without padding.
 */
export function encodePattern(
  width: number,
  height: number,
  scale: number,
  bits: ArrayLike<number>,
): string {
  if (width < 2 || width > 129 || height < 2 || height > 65) {
    throw new Error(`pattern size ${width}x${height} out of range`);
  }
  if (width * height > PATTERN_MAX_CELLS) throw new Error("pattern too large");
  const w2 = width - 2;
  const h2 = height - 2;
  const bytes = new Uint8Array(3 + ((width * height + 7) >> 3));
  bytes[0] = 0;
  bytes[1] = (scale & 7) | ((w2 & 0x1f) << 3);
  bytes[2] = ((w2 >> 5) & 3) | (h2 << 2);
  for (let i = 0; i < width * height; i++) {
    if (bits[i]) bytes[3 + (i >> 3)] |= 1 << (i & 7);
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
