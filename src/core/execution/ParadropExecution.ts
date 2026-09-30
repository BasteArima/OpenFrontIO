import { renderTroops } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AirPathFinder } from "../pathfinding/PathFinder.Air";
import { PseudoRandom } from "../PseudoRandom";
import { AttackExecution } from "./AttackExecution";

// A SAM missile chasing the plane. Whether it hits was rolled at launch; it
// only plays out once the missile reaches the plane.
interface Flak {
  missile: Unit;
  hit: boolean;
}

// Paratroopers: a transport plane takes off from the nearest ready airport,
// flies straight to `dst` and drops its troops there, where they fight on as
// a paradrop AttackExecution from a pocket inside enemy land. Hostile SAM
// launchers get one shot each at the plane as it passes through their range;
// a downed plane takes its troops with it.
export class ParadropExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | null = null;
  private path: TileRef[] = [];
  private index = 0;
  // SAM launchers that have already fired at this plane.
  private firedSams = new Set<number>();
  private flak: Flak[] = [];
  private random: PseudoRandom;

  constructor(
    private player: Player,
    private dst: TileRef,
    private troops: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.isValidRef(this.dst)) {
      console.warn(`ParadropExecution: tile ${this.dst} not valid`);
      this.active = false;
      return;
    }
    if (
      mg.config().isUnitDisabled(UnitType.TransportPlane) ||
      mg.config().isUnitDisabled(UnitType.Airport)
    ) {
      this.active = false;
    }
  }

  tick(ticks: number): void {
    if (this.plane === null) {
      this.launch(ticks);
      return;
    }
    if (!this.plane.isActive()) {
      this.finish();
      return;
    }
    const speed = this.mg.config().transportPlaneSpeed();
    this.index = Math.min(this.index + speed, this.path.length - 1);
    const tile = this.path[this.index];
    this.plane.move(tile);
    this.fireSams(tile);
    if (this.moveFlak(tile)) {
      return;
    }
    if (this.index === this.path.length - 1) {
      this.land();
    }
  }

  private launch(ticks: number): void {
    this.active = false;
    const mg = this.mg;
    const src = this.player.canBuild(UnitType.TransportPlane, this.dst);
    if (src === false) {
      mg.displayMessage(
        "events_display.paradrop_unavailable",
        MessageType.ATTACK_FAILED,
        this.player.id(),
      );
      return;
    }
    const troops = Math.min(
      this.troops,
      this.player.troops() * mg.config().paradropMaxTroopShare(),
    );
    if (troops < 1) {
      return;
    }
    const airport = this.player
      .units(UnitType.Airport)
      .find((a) => a.tile() === src);
    this.plane = this.player.buildUnit(UnitType.TransportPlane, src, {
      troops,
      targetTile: this.dst,
    });
    airport?.launch();
    mg.stats().planeSend(this.player, troops);
    this.random = new PseudoRandom(this.plane.id());
    this.path = new AirPathFinder(mg).findPath(src, this.dst) ?? [src];
    this.recordMotionPlan(ticks);
    this.active = true;

    const target = mg.owner(this.dst);
    if (target.isPlayer()) {
      mg.displayIncomingUnit(
        this.plane.id(),
        // TODO TranslateText (same as the naval invasion alert)
        `Paratroopers incoming from ${this.player.displayName()} (${renderTroops(troops)})`,
        MessageType.NAVAL_INVASION_INBOUND,
        target.id(),
      );
    }
  }

  // Each hostile SAM launcher whose range the plane enters fires once; the
  // roll decides now whether that missile will bring the plane down.
  private fireSams(tile: TileRef): void {
    const config = this.mg.config();
    const sams = this.mg.nearbyUnits(
      tile,
      config.maxSamRange(),
      UnitType.SAMLauncher,
    );
    for (const { unit: sam, distSquared } of sams) {
      if (this.firedSams.has(sam.id())) continue;
      const owner = sam.owner();
      if (owner === this.player || owner.isFriendly(this.player)) continue;
      const range = config.dynamicSamRange(sam, this.mg.ticks());
      if (distSquared > range * range) continue;
      this.firedSams.add(sam.id());
      const hit = this.random.next() < config.samFlakChance(sam.level());
      const missile = owner.buildUnit(UnitType.SAMMissile, sam.tile(), {
        targetUnit: this.plane!,
      });
      this.flak.push({ missile, hit });
    }
  }

  // Moves the missiles in flight toward the plane. Returns true when one of
  // them brought it down.
  private moveFlak(planeTile: TileRef): boolean {
    const mg = this.mg;
    const speed = mg.config().defaultSamMissileSpeed();
    const px = mg.x(planeTile);
    const py = mg.y(planeTile);
    const inFlight: Flak[] = [];
    for (const f of this.flak) {
      if (!f.missile.isActive()) continue;
      const mx = mg.x(f.missile.tile());
      const my = mg.y(f.missile.tile());
      const dx = px - mx;
      const dy = py - my;
      // sqrt is correctly rounded everywhere, unlike hypot.
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > speed) {
        const k = speed / dist;
        f.missile.move(
          mg.ref(Math.round(mx + dx * k), Math.round(my + dy * k)),
        );
        inFlight.push(f);
        continue;
      }
      f.missile.move(planeTile);
      f.missile.setReachedTarget();
      f.missile.delete(false);
      if (f.hit) {
        this.flak = inFlight;
        this.shootDown(f.missile.owner());
        return true;
      }
    }
    this.flak = inFlight;
    return false;
  }

  private shootDown(owner: Player): void {
    const plane = this.plane!;
    const troops = plane.troops();
    plane.delete(false, owner);
    this.finish();
    this.mg.stats().planeShotDown(this.player, owner);
    this.mg.displayMessage(
      "events_display.paradrop_shot_down",
      MessageType.UNIT_DESTROYED,
      this.player.id(),
      undefined,
      { troops: renderTroops(troops), name: owner.displayName() },
    );
    this.mg.displayMessage(
      "events_display.paradrop_shot_down_enemy",
      MessageType.SAM_HIT,
      owner.id(),
      undefined,
      { troops: renderTroops(troops), name: this.player.displayName() },
    );
  }

  // Missiles still chasing the plane have nothing left to hit.
  private finish(): void {
    this.active = false;
    for (const f of this.flak) {
      if (f.missile.isActive()) f.missile.delete(false);
    }
    this.flak = [];
  }

  private land(): void {
    const plane = this.plane!;
    const troops = plane.troops();
    plane.setReachedTarget();
    plane.delete(false);
    this.finish();

    const target: Player | TerraNullius = this.mg.owner(this.dst);
    const canDrop =
      this.mg.isLand(this.dst) &&
      !this.mg.isImpassable(this.dst) &&
      target !== this.player &&
      (!target.isPlayer() || this.player.canAttackPlayer(target));
    if (!canDrop) {
      // The drop zone changed hands on the way (ours, an ally's): fly home.
      this.player.addTroops(troops);
      return;
    }
    this.mg.stats().planeLand(this.player, troops);
    this.mg.addExecution(
      new AttackExecution(
        troops,
        this.player,
        target.id(),
        this.dst,
        false,
        true,
      ),
    );
  }

  // Straight flight at `speed` tiles a tick, sampled for the client the same
  // way movement steps through the path.
  private recordMotionPlan(ticks: number): void {
    const speed = this.mg.config().transportPlaneSpeed();
    const path: TileRef[] = [];
    for (let i = 0; i < this.path.length - 1; i += speed) {
      path.push(this.path[i]);
    }
    path.push(this.path[this.path.length - 1]);
    this.mg.recordMotionPlan({
      kind: "grid",
      unitId: this.plane!.id(),
      planId: 1,
      startTick: ticks + 1,
      ticksPerStep: 1,
      path,
    });
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
