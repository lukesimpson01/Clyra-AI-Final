const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("clyraDesktop", {
  runtime: "electron",
  // A plain string only. The renderer uses it to add macOS traffic-light spacing and
  // drag regions. Platform branches stay in this layer, not in the components.
  platform: process.platform,
  preview: {
    launch: (payload) => ipcRenderer.invoke("preview:launch-desktop", payload),
  },
  browser: {
    getState: () => ipcRenderer.invoke("browser:get-state"),
    setSurface: (payload) => ipcRenderer.invoke("browser:set-surface", payload),
    navigate: (target) => ipcRenderer.invoke("browser:navigate", { target }),
    action: (action) => ipcRenderer.invoke("browser:action", { action }),
    find: (text) => ipcRenderer.invoke("browser:find", { text }),
    zoom: (delta) => ipcRenderer.invoke("browser:zoom", { delta }),
    updateSettings: (patch) => ipcRenderer.invoke("browser:update-settings", { patch }),
    addBookmark: (input) => ipcRenderer.invoke("browser:add-bookmark", input || {}),
    removeBookmark: (id) => ipcRenderer.invoke("browser:remove-bookmark", { id }),
    clearHistory: (ids) => ipcRenderer.invoke("browser:clear-history", { ids }),
    inspect: () => ipcRenderer.invoke("browser:inspect"),
    setCursor: (cursor) => ipcRenderer.invoke("browser:set-cursor", cursor),
    openDevTools: () => ipcRenderer.invoke("browser:devtools"),
    snip: (tabId) => ipcRenderer.invoke("browser:snip", { tabId }),
    cancelSnip: (tabId) => ipcRenderer.invoke("browser:cancel-snip", { tabId }),
    onState: (callback) => subscribe("browser:state", callback),
    onFocusAddress: (callback) => subscribe("browser:focus-address", callback),
    onFocusFind: (callback) => subscribe("browser:focus-find", callback),
    onAskSelection: (callback) => subscribe("browser:ask-selection", callback),
    onAgentControl: (callback) => subscribe("browser:agent-control", callback),
  },
  surfaces: {
    update: (payload) => ipcRenderer.invoke("surface:update", payload),
    hide: (id) => ipcRenderer.invoke("surface:hide", { id }),
  },
  taskView: {
    capture: (payload) => ipcRenderer.invoke("taskview:capture", payload),
    onToggle: (callback) => subscribe("taskview:toggle", callback),
  },
  launcher: {
    onToggle: (callback) => subscribe("launcher:toggle", callback),
  },
  /** Clyra Anywhere: the system-wide background layer's on/off switch, and
   *  whether the window closing should quit the app or hide it. */
  anywhere: {
    getEnabled: () => ipcRenderer.invoke("anywhere:get-enabled"),
    setEnabled: (enabled) => ipcRenderer.invoke("anywhere:set-enabled", enabled),
    onState: (callback) => subscribe("anywhere:state", callback),
  },
  care: {
    scan: () => ipcRenderer.invoke("care:scan"),
  },
  agents: {
    status: () => ipcRenderer.invoke("agents:status"),
    start: () => ipcRenderer.invoke("agents:start"),
    onState: (callback) => subscribe("agents:state", callback),
  },
  location: {
    get: (options) => ipcRenderer.invoke("location:get", options || {}),
  },
  eye: {
    status: () => ipcRenderer.invoke("eye:status"),
    setSurface: (payload) => ipcRenderer.invoke("eye:set-surface", payload),
    setLocation: (location) => ipcRenderer.invoke("eye:set-location", location),
  },
  dictation: {
    toggle: (options) => ipcRenderer.invoke("dictation:toggle", options),
    cancel: () => ipcRenderer.invoke("dictation:cancel"),
    onState: (callback) => subscribe("dictation:state", callback),
    onInlineResult: (callback) => subscribe("dictation:inline-result", callback),
    shortcutStatus: () => ipcRenderer.invoke("dictation:shortcut-status"),
    setRendererReady: (ready) => ipcRenderer.invoke("dictation:renderer-ready", Boolean(ready)),
    syncSettings: (settings) => ipcRenderer.invoke("dictation:sync-settings", settings),
    setState: (payload) => ipcRenderer.invoke("dictation:set-state", payload),
    serviceUrl: () => ipcRenderer.invoke("dictation:service-url"),
    insert: (payload) => ipcRenderer.invoke("dictation:insert", payload),
    ensurePermissions: () => ipcRenderer.invoke("dictation:ensure-permissions"),
    ensureCamera: () => ipcRenderer.invoke("dictation:ensure-camera"),
    openMicrophoneSettings: () => ipcRenderer.invoke("dictation:open-microphone-settings"),
    openCameraSettings: () => ipcRenderer.invoke("dictation:open-camera-settings"),
    onTrigger: (callback) => subscribe("dictation:trigger", callback),
    onAction: (callback) => subscribe("dictation:action", callback),
  },
  companion: {
    toggle: () => ipcRenderer.invoke("companion:toggle"),
    seeScreen: (question) => ipcRenderer.invoke("companion:see", { question }),
    ask: (text) => ipcRenderer.invoke("companion:ask", { text }),
  },
  seeScreen: (question) => ipcRenderer.invoke("desktop:see-screen", { question }),
  google: {
    status: () => ipcRenderer.invoke("google:status"),
    signIn: () => ipcRenderer.invoke("google:sign-in"),
    disconnect: () => ipcRenderer.invoke("google:disconnect"),
    execute: (payload) => ipcRenderer.invoke("google:execute", payload),
    diagnostic: (payload) => ipcRenderer.invoke("google:diagnostic", payload),
    onAuthState: (callback) => subscribe("google:auth-state", callback),
    onAgentProgress: (callback) => subscribe("google:agent-progress", callback),
  },
  spotify: {
    status: () => ipcRenderer.invoke("spotify:status"),
    signIn: () => ipcRenderer.invoke("spotify:sign-in"),
    disconnect: () => ipcRenderer.invoke("spotify:disconnect"),
    profile: () => ipcRenderer.invoke("spotify:profile"),
    playlists: () => ipcRenderer.invoke("spotify:playlists"),
    playlistTracks: (playlistId) => ipcRenderer.invoke("spotify:playlist-tracks", { playlistId }),
    devices: () => ipcRenderer.invoke("spotify:devices"),
    playbackState: () => ipcRenderer.invoke("spotify:playback-state"),
    queue: () => ipcRenderer.invoke("spotify:queue"),
    recentlyPlayed: () => ipcRenderer.invoke("spotify:recently-played"),
    prepareDevice: (preferId) => ipcRenderer.invoke("spotify:prepare-device", { preferId }),
    lyrics: (track) => ipcRenderer.invoke("spotify:lyrics", track),
    savedTracks: () => ipcRenderer.invoke("spotify:saved-tracks"),
    libraryContains: (uris) => ipcRenderer.invoke("spotify:library-contains", { uris }),
    saveLibrary: (uris) => ipcRenderer.invoke("spotify:library-save", { uris }),
    removeLibrary: (uris) => ipcRenderer.invoke("spotify:library-remove", { uris }),
    search: (query, types, limit) => ipcRenderer.invoke("spotify:search", { query, types, limit }),
    browse: (kind, args) => ipcRenderer.invoke("spotify:browse", { kind, args }),
    control: (payload) => ipcRenderer.invoke("spotify:control", payload),
    onAuthState: (callback) => subscribe("spotify:auth-state", callback),
  },
  research: {
    execute: (payload) => ipcRenderer.invoke("research:execute", payload),
    onAgentProgress: (callback) => subscribe("research:agent-progress", callback),
  },
  // Memory remains entirely in Electron main's encrypted local store. The
  // renderer supplies a project namespace, never a filesystem location or
  // raw store handle, so project facts cannot bleed between workspaces.
  memory: {
    list: (projectId) => ipcRenderer.invoke("memory:list", { userId: `project:${String(projectId || "local").slice(0, 120)}` }),
    search: (projectId, query, limit) => ipcRenderer.invoke("memory:search", { userId: `project:${String(projectId || "local").slice(0, 120)}`, query: String(query || "").slice(0, 800), limit: Math.max(1, Math.min(10, Number(limit) || 5)) }),
    add: (projectId, text) => ipcRenderer.invoke("memory:add", { userId: `project:${String(projectId || "local").slice(0, 120)}`, text: String(text || "").slice(0, 800), force: true }),
  },
  terminal: {
    open: (payload) => ipcRenderer.invoke("terminal:open", payload),
    write: (payload) => ipcRenderer.invoke("terminal:write", payload),
    resize: (payload) => ipcRenderer.invoke("terminal:resize", payload),
    kill: (payload) => ipcRenderer.invoke("terminal:kill", payload),
    onData: (callback) => subscribe("terminal:data", callback),
    onExit: (callback) => subscribe("terminal:exit", callback),
  },
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
});
