import { Execution, Game, Player, UnitType } from "../game/Game";

// Turns fighter interception on or off for one of the player's airports.
export class AirportInterceptExecution implements Execution {
  constructor(
    private player: Player,
    private unitId: number,
    private enabled: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    const unit = mg.unit(this.unitId);
    if (
      unit === undefined ||
      unit === null ||
      !unit.isActive() ||
      unit.type() !== UnitType.Airport ||
      unit.owner() !== this.player
    ) {
      console.warn(
        `AirportInterceptExecution: ${this.unitId} is not an airport of ${this.player.id()}`,
      );
      return;
    }
    unit.setInterceptEnabled(this.enabled);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
