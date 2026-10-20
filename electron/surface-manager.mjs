import { session, WebContentsView } from "electron";

function isAllowedUrl(value) {
  try {
    return ["http:", "https:", "data:", "about:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export class ChromiumSurfaceManager {
  constructor({ window }) {
    this.window = window;
    this.surfaces = new Map();
  }

  create(id, url, kind, css, script) {
    const partition = kind === "vibe-runtime" ? "persist:vibe-runtime" : kind === "agents" ? "persist:clyra-agents" : "persist:preview";
    session.fromPartition(partition, { cache: true });
    const view = new WebContentsView({
      webPreferences: {
        partition,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
      },
    });
    const record = { id, kind, url, view, visible: false, bounds: null, failed: false, css: css || "", cssKey: null, script: script || "" };
    // A theme layer (e.g. Clyra Agents' Grok look) is re-applied on every navigation of the embedded app.
    view.webContents.on("dom-ready", () => {
      if (record.css) void view.webContents.insertCSS(record.css).then((key) => { record.cssKey = key; }).catch(() => {});
      // An embedded app's presentation layer (e.g. Clyra Agents' naming) runs once per document.
      if (record.script) void view.webContents.executeJavaScript(record.script, true).catch(() => {});
    });
    this.surfaces.set(id, record);
    this.window.contentView.addChildView(view);
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      void view.webContents.loadURL(popupUrl);
      return { action: "deny" };
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      record.failed = details.reason !== "clean-exit";
      if (record.failed) setTimeout(() => view.webContents.reload(), 350);
    });
    void view.webContents.loadURL(url);
    return record;
  }

  update({ id, url, kind = "preview", bounds, visible, css, script }) {
    if (!id || !isAllowedUrl(url)) throw new Error("A valid Chromium surface URL is required.");
    let record = this.surfaces.get(id);
    if (!record) record = this.create(id, url, kind, css, script);
    else if (typeof script === "string" && script !== record.script) {
      record.script = script;
      if (script) void record.view.webContents.executeJavaScript(script, true).catch(() => {});
    }
    else if (typeof css === "string" && css !== record.css) {
      const previous = record.cssKey;
      record.css = css;
      record.cssKey = null;
      if (previous) void record.view.webContents.removeInsertedCSS(previous).catch(() => {});
      if (css) void record.view.webContents.insertCSS(css).then((key) => { record.cssKey = key; }).catch(() => {});
    }
    if (record.url !== url) {
      record.url = url;
      void record.view.webContents.loadURL(url);
    }
    if (bounds) {
      const next = {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(2, Math.round(bounds.width)),
        height: Math.max(2, Math.round(bounds.height)),
      };
      if (!record.bounds || Object.keys(next).some((key) => next[key] !== record.bounds[key])) {
        record.bounds = next;
        record.view.setBounds(next);
      }
    }
    record.visible = Boolean(visible);
    record.view.setVisible(record.visible);
    return { id, visible: record.visible, url: record.url };
  }

  hide(id) {
    const record = this.surfaces.get(id);
    if (!record) return;
    record.visible = false;
    record.view.setVisible(false);
  }

  hideAll() {
    for (const record of this.surfaces.values()) {
      record.visible = false;
      record.view.setVisible(false);
    }
  }

  destroy() {
    for (const record of this.surfaces.values()) {
      this.window.contentView.removeChildView(record.view);
      if (!record.view.webContents.isDestroyed()) record.view.webContents.close({ waitForBeforeUnload: false });
    }
    this.surfaces.clear();
  }
}
