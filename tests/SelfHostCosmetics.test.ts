import fs from "fs";
import { base64url } from "jose";
import path from "path";
import { describe, expect, test } from "vitest";
import { decodePatternData } from "../src/core/PatternDecoder";
import { SELFHOST_FLARES } from "../src/core/SelfHost";
import {
  loadRawSelfHostCatalog,
  resolveCatalogAssets,
  SelfHostPrivileges,
} from "../src/server/SelfHostCosmetics";

const lang = (code: string) =>
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "resources", "lang", `${code}.json`),
      "utf8",
    ),
  );

describe("self-host cosmetics catalog", () => {
  const catalog = loadRawSelfHostCatalog();

  test("every pattern decodes and fits the renderer's 1024 bytes", () => {
    expect(Object.keys(catalog.patterns).length).toBeGreaterThan(0);
    for (const [name, p] of Object.entries(catalog.patterns)) {
      const d = decodePatternData(p.pattern, base64url.decode);
      expect((d.width * d.height + 7) >> 3, name).toBeLessThanOrEqual(1024);
      for (const cp of p.colorPalettes ?? []) {
        expect(
          catalog.colorPalettes?.[cp.name],
          `${name}:${cp.name}`,
        ).toBeDefined();
      }
    }
  });

  test("flag images exist", () => {
    for (const flag of Object.values(catalog.flags)) {
      const file = path.join(__dirname, "..", "resources", flag.url);
      expect(fs.existsSync(file), flag.url).toBe(true);
    }
  });

  test("flag URLs resolve to the build's hashed asset names", () => {
    const [key, flag] = Object.entries(catalog.flags)[0];
    const hashed = `/_assets${flag.url.replace(/\.svg$/, ".0123abcd.svg")}`;
    const resolved = resolveCatalogAssets(catalog, {
      [flag.url.replace(/^\//, "")]: hashed,
    });
    expect(resolved.flags[key].url).toBe(hashed);
    // Without a build (dev server) the resource path is kept.
    expect(resolveCatalogAssets(catalog, {}).flags[key].url).toBe(flag.url);
  });

  test("everything has an English and a Russian name", () => {
    for (const code of ["en", "ru"]) {
      const t = lang(code);
      for (const name of Object.keys(catalog.patterns)) {
        expect(
          t.territory_patterns.pattern[name],
          `${code} ${name}`,
        ).toBeTruthy();
      }
      for (const name of Object.keys(catalog.colorPalettes ?? {})) {
        expect(
          t.territory_patterns.color_palette[name],
          `${code} ${name}`,
        ).toBeTruthy();
      }
      for (const name of Object.keys(catalog.flags)) {
        expect(t.flags[name], `${code} ${name}`).toBeTruthy();
      }
      for (const byType of Object.values(catalog.effects ?? {})) {
        for (const name of Object.keys(byType ?? {})) {
          expect(t.effects[name], `${code} ${name}`).toBeTruthy();
        }
      }
    }
  });

  test("the self-host flares unlock every kind of catalog item", () => {
    const checker = new SelfHostPrivileges().get();
    const pattern = Object.values(catalog.patterns)[0];
    const flag = Object.keys(catalog.flags)[0];
    const explosion = Object.values(catalog.effects?.nukeExplosion ?? {})[0];
    const result = checker.isAllowed([...SELFHOST_FLARES], {
      patternName: pattern.name,
      patternColorPaletteName: pattern.colorPalettes?.[0].name,
      flag: `flag:${flag}`,
      effects: { [explosion.attributes.nukeType]: explosion.name },
    });
    expect(result.type).toBe("allowed");
    if (result.type !== "allowed") return;
    expect(result.cosmetics.pattern?.patternData).toBe(pattern.pattern);
    expect(result.cosmetics.pattern?.colorPalette?.name).toBe(
      pattern.colorPalettes?.[0].name,
    );
    expect(result.cosmetics.flag).toBe(catalog.flags[flag].url);
    expect(
      result.cosmetics.effects?.[explosion.attributes.nukeType]?.name,
    ).toBe(explosion.name);
  });

  test("without the flares the same items are refused", () => {
    const checker = new SelfHostPrivileges().get();
    const flag = Object.keys(catalog.flags)[0];
    expect(checker.isAllowed([], { flag: `flag:${flag}` }).type).toBe(
      "forbidden",
    );
  });
});
