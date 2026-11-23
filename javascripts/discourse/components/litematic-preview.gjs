import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { modifier } from "ember-modifier";
import loadScript from "discourse/lib/load-script";
import DButton from "discourse/ui-kit/d-button";
import DModal from "discourse/ui-kit/d-modal";
import { i18n } from "discourse-i18n";
import { attachmentURL } from "../lib/litematic-attachments.js";
import { createViewerSession } from "../lib/litematic-viewer-session.js";

export default class LitematicPreview extends Component {
  @tracked state = "loading";
  @tracked phase = "download";
  @tracked error;
  @tracked progress;
  @tracked downloadUrl;
  session;
  stage;

  mountViewer = modifier((element) => {
    this.stage = element;
    this.start();
    return () => {
      this.session?.destroy();
      this.session = null;
      this.stage = null;
    };
  });

  get loading() {
    return this.state === "loading";
  }

  get failed() {
    return this.state === "error";
  }

  get statusText() {
    const key = this.phase === "download" ? "download_status" : "viewer";
    return i18n(themePrefix(`litematic.${key}`));
  }

  get errorText() {
    return i18n(themePrefix(`litematic.errors.${this.error || "viewer"}`), {
      size: Math.round(this.args.model.maxBytes / 1024 / 1024),
    });
  }

  @action
  start() {
    this.session?.destroy();
    this.error = null;
    this.progress = null;
    this.state = "loading";
    this.phase = "download";
    this.downloadUrl = attachmentURL(this.args.model.anchor);
    if (!this.downloadUrl) {
      this.error = "unresolved";
      this.state = "error";
      return;
    }

    const { rendererUrl, workerUrl, maxBytes, timeoutMs, theme } =
      this.args.model;
    const labels = Object.fromEntries(
      [
        "canvas_label",
        "reset",
        "zoom_in",
        "zoom_out",
        "layer",
        "all_layers",
        "materials",
        "more_materials",
        "blocks",
        "dimensions",
        "basic_models",
        "fallback_models",
      ].map((key) => [key, i18n(themePrefix(`litematic.${key}`))])
    );
    this.session = createViewerSession({
      container: this.stage,
      url: this.downloadUrl,
      workerUrl,
      loadRenderer: async () => {
        await loadScript(rendererUrl);
        return window.DiscourseLitematic;
      },
      maxBytes,
      timeoutMs,
      theme,
      labels,
      onStatus: ({ state, phase, progress, error }) => {
        if (this.isDestroying) {
          return;
        }
        this.state = state;
        this.phase = phase || "viewer";
        this.progress = progress;
        this.error = error;
      },
    });
  }

  <template>
    <DModal
      class="litematic-preview-modal"
      @closeModal={{@closeModal}}
      @submitOnEnter={{false}}
      @title={{@model.name}}
    >
      <:body>
        <div aria-busy={{this.loading}} class="litematic-preview">
          <div class="litematic-preview__stage" {{this.mountViewer}}></div>
          {{#if this.loading}}
            <div
              aria-live="polite"
              class="litematic-preview__status"
              role="status"
            >
              <p>{{this.statusText}}</p>
              {{#if this.progress}}
                <progress
                  aria-label={{this.statusText}}
                  max="100"
                  value={{this.progress}}
                ></progress>
              {{else}}
                <progress aria-label={{this.statusText}}></progress>
              {{/if}}
            </div>
          {{/if}}
          {{#if this.failed}}
            <div
              class="litematic-preview__status litematic-preview__status--error"
            >
              <p role="alert">{{this.errorText}}</p>
              <DButton
                @action={{this.start}}
                @label={{themePrefix "litematic.retry"}}
              />
            </div>
          {{/if}}
        </div>
      </:body>
      <:footer>
        <span class="litematic-preview__hint">
          {{i18n (themePrefix "litematic.hint")}}
        </span>
        {{#if this.downloadUrl}}
          <a
            class="btn btn-primary litematic-preview__download"
            download={{@model.name}}
            href={{this.downloadUrl}}
            rel="noopener"
          >{{i18n (themePrefix "litematic.download")}}</a>
        {{/if}}
      </:footer>
    </DModal>
  </template>
}
