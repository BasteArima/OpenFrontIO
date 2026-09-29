import {
  Difficulty,
  Game,
  Player,
  PlayerType,
  Relation,
  Tick,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { assertNever } from "../../Util";
import { ParadropExecution } from "../ParadropExecution";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import {
  EMOJI_AGGRESSIVE_ATTACK,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";
import {
  everyNth,
  PARADROP_TARGET_STRUCTURES,
  randTerritoryTileArray,
} from "./NationUtils";

/** Minimum ticks between two drops of one nation (plus up to 50% jitter). */
const PARADROP_COOLDOWN_TICKS_HARD = 1200; // 2 min
const PARADROP_COOLDOWN_TICKS_IMPOSSIBLE = 600; // 1 min

/**
 * Minimum troops / maxTroops before a nation spares troops for a drop, so it
 * doesn't strip its own defense. Nations attack by land once they pass their
 * trigger ratio (50-60%), so this sits around it.
 */
const MIN_TROOP_RATIO_HARD = 0.5;
const MIN_TROOP_RATIO_IMPOSSIBLE = 0.45;

/** Share of current troops put on a plane, in percent: [min, max) */
const TROOP_SHARE_PERCENT_HARD: [number, number] = [15, 20];
const TROOP_SHARE_PERCENT_IMPOSSIBLE: [number, number] = [20, 26];

/** Incoming land attacks at or above this share of own troops: keep everyone home. */
const HEAVY_ATTACK_RATIO = 0.5;

/** A drop whose plane survives hostile flak with lower probability is skipped. */
const MIN_FLIGHT_SURVIVAL = 0.5;

/** At most this many enemies are considered per decision. */
const MAX_ENEMIES = 3;
/** At most this many enemy structures (per enemy) are drop candidates. */
const MAX_STRUCTURE_CANDIDATES = 40;
/** Random enemy tiles (per enemy) added as drop candidates. */
const RANDOM_TILE_CANDIDATES = 8;
/** Own border tiles sampled to measure how deep behind the front a drop is. */
const OWN_BORDER_SAMPLE_SIZE = 64;

/** Enemy structures within this radius of the drop add to its value. */
const DROP_VALUE_RADIUS = 20;
/** Depth behind the enemy front (from our border) at which the depth bonus maxes out. */
const DROP_DEPTH_CAP = 60;
const DROP_DEPTH_WEIGHT = 3;
/** Drops below this value (plain land, close to the front) aren't worth a plane. */
const MIN_DROP_VALUE = 3;

/**
 * Rough size (in tiles) of the area the dropped troops have to fight through
 * at first; the local defense is the enemy's troop density times this.
 */
const LOCAL_DEFENSE_AREA_TILES = 400;
/** The drop must outnumber the local defense by this factor. */
const LOCAL_DEFENSE_MARGIN = 1.5;

function structureDropValue(type: UnitType): number {
  switch (type) {
    case UnitType.City:
    case UnitType.Factory:
      return 3;
    case UnitType.Port:
      return 2;
    case UnitType.MissileSilo:
      return 5;
    case UnitType.SAMLauncher:
    case UnitType.Airport:
      return 4;
    // Defense posts make the landing zone much harder to hold
    case UnitType.DefensePost:
      return -4;
    default:
      return 0;
  }
}

interface DropCandidate {
  tile: TileRef;
  target: Player;
  score: number;
}

/**
 * Hard / Impossible nations launch transport planes (ParadropExecution) from
 * their airports at enemies they are fighting, aiming at valuable structures
 * behind the front while avoiding flight paths covered by hostile SAMs.
 */
export class NationParadropBehavior {
  private nextDropTick: Tick = 0;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private attackBehavior: AiAttackBehavior,
    private emojiBehavior?: NationEmojiBehavior,
  ) {}

  maybeSendParadrop(): boolean {
    const game = this.game;
    const config = game.config();
    const { difficulty } = config.gameConfig();
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return false;
    }
    if (
      config.isUnitDisabled(UnitType.Airport) ||
      config.isUnitDisabled(UnitType.TransportPlane)
    ) {
      return false;
    }
    const airports = this.readyAirports();
    if (airports.length === 0) return false;
    if (game.ticks() < this.nextDropTick) return false;
    if (
      this.player.gold() <
      game.unitInfo(UnitType.TransportPlane).cost(game, this.player)
    ) {
      return false;
    }
    if (!this.hasTroopsToSpare(difficulty)) return false;

    const enemies = this.findEnemies();
    if (enemies.length === 0) return false;

    // Don't fire at the first chance every time
    const launchOdds = difficulty === Difficulty.Impossible ? 2 : 3;
    if (!this.random.chance(launchOdds)) return false;

    const troops = this.dropTroops(difficulty);
    if (troops < 1) return false;

    const best = this.findBestDrop(enemies, airports, troops);
    if (best === null) return false;

    game.addExecution(new ParadropExecution(this.player, best.tile, troops));
    const cooldown =
      difficulty === Difficulty.Impossible
        ? PARADROP_COOLDOWN_TICKS_IMPOSSIBLE
        : PARADROP_COOLDOWN_TICKS_HARD;
    this.nextDropTick =
      game.ticks() + cooldown + this.random.nextInt(0, cooldown / 2);
    this.emojiBehavior?.maybeSendEmoji(best.target, EMOJI_AGGRESSIVE_ATTACK);
    return true;
  }

  private readyAirports(): Unit[] {
    return this.player
      .units(UnitType.Airport)
      .filter(
        (a) => a.isActive() && !a.isUnderConstruction() && !a.isInCooldown(),
      );
  }

  private hasTroopsToSpare(difficulty: Difficulty): boolean {
    const player = this.player;
    const troops = player.troops();
    if (troops <= 0) return false;
    const maxTroops = this.game.config().maxTroops(player);
    const minRatio =
      difficulty === Difficulty.Impossible
        ? MIN_TROOP_RATIO_IMPOSSIBLE
        : MIN_TROOP_RATIO_HARD;
    if (troops < maxTroops * minRatio) return false;

    const incomingLand = player
      .incomingAttacks()
      .filter((a) => a.sourceTile() === null)
      .reduce((sum, a) => sum + a.troops(), 0);
    return incomingLand < troops * HEAVY_ATTACK_RATIO;
  }

  private dropTroops(difficulty: Difficulty): number {
    let range: [number, number];
    switch (difficulty) {
      case Difficulty.Hard:
        range = TROOP_SHARE_PERCENT_HARD;
        break;
      case Difficulty.Impossible:
        range = TROOP_SHARE_PERCENT_IMPOSSIBLE;
        break;
      case Difficulty.Easy:
      case Difficulty.Medium:
        return 0;
      default:
        assertNever(difficulty);
    }
    const share = Math.min(
      this.random.nextInt(range[0], range[1]) / 100,
      this.game.config().paradropMaxTroopShare(),
    );
    return Math.floor(this.player.troops() * share);
  }

  /**
   * Players this nation is at war with: whoever attacks us hardest, whoever
   * we attack, and hostile neighbors. Tribes (bots), allies and teammates
   * are skipped.
   */
  findEnemies(): Player[] {
    const player = this.player;
    const found = new Set<Player>();
    const incoming = this.attackBehavior.findIncomingAttackPlayer();
    if (incoming !== null) found.add(incoming);
    for (const attack of player.outgoingAttacks()) {
      const target = attack.target();
      if (target.isPlayer()) found.add(target);
    }
    for (const n of player.nearby()) {
      if (
        n.isPlayer() &&
        n !== player &&
        player.relation(n) <= Relation.Hostile
      ) {
        found.add(n);
      }
    }

    const enemies: Player[] = [];
    for (const p of found) {
      if (enemies.length >= MAX_ENEMIES) break;
      if (p === player || !p.isAlive()) continue;
      if (p.type() === PlayerType.Bot) continue;
      if (player.isFriendly(p) || !player.canAttackPlayer(p)) continue;
      if (!this.attackBehavior.shouldAttack(p)) continue;
      enemies.push(p);
    }
    return enemies;
  }

  /**
   * Scores a bounded set of drop tiles (enemy structures in range plus a few
   * random enemy tiles) and returns the best one, or null if no drop is
   * worth it.
   */
  findBestDrop(
    enemies: Player[],
    airports: Unit[],
    troops: number,
  ): DropCandidate | null {
    const game = this.game;
    const range = game.config().paradropRange();
    const rangeSquared = range * range;
    const inRange = (tile: TileRef) =>
      airports.some(
        (a) => game.euclideanDistSquared(a.tile(), tile) <= rangeSquared,
      );
    const hostileSams = game.units(UnitType.SAMLauncher).filter((sam) => {
      const owner = sam.owner();
      return owner !== this.player && !owner.isFriendly(this.player);
    });
    const ownBorder = everyNth(
      Array.from(this.player.borderTiles()),
      OWN_BORDER_SAMPLE_SIZE,
    );

    let best: DropCandidate | null = null;
    for (const enemy of enemies) {
      // Only drop where the troops outnumber what's waiting on the ground
      const density = enemy.troops() / Math.max(1, enemy.numTilesOwned());
      if (troops < density * LOCAL_DEFENSE_AREA_TILES * LOCAL_DEFENSE_MARGIN) {
        continue;
      }

      const structureTiles = enemy
        .units(PARADROP_TARGET_STRUCTURES)
        .map((u) => u.tile())
        .filter(inRange);
      const candidates = everyNth(
        structureTiles,
        MAX_STRUCTURE_CANDIDATES,
      ).concat(
        randTerritoryTileArray(
          this.random,
          game,
          enemy,
          RANDOM_TILE_CANDIDATES,
        ).filter(inRange),
      );

      for (const tile of new Set(candidates)) {
        if (game.owner(tile) !== enemy) continue;
        const src = this.player.canBuild(UnitType.TransportPlane, tile);
        if (src === false) continue;
        const value = this.dropValue(tile, enemy, ownBorder);
        if (value < MIN_DROP_VALUE) continue;
        const survival = this.flightSurvival(src, tile, hostileSams);
        if (survival < MIN_FLIGHT_SURVIVAL) continue;
        const score = value * survival;
        if (best === null || score > best.score) {
          best = { tile, target: enemy, score };
        }
      }
    }
    return best;
  }

  /**
   * Value of dropping on `tile`: enemy structures around the landing zone
   * (defense posts count against it) plus a bonus for being deep behind the
   * front, measured from our own border.
   */
  private dropValue(
    tile: TileRef,
    enemy: Player,
    ownBorder: TileRef[],
  ): number {
    const game = this.game;
    let value = 1;
    for (const { unit } of game.nearbyUnits(tile, DROP_VALUE_RADIUS, [
      ...PARADROP_TARGET_STRUCTURES,
      UnitType.DefensePost,
    ])) {
      if (unit.owner() !== enemy) continue;
      value += structureDropValue(unit.type()) * unit.level();
    }

    let depthSquared = Infinity;
    for (const b of ownBorder) {
      const d = game.euclideanDistSquared(tile, b);
      if (d < depthSquared) depthSquared = d;
    }
    if (depthSquared !== Infinity) {
      const depth = Math.min(Math.sqrt(depthSquared), DROP_DEPTH_CAP);
      value += (depth / DROP_DEPTH_CAP) * DROP_DEPTH_WEIGHT;
    }
    return value;
  }

  /**
   * Chance that a plane flying straight from `src` to `dst` is not shot
   * down: product of (1 - flak chance) over hostile SAMs whose range the
   * flight line crosses (ParadropExecution gives each such SAM one roll).
   */
  flightSurvival(src: TileRef, dst: TileRef, hostileSams: Unit[]): number {
    const game = this.game;
    const config = game.config();
    const ticks = game.ticks();
    const ax = game.x(src);
    const ay = game.y(src);
    const bx = game.x(dst);
    const by = game.y(dst);
    let survival = 1;
    for (const sam of hostileSams) {
      const range = config.dynamicSamRange(sam, ticks);
      const d2 = segmentDistSquared(
        game.x(sam.tile()),
        game.y(sam.tile()),
        ax,
        ay,
        bx,
        by,
      );
      if (d2 > range * range) continue;
      survival *= 1 - config.samFlakChance(sam.level());
    }
    return survival;
  }
}

/** Squared distance from point (px, py) to the segment (ax, ay)-(bx, by). */
function segmentDistSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSquared = dx * dx + dy * dy;
  let t = 0;
  if (lenSquared > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSquared;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}
