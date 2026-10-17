import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerPattern } from "../../core/Schemas";
import {
  encodePattern,
  loadImage,
  patternCells,
  thresholdBits,
  toPng,
} from "../selfhost/ImageProcessing";
import {
  deleteUpload,
  listUploads,
  uploadCosmetic,
  UploadedItem,
  UploadKind,
  UploadRequestError,
} from "../selfhost/UploadsApi";
import { translateText } from "../Utils";
import { renderPatternPreview } from "./PatternPreview";

const PASSWORD_KEY = "selfhost.uploadPassword";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// Skins draw 1 image pixel per map tile, centred on the spawn; the renderer
// keeps at most 1024×1024 of it. Flags sit next to names (128×85 cells).
const SKIN_MAX = 1024;
const FLAG_MAX = { w: 256, h: 170 };

/**
 * Self-hosted servers only: upload your own skin, flag or pattern to the
 * shared gallery, and manage the ones you uploaded. Fires "uploads-changed"
 * after any change so the inventory reloads the catalog.
 */
@customElement("skin-upload-modal")
export class SkinUploadModal extends LitElement {
  @property({ type: Boolean }) open = false;

  @state() private kind: UploadKind = "skin";
  @state() private itemTitle = "";
  @state() private password = localStorage.getItem(PASSWORD_KEY) ?? "";
  @state() private image: HTMLImageElement | null = null;
  @state() private fileName = "";
  @state() private fileError: string | null = null;
  @state() private cells = 48;
  @state() private threshold = 128;
  @state() private invert = false;
  @state() private cellScale = 1;
  @state() private busy = false;
  @state() private status: { ok: boolean; text: string } | null = null;
  @state() private mine: UploadedItem[] = [];
  @state() private perOwner = 10;

  createRenderRoot() {
    return this;
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && this.open) void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const listing = await listUploads();
      this.mine = listing.items.filter((i) => i.mine);
      this.perOwner = listing.limits.perOwner;
    } catch {
      this.mine = [];
    }
  }

  private close() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private changed() {
    this.dispatchEvent(new CustomEvent("uploads-changed"));
  }

  private async onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.status = null;
    this.fileError = null;
    this.image = null;
    this.fileName = file?.name ?? "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      this.fileError = translateText("skin_upload.error.too_big");
      return;
    }
    try {
      this.image = await loadImage(file);
      if (this.itemTitle === "") {
        this.itemTitle = file.name.replace(/\.[^.]+$/, "").slice(0, 40);
      }
    } catch {
      this.fileError = translateText("skin_upload.error.bad_image");
    }
  }

  /** The bitmap the current options make of the picture. */
  private pattern(): { data: string; width: number; height: number } | null {
    if (this.image === null) return null;
    const { width, height, luma } = patternCells(this.image, this.cells);
    const bits = thresholdBits(luma, this.threshold, this.invert);
    return {
      data: encodePattern(width, height, this.cellScale, bits),
      width,
      height,
    };
  }

  private async submit() {
    if (this.image === null || this.busy) return;
    this.busy = true;
    this.status = null;
    try {
      let image: string | undefined;
      let pattern: string | undefined;
      if (this.kind === "pattern") {
        pattern = this.pattern()?.data;
      } else {
        const max =
          this.kind === "skin"
            ? { w: SKIN_MAX, h: SKIN_MAX }
            : { w: FLAG_MAX.w, h: FLAG_MAX.h };
        image = toPng(this.image, max.w, max.h).base64;
      }
      await uploadCosmetic({
        kind: this.kind,
        title: this.itemTitle,
        password: this.password,
        image,
        pattern,
      });
      localStorage.setItem(PASSWORD_KEY, this.password);
      this.status = { ok: true, text: translateText("skin_upload.done") };
      this.image = null;
      this.fileName = "";
      this.itemTitle = "";
      const input = this.querySelector<HTMLInputElement>(
        "input[data-upload-file]",
      );
      if (input) input.value = "";
      await this.refresh();
      this.changed();
    } catch (error) {
      const code =
        error instanceof UploadRequestError ? error.code : "server_error";
      const text = translateText(`skin_upload.error.${code}`);
      this.status = {
        ok: false,
        text:
          text === `skin_upload.error.${code}`
            ? translateText("skin_upload.error.server_error")
            : text,
      };
    } finally {
      this.busy = false;
    }
  }

  private async removeItem(item: UploadedItem) {
    if (
      !confirm(
        translateText("skin_upload.delete_confirm", { title: item.title }),
      )
    )
      return;
    try {
      await deleteUpload(item.id);
      await this.refresh();
      this.changed();
    } catch {
      this.status = {
        ok: false,
        text: translateText("skin_upload.error.server_error"),
      };
    }
  }

  private renderKindButton(kind: UploadKind) {
    const active = this.kind === kind;
    return html`<button
      type="button"
      data-upload-kind=${kind}
      class="flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${active
        ? "border-malibu-blue/60 bg-malibu-blue/20 text-white"
        : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}"
      @click=${() => {
        this.kind = kind;
        this.status = null;
      }}
    >
      ${translateText(`skin_upload.kind.${kind}`)}
    </button>`;
  }

  private renderPreview(): TemplateResult | typeof nothing {
    if (this.image === null) return nothing;
    if (this.kind === "pattern") {
      const p = this.pattern();
      if (p === null) return nothing;
      const preview: PlayerPattern = { name: "preview", patternData: p.data };
      return html`<div class="flex flex-col items-center gap-2">
        <div class="h-40 w-40 overflow-hidden rounded-lg bg-black/30">
          ${renderPatternPreview(preview, 160, 160)}
        </div>
        <div class="text-xs text-white/50">
          ${translateText("skin_upload.pattern_size", {
            w: p.width,
            h: p.height,
          })}
        </div>
      </div>`;
    }
    const max =
      this.kind === "skin"
        ? { w: SKIN_MAX, h: SKIN_MAX }
        : { w: FLAG_MAX.w, h: FLAG_MAX.h };
    const png = toPng(this.image, max.w, max.h);
    return html`<div class="flex flex-col items-center gap-2">
      <img
        src=${png.dataUrl}
        alt=""
        class="max-h-40 max-w-full rounded-lg bg-black/30 object-contain ${this
          .kind === "flag"
          ? "aspect-[3/2]"
          : ""}"
      />
      <div class="text-xs text-white/50">
        ${translateText(
          this.kind === "skin"
            ? "skin_upload.skin_size"
            : "skin_upload.flag_size",
          { w: png.width, h: png.height },
        )}
      </div>
    </div>`;
  }

  private renderPatternOptions(): TemplateResult | typeof nothing {
    if (this.kind !== "pattern") return nothing;
    const slider = (
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      set: (v: number) => void,
    ) =>
      html`<label class="flex flex-col gap-1 text-xs text-white/70">
        <span>${label}: ${value}</span>
        <input
          type="range"
          min=${min}
          max=${max}
          step=${step}
          .value=${String(value)}
          @input=${(e: Event) =>
            set(Number((e.target as HTMLInputElement).value))}
        />
      </label>`;
    return html`<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      ${slider(
        translateText("skin_upload.cells"),
        this.cells,
        8,
        128,
        4,
        (v) => (this.cells = v),
      )}
      ${slider(
        translateText("skin_upload.threshold"),
        this.threshold,
        1,
        254,
        1,
        (v) => (this.threshold = v),
      )}
      <label class="flex flex-col gap-1 text-xs text-white/70">
        <span>${translateText("skin_upload.cell_scale")}</span>
        <select
          class="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-sm text-white"
          .value=${String(this.cellScale)}
          @change=${(e: Event) =>
            (this.cellScale = Number((e.target as HTMLSelectElement).value))}
        >
          ${[0, 1, 2].map(
            (scale) =>
              html`<option value=${scale} ?selected=${scale === this.cellScale}>
                ${2 ** scale}×${2 ** scale}
              </option>`,
          )}
        </select>
      </label>
      <label class="flex items-center gap-2 text-xs text-white/70">
        <input
          type="checkbox"
          .checked=${this.invert}
          @change=${(e: Event) =>
            (this.invert = (e.target as HTMLInputElement).checked)}
        />
        ${translateText("skin_upload.invert")}
      </label>
    </div>`;
  }

  private renderMine() {
    return html`<div class="flex flex-col gap-2">
      <div class="text-sm font-bold uppercase tracking-wider text-white/60">
        ${translateText("skin_upload.mine", {
          n: this.mine.length,
          max: this.perOwner,
        })}
      </div>
      ${this.mine.length === 0
        ? html`<div class="text-sm text-white/40">
            ${translateText("skin_upload.mine_empty")}
          </div>`
        : html`<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            ${this.mine.map(
              (item) =>
                html`<div
                  data-upload-item=${item.id}
                  class="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2"
                >
                  <div
                    class="h-12 w-12 shrink-0 overflow-hidden rounded bg-black/30"
                  >
                    ${item.url
                      ? html`<img
                          src=${item.url}
                          alt=""
                          class="h-full w-full object-contain"
                        />`
                      : html`<div
                          class="flex h-full items-center justify-center text-[10px] text-white/40"
                        >
                          ${translateText("skin_upload.kind.pattern")}
                        </div>`}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-bold text-white">
                      ${item.title}
                    </div>
                    <div class="text-xs text-white/50">
                      ${translateText(`skin_upload.kind.${item.kind}`)}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-upload-delete=${item.id}
                    class="rounded-md bg-red-600/80 px-2 py-1 text-xs font-bold text-white hover:bg-red-600"
                    @click=${() => void this.removeItem(item)}
                  >
                    ${translateText("skin_upload.delete")}
                  </button>
                </div>`,
            )}
          </div>`}
    </div>`;
  }

  render() {
    if (!this.open) return nothing;
    const full = this.mine.length >= this.perOwner;
    const canSubmit =
      this.image !== null && !this.busy && this.password !== "" && !full;
    return html`<div
      class="fixed inset-0 z-[10050] flex items-center justify-center bg-black/70 p-3"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}
    >
      <div
        class="flex max-h-[90dvh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl border border-white/10 bg-neutral-900 p-4 text-white shadow-2xl"
      >
        <div class="flex items-center justify-between">
          <h2 class="m-0 text-xl font-black uppercase tracking-wider">
            ${translateText("skin_upload.title")}
          </h2>
          <button
            type="button"
            class="rounded-md px-2 text-2xl text-white/60 hover:text-white"
            aria-label=${translateText("common.close")}
            @click=${() => this.close()}
          >
            ×
          </button>
        </div>

        <div class="flex gap-2">
          ${this.renderKindButton("skin")} ${this.renderKindButton("flag")}
          ${this.renderKindButton("pattern")}
        </div>
        <div class="text-xs text-white/50">
          ${translateText(`skin_upload.hint.${this.kind}`)}
        </div>

        <label
          class="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-white/20 bg-white/5 px-3 py-3 text-sm text-white/80 hover:bg-white/10"
        >
          <span class="rounded-md bg-white/10 px-3 py-1 font-bold text-white"
            >${translateText("skin_upload.choose_file")}</span
          >
          <span class="truncate text-white/50"
            >${this.fileName || translateText("skin_upload.no_file")}</span
          >
          <input
            data-upload-file
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            class="hidden"
            @change=${(e: Event) => void this.onFile(e)}
          />
        </label>
        ${this.fileError
          ? html`<div class="text-sm text-red-300">${this.fileError}</div>`
          : nothing}
        ${this.renderPatternOptions()} ${this.renderPreview()}

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-xs text-white/70">
            ${translateText("skin_upload.name")}
            <input
              type="text"
              maxlength="40"
              class="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              .value=${this.itemTitle}
              @input=${(e: Event) =>
                (this.itemTitle = (e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-white/70">
            ${translateText("skin_upload.password")}
            <input
              type="password"
              class="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              .value=${this.password}
              @input=${(e: Event) =>
                (this.password = (e.target as HTMLInputElement).value)}
            />
          </label>
        </div>

        ${full
          ? html`<div class="text-sm text-amber-300">
              ${translateText("skin_upload.error.limit_reached")}
            </div>`
          : nothing}
        <button
          type="button"
          data-upload-submit
          ?disabled=${!canSubmit}
          class="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          @click=${() => void this.submit()}
        >
          ${this.busy
            ? translateText("skin_upload.uploading")
            : translateText("skin_upload.upload")}
        </button>
        ${this.status
          ? html`<div
              class="text-sm ${this.status.ok
                ? "text-green-300"
                : "text-red-300"}"
            >
              ${this.status.text}
            </div>`
          : nothing}

        <div class="border-t border-white/10 pt-4">${this.renderMine()}</div>
      </div>
    </div>`;
  }
}
