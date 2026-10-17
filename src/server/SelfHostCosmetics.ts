import fs from "fs";
import { base64url } from "jose";
import path from "path";
import { fileURLToPath } from "url";
import { AssetManifest, buildAssetUrl } from "../core/AssetUrls";
import { Cosmetics, CosmeticsSchema } from "../core/CosmeticSchemas";
import { PlayerCosmeticRefs } from "../core/Schemas";
import {
  ClanTagResolution,
  PrivilegeChecker,
  PrivilegeCheckerImpl,
} from "./Privilege";
import {
  readUploads,
  uploadedCatalog,
  uploadsVersion,
} from "./SelfHostUploads";

// Local cosmetics catalog for the self-hosted server. The master serves it to
// clients as /_api/cosmetics.json; workers check joins against it directly
// (no HTTP, so there is no window after a restart where cosmetics are
// stripped).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(
  __dirname,
  "../../resources/cosmetics/cosmetics.json",
);
const ASSET_MANIFEST_PATH = path.join(
  __dirname,
  "../../static/asset-manifest.json",
);

function readAssetManifest(): AssetManifest {
  try {
    return JSON.parse(
      fs.readFileSync(ASSET_MANIFEST_PATH, "utf-8"),
    ) as AssetManifest;
  } catch {
    // Dev server: no build, resources are served as-is.
    return {};
  }
}

/** The catalog exactly as stored in resources (asset paths unresolved). */
export function loadRawSelfHostCatalog(): Cosmetics {
  return CosmeticsSchema.parse(
    JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8")),
  );
}

// Catalog image URLs are resource paths ("/cosmetics/flags/x.svg"); a build
// serves them under hashed names. Every consumer uses the URL as given (the
// inventory's <img>, the flag broadcast to other players), so resolve them
// here, once, for everyone.
export function resolveCatalogAssets(
  catalog: Cosmetics,
  manifest: AssetManifest,
): Cosmetics {
  const resolve = <T extends { url: string }>(
    items: Record<string, T> | undefined,
  ): Record<string, T> | undefined =>
    items === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(items).map(([key, item]) => [
            key,
            { ...item, url: buildAssetUrl(item.url, manifest) },
          ]),
        );
  return {
    ...catalog,
    flags: resolve(catalog.flags) ?? {},
    skins: resolve(catalog.skins),
    crowns: resolve(catalog.crowns),
  };
}

// The served catalog: the bundled items plus the players' uploads.
export function loadSelfHostCatalog(): Cosmetics {
  const catalog = resolveCatalogAssets(
    loadRawSelfHostCatalog(),
    readAssetManifest(),
  );
  const uploads = uploadedCatalog(
    readUploads(),
    Object.keys(catalog.colorPalettes ?? {}),
  );
  return {
    ...catalog,
    patterns: { ...catalog.patterns, ...uploads.patterns },
    flags: { ...catalog.flags, ...uploads.flags },
    skins: { ...(catalog.skins ?? {}), ...uploads.skins },
  };
}

/** What /_api/cosmetics.json serves. */
export function selfHostCatalogJson(): string {
  return JSON.stringify(loadSelfHostCatalog());
}

// Uploads can be deleted while a player still has them selected (a cached
// catalog, a saved loadout). Refusing the whole join over that would lock
// them out of multiplayer, so a ref that no longer checks out is dropped and
// the rest are kept.
type CosmeticResult = ReturnType<PrivilegeChecker["isAllowed"]>;

class LenientPrivilegeChecker implements PrivilegeChecker {
  constructor(private readonly inner: PrivilegeChecker) {}

  resolveClanTag(
    censoredTag: string | null,
    ownedClanTags: string[],
  ): ClanTagResolution {
    return this.inner.resolveClanTag(censoredTag, ownedClanTags);
  }

  isAllowed(flares: string[], refs: PlayerCosmeticRefs): CosmeticResult {
    const whole = this.inner.isAllowed(flares, refs);
    if (whole.type === "allowed") return whole;
    const kept: PlayerCosmeticRefs = { verified: refs.verified };
    const tryAdd = (part: PlayerCosmeticRefs) => {
      const candidate = { ...kept, ...part };
      if (this.inner.isAllowed(flares, candidate).type === "allowed") {
        Object.assign(kept, part);
      }
    };
    if (refs.patternName) {
      tryAdd({
        patternName: refs.patternName,
        patternColorPaletteName: refs.patternColorPaletteName,
      });
    }
    if (refs.flag) tryAdd({ flag: refs.flag });
    if (refs.color) tryAdd({ color: refs.color });
    if (refs.skinName) tryAdd({ skinName: refs.skinName });
    if (refs.crownName) tryAdd({ crownName: refs.crownName });
    for (const [slot, name] of Object.entries(refs.effects ?? {})) {
      tryAdd({ effects: { ...(kept.effects ?? {}), [slot]: name } });
    }
    return this.inner.isAllowed(flares, kept);
  }
}

// Same interface as PrivilegeRefresher, backed by the local catalog. No clan
// tags are reserved: there is no clan service behind a self-hosted server.
// Rebuilt whenever the uploads index changes (the master writes it).
export class SelfHostPrivileges {
  private checker: PrivilegeChecker | null = null;
  private version = -1;

  get(): PrivilegeChecker {
    const version = uploadsVersion();
    if (this.checker === null || version !== this.version) {
      this.version = version;
      this.checker = new LenientPrivilegeChecker(
        new PrivilegeCheckerImpl(
          loadSelfHostCatalog(),
          base64url.decode,
          new Set(),
        ),
      );
    }
    return this.checker;
  }
}
