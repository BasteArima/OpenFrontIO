import type { AttackRingInput, UnitState } from "../../types";
import { UT_TRANSPORT } from "../../types";

/**
 * Extract attack ring indicators for transport ships with active targets.
 * Optionally filter to a specific owner (live path filters to local player).
 */
export function extractAttackRings(
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  owner: number,
): AttackRingInput[] {
  const rings: AttackRingInput[] = [];
  for (const u of units.values()) {
    if (u.unitType !== UT_TRANSPORT) continue;
    if (u.targetTile === null || !u.isActive || u.retreating) continue;
    if (u.ownerID !== owner) continue;
    const t = u.targetTile;
    rings.push({ x: t % mapW, y: (t - (t % mapW)) / mapW, unitId: u.id });
  }
  return rings;
}

/**
 * Rings at the focus points of the local player's land attacks (attack_focus),
 * drawn with the same dashed ring as transport targets. Keyed by target player
 * rather than attack id so the ring doesn't blink when reinforcing replaces
 * the attack; negative keys keep clear of transport unit ids.
 */
export function extractFocusRings(
  attacks: readonly {
    targetID: number;
    retreating: boolean;
    focusTile?: number | null;
  }[],
  mapW: number,
): AttackRingInput[] {
  const rings: AttackRingInput[] = [];
  for (const a of attacks) {
    const t = a.focusTile;
    if (t === null || t === undefined || a.retreating) continue;
    rings.push({
      x: t % mapW,
      y: (t - (t % mapW)) / mapW,
      unitId: -1 - a.targetID,
    });
  }
  return rings;
}
