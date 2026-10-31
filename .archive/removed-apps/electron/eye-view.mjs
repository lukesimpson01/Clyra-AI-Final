// Native web view for Clyra Eye. The Eye app runs as an isolated page in its
// own WebContentsView, so the upstream framing headers (X-Frame-Options and
// frame-ancestors) do not apply: they only restrict embedding in an iframe.
import { WebContentsView } from "electron";

const EYE_PARTITION = "persist:clyra-eye";

export class EyeView {
  constructor({ window, url }) {
    this.window = window;
    this.url = url;
    this.origin = new URL(url).origin;
    this.view = null;
    // The host's resolved location, handed to the Eye page before its intro starts.
    this.location = null;
  }

  /** Give the Eye page the user's location (resolved by Clyra's own location tool). */
  setLocation(location) {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return;
    this.location = { lat: Number(location.lat), lon: Number(location.lon) };
    this.injectLocation();
  }

  injectLocation() {
    if (!this.location || !this.view) return;
    const payload = JSON.stringify(this.location);
    void this.view.webContents
      .executeJavaScript(`window.__clyraEyeLocation = ${payload};`)
      .catch(() => {});
  }

  ensureView() {
    if (this.view) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        partition: EYE_PARTITION,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const { webContents } = view;
    // Eye is a single page. New windows and off-origin navigation are refused.
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const keepOnOrigin = (event, target) => {
      try {
        if (new URL(target).origin !== this.origin) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    };
    webContents.on("will-navigate", keepOnOrigin);
    webContents.on("will-redirect", keepOnOrigin);
    // Eye is granted only location, and only from its own origin, so it can
    // centre on the user at launch. Every other permission is refused.
    webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
      let fromEye = false;
      try {
        fromEye = new URL(wc.getURL()).origin === this.origin;
      } catch {
        fromEye = false;
      }
      callback(fromEye && permission === "geolocation");
    });
    this.window.contentView.addChildView(view);
    view.setVisible(false);
    // Deliver the location once the page exists, whether it arrived before or after load.
    webContents.on("did-finish-load", () => this.injectLocation());
    void webContents.loadURL(this.url).catch(() => {});
    this.view = view;
    return view;
  }

  setSurface({ bounds, visible }) {
    const view = visible ? this.ensureView() : this.view;
    if (!view) return;
    if (bounds) {
      view.setBounds({
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(2, Math.round(bounds.width)),
        height: Math.max(2, Math.round(bounds.height)),
      });
    }
    if (visible) {
      // Keep the view above Clyra's own page while it is shown.
      this.window.contentView.removeChildView(view);
      this.window.contentView.addChildView(view);
    }
    view.setVisible(Boolean(visible));
  }

  destroy() {
    if (!this.view) return;
    try {
      this.window.contentView.removeChildView(this.view);
    } catch {
      // The window may already be closing.
    }
    this.view.webContents.close();
    this.view = null;
  }
}
