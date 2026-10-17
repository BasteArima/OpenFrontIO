// Self-hosted server (BasteFront): no accounts and no shop. Every cosmetic in
// the local catalog (resources/cosmetics/cosmetics.json) is free and owned by
// everyone.
//
// SELFHOST=1 is set for both the client build (vite inlines it) and the server
// runtime by the self-host image (Dockerfile build arg).

export function selfHostEnabled(): boolean {
  return process.env.SELFHOST === "1";
}

// Wildcard flares granting every catalog cosmetic to every player.
export const SELFHOST_FLARES: readonly string[] = [
  "pattern:*",
  "flag:*",
  "skin:*",
  "crown:*",
  "effect:*",
];
