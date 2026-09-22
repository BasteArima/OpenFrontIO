import { AttackExecution } from "../src/core/execution/AttackExecution";
import { AttackFocusExecution } from "../src/core/execution/AttackFocusExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";

// plains: 100x100, all land.
async function newGame(): Promise<{
  game: Game;
  attacker: Player;
  defender: Player;
}> {
  const game = await setup("plains", { infiniteTroops: true });
  const attackerInfo = new PlayerInfo(
    "attacker",
    PlayerType.Human,
    null,
    "attacker_id",
  );
  const defenderInfo = new PlayerInfo(
    "defender",
    PlayerType.Human,
    null,
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
  return {
    game,
    attacker: game.player(attackerInfo.id),
    defender: game.player(defenderInfo.id),
  };
}

function landAttack(player: Player) {
  const attack = player.outgoingAttacks().find((a) => a.sourceTile() === null);
  if (!attack) throw new Error("no land attack");
  return attack;
}

// Ticks until `tile` belongs to `player`, or `limit` if it never does.
function ticksUntilOwned(
  game: Game,
  player: Player,
  tile: TileRef,
  limit: number,
): number {
  for (let t = 0; t < limit; t++) {
    if (game.owner(tile) === player) return t;
    game.executeNextTick();
  }
  return limit;
}

describe("Attack focus", () => {
  test("a focused attack reaches its focus point much sooner", async () => {
    // Terra nullius falls ~1 tile per tick here, so keep the goal close.
    const goal = (g: Game) => g.ref(10, 25);

    const plain = await newGame();
    plain.game.addExecution(new AttackExecution(50_000, plain.attacker, null));
    plain.game.executeNextTick();
    const unfocused = ticksUntilOwned(
      plain.game,
      plain.attacker,
      goal(plain.game),
      5000,
    );

    const focused = await newGame();
    focused.game.addExecution(
      new AttackExecution(50_000, focused.attacker, null),
    );
    focused.game.executeNextTick();
    focused.game.addExecution(
      new AttackFocusExecution(
        focused.attacker,
        landAttack(focused.attacker).id(),
        goal(focused.game),
      ),
    );
    const withFocus = ticksUntilOwned(
      focused.game,
      focused.attacker,
      goal(focused.game),
      5000,
    );

    expect(unfocused).toBeLessThan(5000);
    expect(withFocus).toBeLessThan(unfocused * 0.7);
  });

  test("the focus clears itself once the point is taken", async () => {
    const { game, attacker } = await newGame();
    game.addExecution(new AttackExecution(50_000, attacker, null));
    game.executeNextTick();
    const goal = game.ref(10, 40);
    game.addExecution(
      new AttackFocusExecution(attacker, landAttack(attacker).id(), goal),
    );
    game.executeNextTick();
    expect(landAttack(attacker).focusTile()).toBe(goal);

    ticksUntilOwned(game, attacker, goal, 5000);
    game.executeNextTick();
    expect(game.owner(goal)).toBe(attacker);
    const attack = attacker.outgoingAttacks()[0];
    if (attack !== undefined) {
      expect(attack.focusTile()).toBeNull();
    }
  });

  test("a null tile clears the focus", async () => {
    const { game, attacker } = await newGame();
    game.addExecution(new AttackExecution(50_000, attacker, null));
    game.executeNextTick();
    const id = landAttack(attacker).id();
    game.addExecution(new AttackFocusExecution(attacker, id, game.ref(10, 5)));
    game.executeNextTick();
    expect(landAttack(attacker).focusTile()).toBe(game.ref(10, 5));

    game.addExecution(new AttackFocusExecution(attacker, id, null));
    game.executeNextTick();
    expect(landAttack(attacker).focusTile()).toBeNull();
  });

  test("only tiles of the attacked side can be a focus", async () => {
    const { game, attacker } = await newGame();
    game.addExecution(new AttackExecution(50_000, attacker, null));
    game.executeNextTick();
    // The attacker's own spawn is not unowned land.
    game.addExecution(
      new AttackFocusExecution(
        attacker,
        landAttack(attacker).id(),
        game.ref(10, 50),
      ),
    );
    game.executeNextTick();
    expect(landAttack(attacker).focusTile()).toBeNull();
  });

  test("water is never a focus, even when attacking unowned land", async () => {
    const game = await setup("ocean_and_land", { infiniteTroops: true });
    const info = new PlayerInfo("a", PlayerType.Human, null, "a_id");
    game.addPlayer(info);
    game.addExecution(new SpawnExecution("game_id", info, game.ref(0, 10)));
    game.executeNextTick();
    game.executeNextTick();
    const player = game.player(info.id);
    game.addExecution(new AttackExecution(50_000, player, null));
    game.executeNextTick();

    let water: TileRef | null = null;
    game.map().forEachTile((t) => {
      if (water === null && game.map().isWater(t)) water = t;
    });
    expect(water).not.toBeNull();
    game.addExecution(
      new AttackFocusExecution(player, landAttack(player).id(), water),
    );
    game.executeNextTick();
    expect(landAttack(player).focusTile()).toBeNull();
  });

  test("a player cannot steer someone else's attack", async () => {
    const { game, attacker, defender } = await newGame();
    game.addExecution(new AttackExecution(50_000, attacker, null));
    game.executeNextTick();
    game.addExecution(
      new AttackFocusExecution(
        defender,
        landAttack(attacker).id(),
        game.ref(10, 5),
      ),
    );
    game.executeNextTick();
    expect(landAttack(attacker).focusTile()).toBeNull();
  });

  test("reinforcing an attack keeps its focus", async () => {
    const { game, attacker } = await newGame();
    game.addExecution(new AttackExecution(50_000, attacker, null));
    game.executeNextTick();
    const firstID = landAttack(attacker).id();
    const goal = game.ref(10, 5);
    game.addExecution(new AttackFocusExecution(attacker, firstID, goal));
    game.executeNextTick();

    game.addExecution(new AttackExecution(10_000, attacker, null));
    game.executeNextTick();
    const merged = landAttack(attacker);
    expect(merged.id()).not.toBe(firstID);
    expect(merged.focusTile()).toBe(goal);
  });
});
