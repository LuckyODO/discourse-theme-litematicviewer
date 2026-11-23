import { apiInitializer } from "discourse/lib/api";
import { i18n } from "discourse-i18n";
import LitematicPreview from "../components/litematic-preview.gjs";
import {
  decorateAttachments,
  topicIdentity,
} from "../lib/litematic-attachments.js";

export default apiInitializer((api) => {
  if (!settings.enabled) {
    return;
  }

  const modal = api.container.lookup("service:modal");
  let openedOn;

  api.decorateCookedElement(
    (element) =>
      decorateAttachments(element, {
        labels: {
          preview: i18n(themePrefix("litematic.preview")),
          download: i18n(themePrefix("litematic.download")),
        },
        onPreview: ({ anchor, name }) => {
          openedOn = topicIdentity(window.location.href);
          modal.show(LitematicPreview, {
            model: {
              anchor,
              name,
              rendererUrl: settings.theme_uploads_local.litematic_renderer,
              workerUrl: settings.theme_uploads_local.litematic_worker,
              maxBytes: settings.max_preview_size_mb * 1024 * 1024,
              timeoutMs: settings.load_timeout_seconds * 1000,
              theme: settings.viewer_theme,
            },
          });
        },
      }),
    { onlyStream: true }
  );

  api.onPageChange((url) => {
    if (
      modal.activeModal?.component === LitematicPreview &&
      openedOn !== topicIdentity(url, window.location.origin)
    ) {
      modal.close();
    }
  });
});
