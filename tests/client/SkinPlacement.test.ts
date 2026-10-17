import { describe, expect, test } from "vitest";
import { skinPlacement } from "../../src/client/render/gl/utils/SkinPlacement";

const base = {
  image: { width: 1000, height: 500 },
  spawn: { x: 300, y: 200 },
  center: { x: 400, y: 250 },
  mapW: 2000,
  mapH: 1000,
  layerSize: 1024,
};

describe("skinPlacement", () => {
  test("no setting: 1 pixel per tile, centred on the spawn", () => {
    const p = skinPlacement({ ...base, display: undefined });
    expect([...p.slice(0, 6)]).toEqual([300, 200, 0, 0, 1, 1]);
  });

  test("map centre anchors on the middle of the map", () => {
    const p = skinPlacement({ ...base, display: { mode: "mapCenter" } });
    expect([p[0], p[1]]).toEqual([1000, 500]);
  });

  test("size scales the long side to that many tiles", () => {
    const p = skinPlacement({
      ...base,
      display: { mode: "spawn", size: 250 },
    });
    expect(p[4]).toBeCloseTo(0.25);
    expect(p[5]).toBeCloseTo(0.25);
  });

  test("an oversized picture is shrunk into the layer first", () => {
    const p = skinPlacement({
      ...base,
      image: { width: 2048, height: 1024 },
      display: { mode: "spawn", size: 2048 },
    });
    // Drawn at 1024 wide in the layer, so 2 tiles per layer pixel.
    expect(p[4]).toBeCloseTo(2);
  });

  test("tile mode gives one tile's size, keeping the aspect", () => {
    const p = skinPlacement({ ...base, display: { mode: "tile", size: 100 } });
    expect(p[2]).toBe(1);
    expect([p[4], p[5]]).toEqual([100, 50]);
  });

  test("whole map covers both dimensions", () => {
    const p = skinPlacement({
      ...base,
      image: { width: 500, height: 500 },
      display: { mode: "fitMap" },
    });
    expect([p[0], p[1]]).toEqual([1000, 500]);
    // A square must reach 2000 wide to cover a 2000×1000 map.
    expect(p[4]).toBeCloseTo(4);
  });

  test("territory follows the centre, falling back to the spawn", () => {
    const display = { mode: "territory" as const };
    expect([...skinPlacement({ ...base, display }).slice(0, 2)]).toEqual([
      400, 250,
    ]);
    expect([
      ...skinPlacement({ ...base, center: null, display }).slice(0, 2),
    ]).toEqual([300, 200]);
  });
});
