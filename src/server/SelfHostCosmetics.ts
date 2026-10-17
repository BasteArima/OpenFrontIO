import fs from "fs";
import { base64url } from "jose";
import path from "path";
import { fileURLToPath } from "url";
import { AssetManifest, buildAssetUrl } from "../core/AssetUrls";
import { Cosmetics, CosmeticsSchema } from "../core/CosmeticSchemas";
import { PrivilegeChecker, PrivilegeCheckerImpl } from "./Privilege";

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

export function loadSelfHostCatalog(): Cosmetics {
  return resolveCatalogAssets(loadRawSelfHostCatalog(), readAssetManifest());
}

/** What /_api/cosmetics.json serves. */
export function selfHostCatalogJson(): string {
  return JSON.stringify(loadSelfHostCatalog());
}

// Same interface as PrivilegeRefresher, backed by the local catalog. No clan
// tags are reserved: there is no clan service behind a self-hosted server.
export class SelfHostPrivileges {
  private readonly checker: PrivilegeChecker;

  constructor() {
    this.checker = new PrivilegeCheckerImpl(
      loadSelfHostCatalog(),
      base64url.decode,
      new Set(),
    );
  }

  get(): PrivilegeChecker {
    return this.checker;
  }
}
