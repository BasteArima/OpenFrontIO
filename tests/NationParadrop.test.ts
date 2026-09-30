import { vi } from "vitest";
import { NukeMagnitude } from "../src/core/configuration/Config";
import { NationParadropBehavior } from "../src/core/execution/nation/NationParadropBehavior";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
import { NationExecution } from "../src/core/execution/NationExecution";
import { ParadropExecution } from "../src/core/execution/ParadropExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Cell,
  Difficulty,
  Execution,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { constructionExecution } from "./util/utils";

// Troops don't grow on their own, so the troop ratios stay where we set them.
class NoGrowth extends TestConfig {
  troopIncreaseRate(): number {
    return 0;
  }
}

// One strong SAM covers the whole defender half (and every flight path).
class StrongFlak extends NoGrowth {
  samRange(): number {
    return 150;
  }
  samFlakChance(): number {
    return 0.9;
  }
}

// Short-range SAMs that almost always hit.
class LocalFlak extends NoGrowth {
  samFlakChance(): number {
    return 0.9;
  }
}

// Real atom bomb radius, so airport placement has a meaningful spacing.
class RealSpacing extends NoGrowth {
  nukeMagnitudes(): NukeMagnitude {
    return { inner: 12, outer: 30 };
  }
}

interface Scenario {
  game: Game;
  nation: Player;
  human: Player;
}

// plains: 100x100, all land. The nation holds x < 50, the human the rest
// and has a city at (85, 50).
async function newGame(
  difficulty: Difficulty,
  configClass: typeof TestConfig = NoGrowth,
  opts: { airport?: boolean; hostile?: boolean } = {},
): Promise<Scenario> {
  const game = await setup(
    "plains",
    { difficulty, instantBuild: true, infiniteGold: true },
    [],
    undefined,
    configClass,
  );
  const nationInfo = new PlayerInfo(
    "nation",
    PlayerType.Nation,
    null,
    "nation_id",
  );
  const humanInfo = new PlayerInfo("human", PlayerType.Human, null, "human_id");
  game.addPlayer(nationInfo);
  game.addPlayer(humanInfo);
  game.addExecution(
    new SpawnExecution("game_id", nationInfo, game.ref(10, 50)),
    new SpawnExecution("game_id", humanInfo, game.ref(90, 50)),
  );
  game.executeNextTick();
  game.executeNextTick();
  const nation = game.player(nationInfo.id);
  const human = game.player(humanInfo.id);
  game.map().forEachTile((t) => {
    (game.x(t) < 50 ? nation : human).conquer(t);
  });
  // infiniteGold only applies to humans
  nation.addGold(100_000_000n);
  human.addTroops(100_000);
  // Well above the nation's min troop ratio
  const maxTroops = game.config().maxTroops(nation);
  nation.addTroops(Math.max(0, maxTroops * 0.9 - nation.troops()));
  if (opts.hostile ?? true) {
    nation.updateRelation(human, -100);
  }
  game.executeNextTick();
  if (opts.airport ?? true) {
    constructionExecution(game, nation, 20, 50, UnitType.Airport);
  }
  // Something worth dropping on, behind the human's front
  constructionExecution(game, human, 85, 50, UnitType.City);
  return { game, nation, human };
}

function newBehavior(s: Scenario, seed = 42): NationParadropBehavior {
  const random = new PseudoRandom(seed);
  const attack = new AiAttackBehavior(random, s.game, s.nation, 0.5, 0.3, 0.1);
  return new NationParadropBehavior(random, s.game, s.nation, attack);
}

// Calls maybeSendParadrop up to `calls` times (it has a random launch gate)
// and returns the paradrops it queued.
function tryDrops(
  s: Scenario,
  behavior: NationParadropBehavior,
  calls = 30,
): ParadropExecution[] {
  const drops: ParadropExecution[] = [];
  const orig = s.game.addExecution.bind(s.game);
  const spy = vi
    .spyOn(s.game, "addExecution")
    .mockImplementation((...execs: Execution[]) => {
      for (const e of execs) {
        if (e instanceof ParadropExecution) drops.push(e);
      }
      orig(...execs);
    });
  try {
    for (let i = 0; i < calls && drops.length === 0; i++) {
      behavior.maybeSendParadrop();
    }
  } finally {
    spy.mockRestore();
  }
  return drops;
}

function dropTile(e: ParadropExecution): TileRef {
  return (e as any).dst as TileRef;
}

function dropTroops(e: ParadropExecution): number {
  return (e as any).troops as number;
}

describe("NationParadropBehavior", () => {
  test.each([Difficulty.Easy, Difficulty.Medium])(
    "%s nations never drop paratroopers",
    async (difficulty) => {
      const s = await newGame(difficulty);
      expect(s.nation.units(UnitType.Airport)).toHaveLength(1);
      expect(tryDrops(s, newBehavior(s), 60)).toHaveLength(0);
    },
  );

  test("a Hard nation drops on enemy land within range of its airport", async () => {
    const s = await newGame(Difficulty.Hard);
    const troopsBefore = s.nation.troops();
    const drops = tryDrops(s, newBehavior(s));
    expect(drops).toHaveLength(1);

    const dst = dropTile(drops[0]);
    expect(s.game.owner(dst)).toBe(s.human);
    const airport = s.nation.units(UnitType.Airport)[0];
    const range = s.game.config().paradropRange();
    expect(
      s.game.euclideanDistSquared(airport.tile(), dst),
    ).toBeLessThanOrEqual(range * range);
    const troops = dropTroops(drops[0]);
    expect(troops).toBeGreaterThanOrEqual(troopsBefore * 0.15 - 1);
    expect(troops).toBeLessThanOrEqual(
      troopsBefore * s.game.config().paradropMaxTroopShare(),
    );

    // The plane actually takes off
    s.game.executeNextTick();
    s.game.executeNextTick();
    expect(s.nation.units(UnitType.TransportPlane)).toHaveLength(1);
  });

  test("a drop starts the nation's cooldown", async () => {
    const s = await newGame(Difficulty.Impossible);
    const behavior = newBehavior(s);
    expect(tryDrops(s, behavior)).toHaveLength(1);
    // The airport is still free (no tick ran), but the nation waits
    expect(tryDrops(s, behavior, 60)).toHaveLength(0);
  });

  test("no drop without an airport", async () => {
    const s = await newGame(Difficulty.Hard, NoGrowth, { airport: false });
    expect(tryDrops(s, newBehavior(s), 60)).toHaveLength(0);
  });

  test("no drop when not at war with anyone", async () => {
    const s = await newGame(Difficulty.Hard, NoGrowth, { hostile: false });
    expect(tryDrops(s, newBehavior(s), 60)).toHaveLength(0);
  });

  test("no drop onto allies", async () => {
    const s = await newGame(Difficulty.Hard);
    vi.spyOn(s.nation, "isFriendly").mockImplementation(
      (other) => other === s.human || other === s.nation,
    );
    expect(tryDrops(s, newBehavior(s), 60)).toHaveLength(0);
  });

  test("no drop when troops are low", async () => {
    const s = await newGame(Difficulty.Hard);
    s.nation.removeTroops(s.nation.troops() * 0.7);
    expect(tryDrops(s, newBehavior(s), 60)).toHaveLength(0);
  });

  test("no drop when every flight path is covered by strong hostile SAMs", async () => {
    const s = await newGame(Difficulty.Hard, StrongFlak);
    constructionExecution(s.game, s.human, 75, 50, UnitType.SAMLauncher);
    expect(s.human.units(UnitType.SAMLauncher)).toHaveLength(1);
    expect(tryDrops(s, newBehavior(s), 60)).toHaveLength(0);
  });

  test("prefers an unprotected city over one under a hostile SAM", async () => {
    const s = await newGame(Difficulty.Hard, LocalFlak);
    constructionExecution(s.game, s.human, 80, 15, UnitType.City);
    constructionExecution(s.game, s.human, 80, 20, UnitType.SAMLauncher);
    constructionExecution(s.game, s.human, 80, 85, UnitType.City);
    const drops = tryDrops(s, newBehavior(s));
    expect(drops).toHaveLength(1);
    const dst = dropTile(drops[0]);
    expect(s.game.euclideanDistSquared(dst, s.game.ref(80, 85))).toBeLessThan(
      20 * 20,
    );
  });

  test("the same seed makes the same decision", async () => {
    const decide = async () => {
      const s = await newGame(Difficulty.Hard);
      constructionExecution(s.game, s.human, 70, 30, UnitType.City);
      constructionExecution(s.game, s.human, 85, 70, UnitType.Factory);
      const drops = tryDrops(s, newBehavior(s, 7));
      expect(drops).toHaveLength(1);
      return [dropTile(drops[0]), dropTroops(drops[0])];
    };
    expect(await decide()).toEqual(await decide());
  });

  test("NationExecution launches paratroopers on Hard", async () => {
    // Troops regrow here, as in a real game.
    const s = await newGame(Difficulty.Hard, TestConfig);
    const exec = new NationExecution(
      "game_id",
      new Nation(new Cell(10, 50), s.nation.info()),
    );
    s.game.addExecution(exec);
    let launched = false;
    for (let i = 0; i < 3000 && !launched; i++) {
      s.game.executeNextTick();
      launched = s.nation.units(UnitType.TransportPlane).length > 0;
    }
    expect(launched).toBe(true);
  });
});

describe("NationStructureBehavior airports", () => {
  function structureBehavior(s: Scenario): NationStructureBehavior {
    return new NationStructureBehavior(new PseudoRandom(1), s.game, s.nation);
  }

  test.each([
    [Difficulty.Easy, false],
    [Difficulty.Medium, false],
    [Difficulty.Hard, true],
    [Difficulty.Impossible, true],
  ])("%s: wants an airport with 10 cities: %s", async (difficulty, wanted) => {
    const s = await newGame(difficulty, NoGrowth, { airport: false });
    expect(
      (structureBehavior(s) as any).shouldBuildStructure(
        UnitType.Airport,
        10,
        false,
      ),
    ).toBe(wanted);
  });

  test("no airport before a basic economy, nor without enemies", async () => {
    const s = await newGame(Difficulty.Hard, NoGrowth, { airport: false });
    const b = structureBehavior(s) as any;
    expect(b.shouldBuildStructure(UnitType.Airport, 3, false)).toBe(false);
    vi.spyOn(s.nation, "isFriendly").mockReturnValue(true);
    expect(b.shouldBuildStructure(UnitType.Airport, 10, false)).toBe(false);
  });

  test("Hard stops at one airport, Impossible at two levels", async () => {
    const hard = await newGame(Difficulty.Hard);
    expect(
      (structureBehavior(hard) as any).shouldBuildStructure(
        UnitType.Airport,
        30,
        false,
      ),
    ).toBe(false);
    const impossible = await newGame(Difficulty.Impossible);
    const b = structureBehavior(impossible) as any;
    expect(b.shouldBuildStructure(UnitType.Airport, 30, false)).toBe(true);
    impossible.nation.units(UnitType.Airport)[0].increaseLevel();
    expect(b.shouldBuildStructure(UnitType.Airport, 30, false)).toBe(false);
  });

  test("airport placement: behind the front, not on it", async () => {
    const s = await newGame(Difficulty.Hard, RealSpacing, { airport: false });
    const value = (structureBehavior(s) as any).airportValue() as (
      t: TileRef,
    ) => number;
    const onFront = value(s.game.ref(47, 50));
    const behind = value(s.game.ref(10, 50));
    expect(behind).toBeGreaterThan(onFront);
  });

  test("a Hard nation with a few cities and an enemy builds an airport", async () => {
    const s = await newGame(Difficulty.Hard, NoGrowth, { airport: false });
    for (const [x, y] of [
      [5, 5],
      [5, 30],
      [5, 60],
      [5, 90],
      [25, 5],
      [25, 30],
      [25, 60],
      [25, 90],
    ]) {
      constructionExecution(s.game, s.nation, x, y, UnitType.City, 1);
    }
    s.game.executeNextTick();
    expect(s.nation.unitsOwned(UnitType.City)).toBe(8);
    const b = structureBehavior(s);
    for (
      let i = 0;
      i < 2000 && s.nation.units(UnitType.Airport).length === 0;
      i++
    ) {
      b.handleStructures();
      s.game.executeNextTick();
    }
    const airports = s.nation.units(UnitType.Airport);
    expect(airports).toHaveLength(1);
    expect(s.game.owner(airports[0].tile())).toBe(s.nation);
  });
});
