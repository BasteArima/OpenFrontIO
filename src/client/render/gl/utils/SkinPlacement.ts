/**
 * Where and how big a player's territory skin is drawn.
 *
 * Every skin lives in a SKIN_DIM×SKIN_DIM atlas layer. Stamp modes keep the
 * picture at its own size, centred in the layer; tile mode stretches it over
 * the whole layer so the shader can repeat the layer itself. The shader then
 * maps a map tile to a layer coordinate from two values per player:
 *
 *   texel 0: (anchorX, anchorY, tile ? 1 : 0, 0)  — anchor in map tiles
 *   texel 1: (kx, ky, 0, 0)
 *     stamp: kx = ky = map tiles per picture pixel (zoom)
 *     tile:  kx, ky = one tile's size in map tiles
 *
 * Players without a display setting get the original behaviour: the picture
 * at 1 pixel per tile, centred on their spawn.
 */

export type SkinDisplayMode =
  | "spawn"
  | "mapCenter"
  | "territory"
  | "tile"
  | "fitMap";

export interface SkinDisplaySetting {
  mode: SkinDisplayMode;
  /** Long side in map tiles (stamp modes) or of one tile (tile mode). */
  size?: number;
}

export interface SkinPlacementInput {
  display: SkinDisplaySetting | undefined;
  /** Picture size as decoded, in pixels; null while it is still loading. */
  image: { width: number; height: number } | null;
  spawn: { x: number; y: number } | null;
  center: { x: number; y: number } | null;
  mapW: number;
  mapH: number;
  layerSize: number;
}

/** The 8 floats the shader reads for one player (see the header). */
export function skinPlacement(i: SkinPlacementInput): Float32Array {
  const mode = i.display?.mode ?? "spawn";
  const out = new Float32Array(8);

  const anchor =
    mode === "mapCenter" || mode === "fitMap"
      ? { x: i.mapW / 2, y: i.mapH / 2 }
      : mode === "territory"
        ? (i.center ?? i.spawn)
        : i.spawn;
  out[0] = anchor?.x ?? 0;
  out[1] = anchor?.y ?? 0;

  const w = i.image?.width ?? i.layerSize;
  const h = i.image?.height ?? i.layerSize;

  if (mode === "tile") {
    const size = i.display?.size ?? Math.max(w, h);
    const long = Math.max(w, h);
    out[2] = 1;
    out[4] = Math.max(1, (size * w) / long);
    out[5] = Math.max(1, (size * h) / long);
    return out;
  }

  // Stamp: the picture sits in the layer at its own size, shrunk only when it
  // is larger than the layer.
  const fit = Math.min(1, i.layerSize / w, i.layerSize / h);
  const drawnW = w * fit;
  const drawnH = h * fit;
  let zoom = 1;
  if (mode === "fitMap") {
    zoom = Math.max(i.mapW / drawnW, i.mapH / drawnH);
  } else if (i.display?.size !== undefined) {
    zoom = i.display.size / Math.max(drawnW, drawnH);
  }
  out[4] = zoom;
  out[5] = zoom;
  return out;
}
