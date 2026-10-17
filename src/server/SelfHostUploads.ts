import crypto from "crypto";
import express, { Express, Request, Response } from "express";
import fs from "fs";
import { base64url } from "jose";
import os from "os";
import path from "path";
import { z } from "zod";
import { Cosmetics } from "../core/CosmeticSchemas";
import { decodePatternData } from "../core/PatternDecoder";
import { logger } from "./Logger";

// Player-uploaded cosmetics on a self-hosted server: territory skins, flags
// and patterns, in one gallery shared by everyone. Files and the index live
// in SELFHOST_UPLOADS_DIR (a Docker volume in production). Only the master
// writes; workers read the index to admit the uploads at join.

const log = logger.child({ comp: "uploads" });

export const UPLOAD_KINDS = ["skin", "flag", "pattern"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export interface UploadItem {
  id: string;
  kind: UploadKind;
  title: string;
  uploader: string;
  // sha256 of the uploader's persistent ID: enough to recognise their own
  // uploads without storing the ID itself.
  owner: string;
  createdAt: number;
  // skin/flag: the stored PNG; pattern: the encoded bitmap.
  file?: string;
  pattern?: string;
}

export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  perOwner: Number(process.env.SELFHOST_UPLOADS_PER_USER ?? 10),
  // Disk guard for a site anyone can reach.
  total: Number(process.env.SELFHOST_UPLOADS_TOTAL ?? 200),
  maxSide: { skin: 2048, flag: 512 },
} as const;

export function uploadsDir(): string {
  return (
    process.env.SELFHOST_UPLOADS_DIR ??
    path.join(os.tmpdir(), "bastefront-uploads")
  );
}

export function uploadPassword(): string {
  return process.env.UPLOAD_PASSWORD ?? "322";
}

function indexPath(dir = uploadsDir()): string {
  return path.join(dir, "index.json");
}

export function readUploads(dir = uploadsDir()): UploadItem[] {
  try {
    const data = JSON.parse(fs.readFileSync(indexPath(dir), "utf-8"));
    return Array.isArray(data.items) ? (data.items as UploadItem[]) : [];
  } catch {
    return [];
  }
}

/** mtime of the index, so readers can tell when to reload. */
export function uploadsVersion(dir = uploadsDir()): number {
  try {
    return fs.statSync(indexPath(dir)).mtimeMs;
  } catch {
    return 0;
  }
}

function writeUploads(items: UploadItem[], dir = uploadsDir()): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${indexPath(dir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2));
  fs.renameSync(tmp, indexPath(dir));
}

export function ownerHash(persistentId: string): string {
  return crypto.createHash("sha256").update(persistentId).digest("hex");
}

export const uploadName = (item: Pick<UploadItem, "id">) => `u_${item.id}`;

const fileUrl = (file: string) => `/_api/uploads/files/${file}`;

/** The uploads as catalog entries, merged into the served catalog. */
export function uploadedCatalog(
  items: UploadItem[],
  paletteNames: string[],
): Pick<Cosmetics, "patterns" | "flags" | "skins"> {
  const patterns: Cosmetics["patterns"] = {};
  const flags: Cosmetics["flags"] = {};
  const skins: NonNullable<Cosmetics["skins"]> = {};
  for (const item of items) {
    const base = {
      name: uploadName(item),
      product: null,
      rarity: "epic",
      artist: item.uploader,
      displayName: item.title,
    };
    if (item.kind === "pattern" && item.pattern) {
      patterns[base.name] = {
        ...base,
        pattern: item.pattern,
        colorPalettes: paletteNames.map((name) => ({
          name,
          isArchived: false,
        })),
      };
    } else if (item.kind === "flag" && item.file) {
      flags[base.name] = { ...base, url: fileUrl(item.file) };
    } else if (item.kind === "skin" && item.file) {
      skins[base.name] = { ...base, url: fileUrl(item.file) };
    }
  }
  return { patterns, flags, skins };
}

// ------------------------------------------------------------ validation

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height of a PNG, or null when the bytes are not a PNG. */
export function pngSize(
  bytes: Buffer,
): { width: number; height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    return null;
  }
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const UploadRequestSchema = z.object({
  password: z.string().max(200),
  owner: z.string().min(8).max(100),
  uploader: z.string().max(40).default(""),
  kind: z.enum(UPLOAD_KINDS),
  title: z.string().max(200),
  image: z.string().optional(),
  pattern: z.string().max(1403).optional(),
});

export type UploadRequest = z.input<typeof UploadRequestSchema>;

export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

// Control characters (C0 and DEL) never belong in a title.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function cleanText(text: string, max: number): string {
  return text.replace(CONTROL_CHARS, "").trim().slice(0, max);
}

/** Validates and stores one upload. Throws UploadError on refusal. */
export function addUpload(
  body: unknown,
  dir = uploadsDir(),
  now = Date.now(),
): UploadItem {
  const parsed = UploadRequestSchema.safeParse(body);
  if (!parsed.success) throw new UploadError(400, "bad_request");
  const req = parsed.data;
  if (req.password !== uploadPassword()) {
    throw new UploadError(403, "wrong_password");
  }
  const owner = ownerHash(req.owner);
  const items = readUploads(dir);
  if (items.filter((i) => i.owner === owner).length >= UPLOAD_LIMITS.perOwner) {
    throw new UploadError(409, "limit_reached");
  }
  if (items.length >= UPLOAD_LIMITS.total) {
    throw new UploadError(409, "gallery_full");
  }
  const title = cleanText(req.title, 40) || "Untitled";
  const uploader = cleanText(req.uploader, 40);
  const id = crypto.randomBytes(8).toString("hex").slice(0, 12);
  const item: UploadItem = {
    id,
    kind: req.kind,
    title,
    uploader,
    owner,
    createdAt: now,
  };

  if (req.kind === "pattern") {
    if (!req.pattern) throw new UploadError(400, "bad_request");
    try {
      const d = decodePatternData(req.pattern, base64url.decode);
      if ((d.width * d.height + 7) >> 3 > 1024) {
        throw new Error("too large");
      }
    } catch {
      throw new UploadError(400, "bad_pattern");
    }
    item.pattern = req.pattern;
  } else {
    if (!req.image) throw new UploadError(400, "bad_request");
    const bytes = Buffer.from(req.image, "base64");
    if (bytes.length === 0) throw new UploadError(400, "bad_image");
    if (bytes.length > UPLOAD_LIMITS.maxBytes) {
      throw new UploadError(413, "too_big");
    }
    const size = pngSize(bytes);
    const maxSide = UPLOAD_LIMITS.maxSide[req.kind];
    if (size === null) throw new UploadError(400, "bad_image");
    if (size.width > maxSide || size.height > maxSide) {
      throw new UploadError(400, "too_large_image");
    }
    item.file = `${id}.png`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, item.file), bytes);
  }

  writeUploads([...items, item], dir);
  log.info("upload added", { id, kind: item.kind, title });
  return item;
}

/** Deletes one of the owner's uploads. Throws UploadError on refusal. */
export function removeUpload(
  id: string,
  persistentId: string,
  dir = uploadsDir(),
): void {
  const items = readUploads(dir);
  const item = items.find((i) => i.id === id);
  if (!item) throw new UploadError(404, "not_found");
  if (item.owner !== ownerHash(persistentId)) {
    throw new UploadError(403, "not_yours");
  }
  writeUploads(
    items.filter((i) => i.id !== id),
    dir,
  );
  if (item.file) {
    fs.rmSync(path.join(dir, item.file), { force: true });
  }
  log.info("upload removed", { id });
}

/** The gallery as the client lists it. `mine` needs the caller's ID. */
export function listUploads(persistentId: string | undefined, dir?: string) {
  const owner = persistentId ? ownerHash(persistentId) : null;
  return {
    limits: {
      maxBytes: UPLOAD_LIMITS.maxBytes,
      perOwner: UPLOAD_LIMITS.perOwner,
    },
    items: readUploads(dir).map((i) => ({
      id: i.id,
      name: uploadName(i),
      kind: i.kind,
      title: i.title,
      uploader: i.uploader,
      createdAt: i.createdAt,
      url: i.file ? fileUrl(i.file) : undefined,
      mine: owner !== null && i.owner === owner,
    })),
  };
}

// ---------------------------------------------------------------- routes

function sendError(res: Response, error: unknown): void {
  if (error instanceof UploadError) {
    res.status(error.status).json({ error: error.code });
    return;
  }
  log.error("upload request failed", { error: String(error) });
  res.status(500).json({ error: "server_error" });
}

const ownerFrom = (req: Request) =>
  typeof req.headers["x-bf-owner"] === "string"
    ? req.headers["x-bf-owner"]
    : undefined;

// Must be registered before the app-wide express.json() (100 KB limit):
// an upload body is several megabytes of base64.
export function registerSelfHostUploads(app: Express): void {
  const json = express.json({ limit: "15mb" });

  app.get("/_api/uploads", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(listUploads(ownerFrom(req)));
  });

  app.post("/_api/uploads", json, (req, res) => {
    try {
      const item = addUpload(req.body);
      res.status(201).json({ id: item.id, name: uploadName(item) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/_api/uploads/:id", (req, res) => {
    const owner = ownerFrom(req);
    if (!owner || !/^[0-9a-f]{12}$/.test(req.params.id)) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    try {
      removeUpload(req.params.id, owner);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/_api/uploads/files/:file", (req, res) => {
    const file = req.params.file;
    if (!/^[0-9a-f]{12}\.png$/.test(file)) {
      res.status(404).end();
      return;
    }
    const full = path.join(uploadsDir(), file);
    if (!fs.existsSync(full)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(full);
  });
}
