import { AttackExecution } from "../src/core/execution/AttackExecution";
import { ParadropExecution } from "../src/core/execution/ParadropExecution";
import { RetreatExecution } from "../src/core/execution/RetreatExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Attack,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import {
  PLANE_INDEX_DOWNED,
  PLANE_INDEX_LAND,
  PLANE_INDEX_LOST,
  PLANE_INDEX_SENT,
  PLANE_INDEX_TROOPS_LANDED,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { constructionExecution } from "./util/utils";

// Troops don't grow on their own here, so any troop change is the paradrop's.
class NoGrowth extends TestConfig {
  troopIncreaseRate(): number {
    return 0;
  }
}

// plains: 100x100, all land. The attacker holds x < 50, the defender the rest.
async function newGame(configClass: typeof TestConfig = NoGrowth): Promise<{
  game: Game;
  attacker: Player;
  defender: Player;
}> {
  const game = await setup(
    "plains",
    { instantBuild: true, infiniteGold: true },
    [],
    undefined,
    configClass,
  );
  const attackerInfo = new PlayerInfo(
    "attacker",
    PlayerType.Human,
    "attacker_client",
    "attacker_id",
  );
  const defenderInfo = new PlayerInfo(
    "defender",
    PlayerType.Human,
    "defender_client",
    "defender_id",
  );
  game.addPlayer(attackerInfo);
  game.addPlayer(defenderInfo);
  game.addExecution(
    new SpawnExecution("game_id", attackerInfo, game.ref(10, 50)),
    new SpawnExecution("game_id", defenderInfo, game.ref(90, 50)),
  );
  game.executeNextTick();
  game.executeNextTick();
  const attacker = game.player(attackerInfo.id);
  const defender = game.player(defenderInfo.id);
  game.map().forEachTile((t) => {
    (game.x(t) < 50 ? attacker : defender).conquer(t);
  });
  attacker.addTroops(100_000);
  defender.addTroops(100_000);
  game.executeNextTick();
  // An airport on the attacker's side, in range of the whole map.
  constructionExecution(game, attacker, 20, 50, UnitType.Airport);
  return { game, attacker, defender };
}

function paradropAttack(player: Player): Attack | undefined {
  return player.outgoingAttacks().find((a) => a.isParadrop());
}

function planeStats(game: Game, player: Player): bigint[] {
  return game.stats().getPlayerStats(player)?.planes ?? [];
}

class SureFlak extends NoGrowth {
  samFlakChance(): number {
    return 1;
  }
}

class NoFlak extends NoGrowth {
  samFlakChance(): number {
    return 0;
  }
}

function run(game: Game, ticks: number) {
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}

// Ticks until the transport plane is gone (landed or shot down).
function fly(game: Game, player: Player) {
  for (let i = 0; i < 200; i++) {
    game.executeNextTick();
    if (player.units(UnitType.TransportPlane).length === 0) return;
  }
  throw new Error("plane never arrived");
}

describe("Paradrop", () => {
  test("drops a paradrop attack with its landing zone deep in enemy land", async () => {
    const { game, attacker, defender } = await newGame();
    const dst: TileRef = game.ref(80, 50);
    game.addExecution(new ParadropExecution(attacker, dst, 10_000));
    game.executeNextTick();
    game.executeNextTick();
    expect(attacker.units(UnitType.TransportPlane)).toHaveLength(1);
    expect(defender.units(UnitType.TransportPlane)).toHaveLength(0);

    fly(game, attacker);
    game.executeNextTick();
    expect(game.owner(dst)).toBe(attacker);
    expect(game.owner(game.ref(82, 50))).toBe(attacker);
    const attack = paradropAttack(attacker);
    expect(attack).toBeDefined();
    expect(attack!.target()).toBe(defender);
  });

  test("the pocket is not annexed while the group lives, and it wears down", async () => {
    const { game, attacker } = await newGame();
    const dst = game.ref(80, 50);
    game.addExecution(new ParadropExecution(attacker, dst, 10_000));
    game.executeNextTick();
    fly(game, attacker);
    game.executeNextTick();
    const start = paradropAttack(attacker)!.troops();

    run(game, 60);
    expect(game.owner(dst)).toBe(attacker);
    const attack = paradropAttack(attacker);
    expect(attack).toBeDefined();
    expect(attack!.troops()).toBeLessThan(start * 0.95);
  });

  test("surrendering loses the troops and the pocket falls", async () => {
    const { game, attacker, defender } = await newGame();
    const dst = game.ref(80, 50);
    game.addExecution(new ParadropExecution(attacker, dst, 10_000));
    game.executeNextTick();
    fly(game, attacker);
    game.executeNextTick();
    const troopsBefore = attacker.troops();
    game.addExecution(
      new RetreatExecution(attacker, paradropAttack(attacker)!.id()),
    );
    run(game, 25);
    expect(paradropAttack(attacker)).toBeUndefined();
    // Nothing came home.
    expect(attacker.troops()).toBe(troopsBefore);
    run(game, 25);
    expect(game.owner(dst)).toBe(defender);
  });

  test("linking up with the main territory brings the group home", async () => {
    const { game, attacker } = await newGame();
    // Close enough to the front at x = 50 for the pocket to reach it.
    const dst = game.ref(56, 50);
    game.addExecution(new ParadropExecution(attacker, dst, 10_000));
    game.executeNextTick();
    fly(game, attacker);
    game.executeNextTick();
    const troopsBefore = attacker.troops();
    for (let i = 0; i < 300 && paradropAttack(attacker) !== undefined; i++) {
      game.executeNextTick();
    }
    expect(paradropAttack(attacker)).toBeUndefined();
    expect(attacker.troops() - troopsBefore).toBeGreaterThan(1_000);
    expect(game.owner(dst)).toBe(attacker);
  });

  test("a hostile SAM can shoot the plane down with everyone aboard", async () => {
    const { game, attacker, defender } = await newGame(SureFlak);
    constructionExecution(game, defender, 80, 55, UnitType.SAMLauncher);
    const dst = game.ref(80, 50);
    const troopsBefore = attacker.troops();
    game.addExecution(new ParadropExecution(attacker, dst, 10_000));
    game.executeNextTick();
    fly(game, attacker);
    run(game, 3);
    expect(paradropAttack(attacker)).toBeUndefined();
    expect(game.owner(dst)).toBe(defender);
    expect(attacker.troops()).toBeLessThan(troopsBefore);
  });

  test("the SAM missile flies to the plane before bringing it down", async () => {
    const { game, attacker, defender } = await newGame(SureFlak);
    constructionExecution(game, defender, 80, 55, UnitType.SAMLauncher);
    game.addExecution(
      new ParadropExecution(attacker, game.ref(80, 50), 10_000),
    );
    game.executeNextTick();
    let sawMissile = false;
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      const missiles = game.units(UnitType.SAMMissile);
      if (missiles.length > 0) {
        sawMissile = true;
        const plane = attacker.units(UnitType.TransportPlane)[0];
        expect(missiles[0].targetUnit()).toBe(plane);
      }
      if (attacker.units(UnitType.TransportPlane).length === 0) break;
    }
    expect(sawMissile).toBe(true);
    expect(game.units(UnitType.SAMMissile)).toHaveLength(0);

    const lost = planeStats(game, attacker);
    expect(lost[PLANE_INDEX_SENT]).toBe(1n);
    expect(lost[PLANE_INDEX_LOST]).toBe(1n);
    expect(lost[PLANE_INDEX_LAND] ?? 0n).toBe(0n);
    expect(planeStats(game, defender)[PLANE_INDEX_DOWNED]).toBe(1n);
  });

  test("a missed SAM shot lets the plane land", async () => {
    const { game, attacker, defender } = await newGame(NoFlak);
    constructionExecution(game, defender, 80, 55, UnitType.SAMLauncher);
    const dst = game.ref(80, 50);
    game.addExecution(new ParadropExecution(attacker, dst, 10_000));
    game.executeNextTick();
    fly(game, attacker);
    game.executeNextTick();
    expect(game.units(UnitType.SAMMissile)).toHaveLength(0);
    expect(paradropAttack(attacker)).toBeDefined();
    expect(game.owner(dst)).toBe(attacker);

    const stats = planeStats(game, attacker);
    expect(stats[PLANE_INDEX_SENT]).toBe(1n);
    expect(stats[PLANE_INDEX_LAND]).toBe(1n);
    expect(stats[PLANE_INDEX_LOST] ?? 0n).toBe(0n);
    expect(stats[PLANE_INDEX_TROOPS_LANDED]).toBeGreaterThan(0n);
    expect(planeStats(game, defender)[PLANE_INDEX_DOWNED] ?? 0n).toBe(0n);
  });

  test("airports show up in the building stats", async () => {
    const { game, attacker } = await newGame();
    expect(game.stats().getPlayerStats(attacker)?.units?.airp?.[0]).toBe(1n);
  });

  test("an airport is busy for its cooldown after a sortie", async () => {
    const { game, attacker } = await newGame();
    game.addExecution(
      new ParadropExecution(attacker, game.ref(80, 50), 10_000),
      new ParadropExecution(attacker, game.ref(80, 20), 10_000),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(attacker.units(UnitType.TransportPlane)).toHaveLength(1);
    expect(attacker.canBuild(UnitType.TransportPlane, game.ref(80, 20))).toBe(
      false,
    );
    run(game, game.config().airportCooldown());
    expect(
      attacker.canBuild(UnitType.TransportPlane, game.ref(80, 20)),
    ).not.toBe(false);
  });

  test("a plane carries at most a quarter of the troops", async () => {
    const { game, attacker } = await newGame();
    const troops = attacker.troops();
    game.addExecution(
      new ParadropExecution(attacker, game.ref(80, 50), troops),
    );
    game.executeNextTick();
    game.executeNextTick();
    const plane = attacker.units(UnitType.TransportPlane)[0];
    expect(plane.troops()).toBeLessThanOrEqual(troops * 0.25 + 1);
  });

  test("other attacks don't use a cut-off pocket as a front", async () => {
    const { game, attacker, defender } = await newGame();
    game.addExecution(
      new ParadropExecution(attacker, game.ref(80, 50), 10_000),
    );
    game.executeNextTick();
    fly(game, attacker);
    game.executeNextTick();
    expect(paradropAttack(attacker)).toBeDefined();

    // A land attack on the same defender: its front is the x = 50 border of
    // the main territory (100 tiles), not also the pocket's perimeter.
    game.addExecution(new AttackExecution(5_000, attacker, defender.id()));
    game.executeNextTick();
    const land = attacker
      .outgoingAttacks()
      .find((a) => !a.isParadrop() && a.target() === defender);
    expect(land).toBeDefined();
    expect(land!.borderSize()).toBeLessThanOrEqual(100);
  });

  test("own land, allies and water are not valid drop zones", async () => {
    const { game, attacker } = await newGame();
    expect(attacker.canBuild(UnitType.TransportPlane, game.ref(30, 50))).toBe(
      false,
    );
    expect(
      attacker.canBuild(UnitType.TransportPlane, game.ref(80, 50)),
    ).not.toBe(false);
  });
});
