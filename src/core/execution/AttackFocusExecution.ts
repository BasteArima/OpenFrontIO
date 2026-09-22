import { Execution, Game, Player } from "../game/Game";
import { TileRef } from "../game/GameMap";

// Sets (or clears, with a null tile) the focus point of one of the player's
// own land attacks. AttackExecution notices the change on its next tick and
// re-prioritises its front toward the point.
export class AttackFocusExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private attackID: string,
    private tile: TileRef | null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;

    const attack = this.player
      .outgoingAttacks()
      .find((a) => a.id() === this.attackID);
    // Boat landings expand from their beachhead only; focus is for land fronts.
    if (!attack || attack.retreating() || attack.sourceTile() !== null) {
      return;
    }
    if (this.tile === null) {
      this.player.setAttackFocus(this.attackID, null);
      return;
    }
    if (!mg.isValidRef(this.tile)) {
      console.warn(`AttackFocusExecution: tile ${this.tile} not valid`);
      return;
    }
    // Only a point inside the land being attacked makes sense as a target.
    // Water is unowned too, but a focus there could never be taken (and so
    // never clear) during an attack on terra nullius.
    if (
      !mg.map().isLand(this.tile) ||
      mg.map().ownerID(this.tile) !== attack.target().smallID()
    ) {
      return;
    }
    this.player.setAttackFocus(this.attackID, this.tile);
  }

  tick(ticks: number): void {}

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
