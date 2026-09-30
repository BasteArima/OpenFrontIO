import "../../perf/client/Shims"; // Browser-global shims for client code

import { describe, expect, it } from "vitest";
import { SAMRadiusPass } from "../../../src/client/render/gl/passes/SamRadiusPass";
import { createRenderSettings } from "../../../src/client/render/gl/RenderSettings";
import { UnitState } from "../../../src/client/render/types/Renderer";
import { UnitType } from "../../../src/core/game/Game";

function glStub(): WebGL2RenderingContext {
  const noop = () => {};
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        typeof prop === "string" && /^[A-Z_0-9]+$/.test(prop)
          ? 0
          : prop === "getShaderParameter" || prop === "getProgramParameter"
            ? () => true
            : prop === "getShaderInfoLog" || prop === "getProgramInfoLog"
              ? () => ""
              : typeof prop === "string" && prop.startsWith("create")
                ? () => ({})
                : prop === "getUniformLocation"
                  ? () => ({})
                  : noop,
    },
  ) as WebGL2RenderingContext;
}

const MAP_W = 1000;
const ME = 1;
const ENEMY = 2;

function unit(
  id: number,
  type: UnitType,
  ownerID: number,
  x: number,
  y: number,
  extra: Partial<UnitState> = {},
): UnitState {
  const pos = y * MAP_W + x;
  return {
    id,
    ownerID,
    lastOwnerID: null,
    unitType: type,
    pos,
    lastPos: pos,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    waitTicks: 0,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    constructionStartTick: null,
    targetUnitId: null,
    targetTile: null,
    troops: 0,
    missileTimerQueue: [],
    level: 1,
    veterancy: 0,
    hasTrainStation: false,
    trainType: 0,
    loaded: null,
    samUpgradeStartTick: null,
    samUpgradeStartRange: null,
    samUpgradeTargetLevel: null,
    samUpgradeDuration: null,
    ...extra,
  };
}

// Circles far apart, so each shows as exactly one full-circle instance.
function scene(): Map<number, UnitState> {
  const units = [
    unit(1, UnitType.SAMLauncher, ENEMY, 100, 100),
    unit(2, UnitType.Airport, ENEMY, 500, 100),
    unit(3, UnitType.Airport, ENEMY, 900, 100, { missileTimerQueue: [5] }),
    unit(4, UnitType.Airport, ME, 100, 500),
    unit(5, UnitType.Airport, ENEMY, 500, 500, { interceptDisabled: true }),
    unit(6, UnitType.Airport, ENEMY, 900, 500, { underConstruction: true }),
  ];
  return new Map(units.map((u) => [u.id, u]));
}

// [radius, r, g, b, alpha] of every uploaded instance.
function instances(pass: SAMRadiusPass): number[][] {
  const p = pass as any;
  const out: number[][] = [];
  for (let i = 0; i < p.instanceCount; i++) {
    const d = p.instanceBuf.float32.slice(i * 10, i * 10 + 10);
    out.push([d[2], d[3], d[4], d[5], d[6]]);
  }
  return out;
}

describe("SAMRadiusPass fighter interception zones", () => {
  const newPass = () => {
    const pass = new SAMRadiusPass(
      glStub(),
      MAP_W,
      createRenderSettings(),
      150,
    );
    pass.setLocalPlayer(ME);
    pass.updateStructures(scene(), 0);
    return pass;
  };

  it("shows only SAMs until paratroopers are being aimed", () => {
    const pass = newPass();
    expect(instances(pass)).toHaveLength(1);
    expect(instances(pass)[0].slice(1, 4)).toEqual([1, 0, 0]);
  });

  it("adds hostile airports with interception on, orange-red, faint when reloading", () => {
    const pass = newPass();
    pass.setInterceptZones(true);
    const zones = instances(pass).filter((c) => c[0] === 150);
    expect(zones).toHaveLength(2);
    for (const z of zones) {
      expect(z[1]).toBe(1);
      expect(z[2]).toBeCloseTo(0.45);
      expect(z[3]).toBeCloseTo(0.1);
    }
    const alphas = zones.map((z) => z[4]).sort();
    expect(alphas[0]).toBeCloseTo(0.35);
    expect(alphas[1]).toBe(1);

    pass.setInterceptZones(false);
    expect(instances(pass)).toHaveLength(1);
  });
});
