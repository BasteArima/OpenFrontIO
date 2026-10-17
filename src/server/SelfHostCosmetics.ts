import fs from "fs";
import { base64url } from "jose";
import path from "path";
import { fileURLToPath } from "url";
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

export function readSelfHostCatalogText(): string {
  return fs.readFileSync(CATALOG_PATH, "utf-8");
}

export function loadSelfHostCatalog(): Cosmetics {
  return CosmeticsSchema.parse(JSON.parse(readSelfHostCatalogText()));
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
