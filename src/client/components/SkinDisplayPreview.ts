import { html, LitElement, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SkinDisplay } from "../../core/CosmeticSchemas";
import { SKIN_DIM } from "../render/gl/passes/SkinAtlasArray";
import { type SkinBox, skinPlacement } from "../render/gl/utils/SkinPlacement";
import { translateText } from "../Utils";

// A sketch of the World map (2000×1000 tiles) with a growing country, to show
// how a skin will sit on it. Placement comes from the same skinPlacement()
// the game renders with, so what you see here is what you get there.
const MAP_W = 2000;
const MAP_H = 1000;
const PX_PER_TILE = 0.2;
const CANVAS_W = MAP_W * PX_PER_TILE;
const CANVAS_H = MAP_H * PX_PER_TILE;

@customElement("skin-display-preview")
export class SkinDisplayPreview extends LitElement {
  @property({ attribute: false }) image: HTMLImageElement | null = null;
  @property({ attribute: false }) display: SkinDisplay = { mode: "spawn" };

  @state() private spawn = { x: 1250, y: 380 };
  @state() private countryRadius = 160;

  createRenderRoot() {
    return this;
  }

  protected updated(_changed: PropertyValues): void {
    this.draw();
  }

  /** A blob around the spawn that drifts east as it grows. */
  private territory(): {
    points: [number, number][];
    center: { x: number; y: number };
    box: SkinBox;
  } {
    const r = this.countryRadius;
    const cx = this.spawn.x + r * 0.35;
    const cy = this.spawn.y - r * 0.12;
    const points: [number, number][] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const wobble =
        1 + 0.18 * Math.sin(a * 3 + 1.3) + 0.1 * Math.sin(a * 7 + 0.4);
      points.push([
        cx + Math.cos(a) * r * 1.25 * wobble,
        cy + Math.sin(a) * r * wobble,
      ]);
    }
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return {
      points,
      center: { x: cx, y: cy },
      box: { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 },
    };
  }

  private draw(): void {
    const canvas = this.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#3d5a46";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let x = 0; x <= CANVAS_W; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_W, y);
      ctx.stroke();
    }

    const { points, center, box } = this.territory();
    const path = new Path2D();
    points.forEach(([x, y], i) =>
      i === 0
        ? path.moveTo(x * PX_PER_TILE, y * PX_PER_TILE)
        : path.lineTo(x * PX_PER_TILE, y * PX_PER_TILE),
    );
    path.closePath();

    // The country in its own colour first: transparent parts of the picture
    // show through to it, as in the game.
    ctx.fillStyle = "#3b82f6";
    ctx.fill(path);

    const img = this.image;
    if (img !== null) {
      const place = skinPlacement({
        display: this.display,
        image: { width: img.naturalWidth, height: img.naturalHeight },
        spawn: this.spawn,
        center,
        box,
        mapW: MAP_W,
        mapH: MAP_H,
        layerSize: SKIN_DIM,
      });
      // The whole picture, faint: where it lies on the map.
      ctx.save();
      ctx.globalAlpha = 0.22;
      this.paintSkin(ctx, img, place);
      ctx.restore();
      // What actually shows: the part over your land.
      ctx.save();
      ctx.clip(path);
      this.paintSkin(ctx, img, place);
      ctx.restore();
    }

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke(path);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(
      this.spawn.x * PX_PER_TILE,
      this.spawn.y * PX_PER_TILE,
      3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  private paintSkin(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    place: Float32Array,
  ): void {
    const ax = place[0] * PX_PER_TILE;
    const ay = place[1] * PX_PER_TILE;
    if (place[2] > 0.5) {
      const tw = Math.max(1, place[4] * PX_PER_TILE);
      const th = Math.max(1, place[5] * PX_PER_TILE);
      const tile = document.createElement("canvas");
      tile.width = Math.max(1, Math.round(tw));
      tile.height = Math.max(1, Math.round(th));
      tile.getContext("2d")!.drawImage(img, 0, 0, tile.width, tile.height);
      const pattern = ctx.createPattern(tile, "repeat")!;
      pattern.setTransform(new DOMMatrix().translate(ax, ay));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      return;
    }
    const fit = Math.min(
      1,
      SKIN_DIM / img.naturalWidth,
      SKIN_DIM / img.naturalHeight,
    );
    const w = img.naturalWidth * fit * place[4] * PX_PER_TILE;
    const h = img.naturalHeight * fit * place[5] * PX_PER_TILE;
    ctx.drawImage(img, ax - w / 2, ay - h / 2, w, h);
  }

  private onClick(e: MouseEvent) {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    this.spawn = {
      x: ((e.clientX - rect.left) / rect.width) * MAP_W,
      y: ((e.clientY - rect.top) / rect.height) * MAP_H,
    };
  }

  render() {
    return html`<div class="flex flex-col gap-2">
      <div class="text-xs text-white/60">
        ${translateText("skin_upload.preview.title")}
      </div>
      <canvas
        width=${CANVAS_W}
        height=${CANVAS_H}
        class="w-full cursor-crosshair rounded-lg border border-white/10"
        style="image-rendering: auto"
        @click=${(e: MouseEvent) => this.onClick(e)}
      ></canvas>
      <label class="flex flex-col gap-1 text-xs text-white/70">
        <span>${translateText("skin_upload.preview.country")}</span>
        <input
          type="range"
          min="20"
          max="700"
          step="10"
          .value=${String(this.countryRadius)}
          @input=${(e: Event) =>
            (this.countryRadius = Number((e.target as HTMLInputElement).value))}
        />
      </label>
      <div class="text-[11px] leading-snug text-white/45">
        ${translateText("skin_upload.preview.hint")}
      </div>
    </div>`;
  }
}
