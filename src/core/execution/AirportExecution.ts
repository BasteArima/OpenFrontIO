import { Execution, Game, Unit } from "../game/Game";

// Frees an airport's sortie slots as their cooldown runs out, the way
// MissileSiloExecution reloads silos (one slot per airport level).
export class AirportExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(private airport: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.airport.isUnderConstruction()) {
      return;
    }
    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }
    const frontTime = this.airport.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }
    if (this.mg.ticks() - frontTime >= this.mg.config().airportCooldown()) {
      this.airport.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
