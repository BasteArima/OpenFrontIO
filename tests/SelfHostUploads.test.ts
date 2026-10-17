import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  addUpload,
  listUploads,
  pngSize,
  readUploads,
  removeUpload,
  UPLOAD_LIMITS,
  uploadedCatalog,
  UploadError,
} from "../src/server/SelfHostUploads";

// Smallest valid-looking PNG header: signature + IHDR with the given size.
function png(width: number, height: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b.toString("base64");
}

// 2x2 pattern, scale 0: version, b1 = scale | (w-2)<<3, b2 = (h-2)<<2, bits.
const PATTERN = Buffer.from([0, 0, 0, 0b0110])
  .toString("base64url")
  .replace(/=+$/, "");

const OWNER = "persistent-id-alice";
const OTHER = "persistent-id-bob";

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof UploadError) return e.code;
    throw e;
  }
  return "ok";
}

describe("self-host uploads", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-uploads-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const upload = (over: Record<string, unknown> = {}) =>
    addUpload(
      {
        password: "322",
        owner: OWNER,
        uploader: "Alice",
        kind: "skin",
        title: "My skin",
        image: png(64, 32),
        ...over,
      },
      dir,
    );

  test("stores a skin and lists it as mine for its owner only", () => {
    const item = upload();
    expect(fs.existsSync(path.join(dir, item.file!))).toBe(true);
    expect(listUploads(OWNER, dir).items[0]).toMatchObject({
      title: "My skin",
      kind: "skin",
      mine: true,
      url: `/_api/uploads/files/${item.file}`,
    });
    expect(listUploads(OTHER, dir).items[0].mine).toBe(false);
    // The raw persistent ID is never stored.
    expect(fs.readFileSync(path.join(dir, "index.json"), "utf8")).not.toContain(
      OWNER,
    );
  });

  test("refuses a wrong password, non-PNG data and oversized images", () => {
    expect(code(() => upload({ password: "nope" }))).toBe("wrong_password");
    expect(
      code(() => upload({ image: Buffer.from("<svg/>").toString("base64") })),
    ).toBe("bad_image");
    expect(code(() => upload({ image: png(4096, 10) }))).toBe(
      "too_large_image",
    );
    expect(code(() => upload({ kind: "flag", image: png(1024, 10) }))).toBe(
      "too_large_image",
    );
    expect(readUploads(dir)).toHaveLength(0);
  });

  test("validates patterns", () => {
    expect(code(() => upload({ kind: "pattern", pattern: "AAAA" }))).toBe(
      "bad_pattern",
    );
    const item = upload({
      kind: "pattern",
      image: undefined,
      pattern: PATTERN,
    });
    expect(item.pattern).toBe(PATTERN);
    expect(item.file).toBeUndefined();
  });

  test("caps uploads per person, not for everyone", () => {
    for (let i = 0; i < UPLOAD_LIMITS.perOwner; i++) upload();
    expect(code(() => upload())).toBe("limit_reached");
    expect(code(() => upload({ owner: OTHER }))).toBe("ok");
  });

  test("only the owner can delete, and the file goes with it", () => {
    const item = upload();
    expect(code(() => removeUpload(item.id, OTHER, dir))).toBe("not_yours");
    removeUpload(item.id, OWNER, dir);
    expect(readUploads(dir)).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, item.file!))).toBe(false);
    expect(code(() => removeUpload(item.id, OWNER, dir))).toBe("not_found");
  });

  test("uploads become catalog entries with their title", () => {
    const skin = upload();
    const flag = upload({ kind: "flag", title: "Flag" });
    const pattern = upload({
      kind: "pattern",
      image: undefined,
      pattern: PATTERN,
      title: "Dots",
    });
    const cat = uploadedCatalog(readUploads(dir), ["ocean", "ember"]);
    expect(cat.skins?.[`u_${skin.id}`]).toMatchObject({
      displayName: "My skin",
      artist: "Alice",
    });
    expect(cat.flags[`u_${flag.id}`].url).toBe(
      `/_api/uploads/files/${flag.file}`,
    );
    expect(cat.patterns[`u_${pattern.id}`].colorPalettes).toHaveLength(2);
  });

  test("titles are cleaned and trimmed", () => {
    const item = upload({ title: "  a\u0000b\nc  ".padEnd(60, "x") });
    expect(item.title.startsWith("abc")).toBe(true);
    expect(item.title.length).toBeLessThanOrEqual(40);
  });

  test("pngSize reads the IHDR dimensions", () => {
    expect(pngSize(Buffer.from(png(300, 200), "base64"))).toEqual({
      width: 300,
      height: 200,
    });
    expect(pngSize(Buffer.from("GIF89a"))).toBeNull();
  });
});
