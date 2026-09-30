import { describe, expect, test } from "vitest";
import {
  buildPlaneRoute,
  choosePlaneAirport,
  samThreatensNukePreview,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";
import { UnitType } from "../../../src/core/game/Game";

describe("BuildPreviewController ghost preservation (locked nuke / Enter confirm)", () => {
  describe("shouldPreserveGhostAfterBuild", () => {
    test("returns true for AtomBomb so ghost is not cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.AtomBomb)).toBe(true);
    });

    test("returns true for HydrogenBomb so ghost is not cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.HydrogenBomb)).toBe(true);
    });

    test("returns false for City so ghost is cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.City)).toBe(false);
    });

    test("returns false for Factory so ghost is cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.Factory)).toBe(false);
    });

    test("returns false for other buildable types (Port, DefensePost, MissileSilo, SAMLauncher, Warship, MIRV)", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.Port)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.DefensePost)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.MissileSilo)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.SAMLauncher)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.Warship)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.MIRV)).toBe(false);
    });
  });
});

describe("samThreatensNukePreview (nuke trajectory threat set, #4226)", () => {
  const teammates = new Set([7, 8]);
  const allies = new Set([2, 3]);

  test("non-friendly SAM threatens the trajectory", () => {
    expect(samThreatensNukePreview(5, teammates, allies, new Set())).toBe(true);
  });

  test("allied SAM does not threaten when the strike breaks no alliance", () => {
    expect(samThreatensNukePreview(2, teammates, allies, new Set())).toBe(
      false,
    );
  });

  test("would-be-betrayed ally's SAM threatens (alliance breaks at launch)", () => {
    expect(samThreatensNukePreview(2, teammates, allies, new Set([2]))).toBe(
      true,
    );
  });

  test("other allies' SAMs still excluded when a different ally is betrayed", () => {
    expect(samThreatensNukePreview(3, teammates, allies, new Set([2]))).toBe(
      false,
    );
  });

  test("teammate SAM does not threaten the trajectory", () => {
    expect(samThreatensNukePreview(7, teammates, new Set(), new Set())).toBe(
      false,
    );
  });

  test("teammate SAM stays excluded even if listed as betrayed (a strike never breaks a team)", () => {
    expect(
      samThreatensNukePreview(7, teammates, new Set([7]), new Set([7])),
    ).toBe(false);
  });
});

describe("paratrooper route preview", () => {
  const range = 100;

  test("a ready airport in range beats a closer one that is reloading", () => {
    const route = choosePlaneAirport(
      [
        { x: 10, y: 0, ready: false },
        { x: 60, y: 0, ready: true },
      ],
      0,
      0,
      range,
    );
    expect(route).toEqual({ srcX: 60, srcY: 0, state: "ready" });
  });

  test("the nearest ready airport in range is used", () => {
    const route = choosePlaneAirport(
      [
        { x: 90, y: 0, ready: true },
        { x: 30, y: 0, ready: true },
      ],
      0,
      0,
      range,
    );
    expect(route?.srcX).toBe(30);
  });

  test("reloading airports in range show as cooldown", () => {
    const route = choosePlaneAirport(
      [
        { x: 50, y: 0, ready: false },
        { x: 500, y: 0, ready: true },
      ],
      0,
      0,
      range,
    );
    expect(route).toEqual({ srcX: 50, srcY: 0, state: "cooldown" });
  });

  test("out of range falls back to the nearest airport", () => {
    const route = choosePlaneAirport(
      [
        { x: 300, y: 0, ready: true },
        { x: 200, y: 0, ready: true },
      ],
      0,
      0,
      range,
    );
    expect(route).toEqual({ srcX: 200, srcY: 0, state: "out_of_range" });
    expect(choosePlaneAirport([], 0, 0, range)).toBeNull();
  });

  test("the line turns red where the plane can't go", () => {
    const ready = { srcX: 0, srcY: 0, state: "ready" as const };
    expect(buildPlaneRoute(ready, 50, 0, range, true).tSamIntercept).toBe(1);
    expect(
      buildPlaneRoute(ready, 50, 0, range, false).tSamIntercept,
    ).toBeLessThan(1);
    const far = { srcX: 0, srcY: 0, state: "out_of_range" as const };
    expect(buildPlaneRoute(far, 200, 0, range, true).tSamIntercept).toBe(0.5);
    const busy = { srcX: 0, srcY: 0, state: "cooldown" as const };
    expect(buildPlaneRoute(busy, 50, 0, range, true).tSamIntercept).toBe(0);
    // Straight line: control points on the segment.
    const line = buildPlaneRoute(ready, 30, 60, range, true);
    expect([line.p1x, line.p1y, line.p2x, line.p2y]).toEqual([10, 20, 20, 40]);
  });
});
