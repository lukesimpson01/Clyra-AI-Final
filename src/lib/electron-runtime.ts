export type ElectronSurfaceBounds = { x: number; y: number; width: number; height: number };

export type CareSnapshot = {
  scannedAt: string;
  disk?: { totalBytes: number; usedBytes: number; availableBytes: number; usedPercent: number; totalLabel: string; usedLabel: string; availableLabel: string } | null;
  memory: { totalBytes: number; usedBytes: number; usedPercent: number; totalLabel: string; usedLabel: string };
  cpu: { loadPercent: number; cores: number };
  caches: { bytes: number; label: string; timedOut: boolean };
};

export type SpotifyProfile = { id: string; displayName: string; email?: string; image?: string; product?: string };
export type SpotifyPlaylist = {
  id: string;
  name: string;
  uri: string;
  images?: Array<{ url: string }>;
  tracks?: { total: number };
  owner?: { display_name?: string; id?: string };
  collaborative?: boolean;
};
export type SpotifyDevice = { id: string; name: string; type: string; is_active: boolean; is_restricted?: boolean; volume_percent?: number | null };
export type SpotifyTrack = {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: Array<{ name: string; id?: string; uri?: string }>;
  album: { name: string; id?: string; uri?: string; images?: Array<{ url: string }> };
  explicit?: boolean;
  played_at?: string;
};
export type SpotifyArtist = {
  id: string;
  name: string;
  uri: string;
  images?: Array<{ url: string }>;
  followers?: { total: number };
  genres?: string[];
  popularity?: number;
};
export type SpotifyAlbum = {
  id: string;
  name: string;
  uri: string;
  images?: Array<{ url: string }>;
  artists?: Array<{ name: string; id?: string }>;
  release_date?: string;
  total_tracks?: number;
  album_type?: string;
  label?: string;
};
export type SpotifyBrowseKind =
  | "artist" | "artist-top-tracks" | "artist-albums" | "album" | "search-all"
  | "followed-artists" | "saved-albums" | "top-artists" | "top-tracks" | "is-following"
  | "follow-artist" | "unfollow-artist" | "create-playlist" | "add-to-playlist";
export type SpotifyBrowseResult = {
  ok: boolean;
  error?: string;
  code?: string;
  artist?: SpotifyArtist;
  artists?: SpotifyArtist[];
  album?: SpotifyAlbum;
  albums?: SpotifyAlbum[];
  tracks?: SpotifyTrack[];
  playlists?: SpotifyPlaylist[];
  playlist?: SpotifyPlaylist;
  following?: boolean[];
};
export type SpotifyPlaybackState = {
  is_playing: boolean;
  progress_ms: number | null;
  item: SpotifyTrack | null;
  device: SpotifyDevice | null;
  shuffle_state?: boolean;
  repeat_state?: "off" | "track" | "context";
  context?: { uri: string; type?: string } | null;
};
/** Where a recent play came from (playlist, album, artist, Liked Songs). */
export type SpotifyPlayContext = { uri: string; type: string; playedAt: string };
export type SpotifyQueue = { currently_playing: SpotifyTrack | null; queue: SpotifyTrack[] };
export type SpotifyPlaylistItem = { addedAt: string; track: SpotifyTrack };
export type SpotifyLyrics = {
  synced: boolean;
  instrumental: boolean;
  source: "LRCLIB";
  lines: Array<{ timeMs: number | null; text: string }>;
};

export type ClyraDesktopBridge = {
  runtime: "electron";
  preview?: {
    launch: (payload: { url: string; title?: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  browser: {
    getState: () => Promise<any>;
    setSurface: (payload: { bounds?: ElectronSurfaceBounds; visible: boolean }) => Promise<any>;
    navigate: (target: string) => Promise<any>;
    action: (action: unknown) => Promise<any>;
    find: (text: string) => Promise<any>;
    zoom: (delta: number | "reset") => Promise<any>;
    updateSettings: (patch: unknown) => Promise<any>;
    addBookmark: (input?: { url?: string; title?: string; folder?: string }) => Promise<any>;
    removeBookmark: (id: string) => Promise<any>;
    clearHistory: (ids?: string[]) => Promise<any>;
    inspect: () => Promise<any>;
    setCursor: (cursor: unknown) => Promise<any>;
    openDevTools: () => Promise<any>;
    snip: (tabId?: string) => Promise<{
      ok: boolean;
      cancelled?: boolean;
      image?: string;
      text?: string;
      rect?: { x: number; y: number; width: number; height: number };
      pageUrl?: string;
      pageTitle?: string;
      error?: string;
    }>;
    cancelSnip: (tabId?: string) => Promise<{ ok: boolean }>;
    onState: (callback: (state: any) => void) => () => void;
    onFocusAddress: (callback: () => void) => () => void;
    onFocusFind: (callback: () => void) => () => void;
    onAskSelection: (
      callback: (payload: { text: string; tabId: string; pageUrl?: string; pageTitle?: string }) => void,
    ) => () => void;
    /** Clicks on the in-page agent status pill (Take control / Stop). */
    onAgentControl?: (
      callback: (payload: { command: "take_control" | "return_control" | "resume" | "stop"; tabId: string }) => void,
    ) => () => void;
  };
  surfaces: {
    update: (payload: {
      id: string;
      url: string;
      kind: "preview" | "vibe-runtime";
      bounds: ElectronSurfaceBounds;
      visible: boolean;
    }) => Promise<any>;
    hide: (id: string) => Promise<any>;
  };
  taskView: {
    capture: (payload: {
      bounds: ElectronSurfaceBounds;
      nativeBrowser?: boolean;
      /** Refresh only the native browser layer (skip UI shell capture). */
      nativeOnly?: boolean;
    }) => Promise<{
      ok: boolean;
      src: string;
      width: number;
      height: number;
      nativeLayer?: {
        src: string;
        left: number;
        top: number;
        width: number;
        height: number;
        imageWidth: number;
        imageHeight: number;
      };
    }>;
    onToggle: (callback: () => void) => () => void;
  };
  /** The global ⌘K launcher chord, forwarded from the main process so it
   *  still fires when a native browser view owns the keyboard. */
  launcher?: {
    onToggle: (callback: () => void) => () => void;
  };
  /** Clyra Anywhere: whether closing the window quits the app or leaves the
   *  system-wide background layer (dictation, selection overlay, agent
   *  overlay) running via a tray icon. */
  anywhere?: {
    getEnabled: () => Promise<{ ok: boolean; enabled: boolean }>;
    setEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>;
    onState: (callback: (state: { enabled: boolean }) => void) => () => void;
  };
  care?: {
    scan: () => Promise<{ ok: boolean; error?: string; snapshot?: CareSnapshot }>;
  };
  eye?: {
    status: () => Promise<{ ok: boolean; url: string; reachable: boolean }>;
    setSurface: (payload: { bounds?: { x: number; y: number; width: number; height: number }; visible: boolean }) => Promise<{ ok: boolean }>;
    setLocation: (location: { lat: number; lon: number }) => Promise<{ ok: boolean }>;
  };
  dictation: {
    toggle?: () => Promise<{ ok: boolean }>;
    shortcutStatus?: () => Promise<{ registered: boolean }>;
    setState: (payload: unknown) => Promise<any>;
    serviceUrl: () => Promise<string>;
    insert: (payload: { text: string; target?: unknown }) => Promise<any>;
    ensurePermissions?: () => Promise<{ ok: boolean; status?: string; error?: string; microphone?: string; camera?: string; accessibility?: boolean }>;
    ensureCamera?: () => Promise<{ ok: boolean; status?: string; error?: string; microphone?: string; camera?: string }>;
    openMicrophoneSettings?: () => Promise<{ ok: boolean }>;
    openCameraSettings?: () => Promise<{ ok: boolean }>;
    setRendererReady?: (ready: boolean) => Promise<{ ok: boolean }>;
    syncSettings?: (settings: { level?: string; dictionary?: string[] }) => Promise<{ ok: boolean }>;
    onTrigger: (callback: (payload: any) => void) => () => void;
    onAction: (callback: (payload: any) => void) => () => void;
  };
  companion?: {
    toggle?: () => Promise<{ ok: boolean; registered?: boolean }>;
    seeScreen?: (question?: string) => Promise<{
      ok: boolean;
      vision?: { summary?: string; text?: string; ocrText?: string; model?: string; source?: string };
      error?: string;
    }>;
    ask?: (text: string) => Promise<{ ok: boolean; reply?: { text?: string }; vision?: { summary?: string }; error?: string }>;
  };
  seeScreen?: (question?: string) => Promise<{
    ok: boolean;
    vision?: { summary?: string; text?: string; ocrText?: string; model?: string; source?: string };
    error?: string;
  }>;
  openCluely?: {
    ensure?: (payload?: { expand?: boolean }) => Promise<{ ok: boolean; error?: string; port?: number; action?: string }>;
    show?: (payload?: { expand?: boolean }) => Promise<{ ok: boolean; error?: string; port?: number; action?: string }>;
  };
  google: {
    status: () => Promise<{ connected: boolean; email?: string }>;
    signIn: () => Promise<{ ok: boolean; pending?: boolean; error?: string }>;
    disconnect: () => Promise<{ ok: boolean }>;
    execute: (payload: { tool?: "gmail" | "calendar" | "docs" | "sheets" | "slides" | "drive"; prompt?: string; runId?: string; service?: "docs" | "drive" | "sheets" | "gmail" | "calendar" | "contacts" | "youtube"; action?: string; args?: Record<string, unknown>; confirmed?: boolean }) => Promise<{ ok: boolean; text: string; action?: string; detail?: string; needsAuth?: boolean; needsInput?: boolean; requiresConfirmation?: boolean; confirmationKind?: string; gmailResults?: unknown; gmailThread?: unknown; gmailEmail?: unknown; gmailMutation?: unknown; gmailFollowUp?: { id?: string; dueAt?: string }; workspaceResult?: unknown }>;
    diagnostic: (payload?: { forceRefresh?: boolean }) => Promise<{ ok: boolean; stage?: string; httpStatus?: number; errorCode?: string; driveListed?: boolean; documentCreated?: boolean; documentRead?: boolean; documentDeleted?: boolean; refreshVerified?: boolean; accessibleFileCount?: number }>;
    onAuthState: (callback: (payload: { connected: boolean; email?: string; pending?: boolean; error?: string }) => void) => () => void;
    onAgentProgress: (callback: (payload: { runId: string; service: "clyra" | "research" | "gmail" | "calendar" | "docs" | "sheets" | "slides" | "drive"; state: "running" | "completed" | "failed"; label: string; detail: string }) => void) => () => void;
  };
  spotify?: {
    status: () => Promise<{ connected: boolean; profile?: SpotifyProfile | null; missingScopes?: string[] }>;
    signIn: () => Promise<{ ok: boolean; pending?: boolean; error?: string }>;
    disconnect: () => Promise<{ ok: boolean }>;
    profile: () => Promise<{ ok: boolean; profile?: SpotifyProfile; error?: string; code?: string }>;
    playlists: () => Promise<{ ok: boolean; playlists?: SpotifyPlaylist[]; error?: string; code?: string }>;
    playlistTracks: (playlistId: string) => Promise<{ ok: boolean; items?: SpotifyPlaylistItem[]; error?: string; code?: string }>;
    devices: () => Promise<{ ok: boolean; devices?: SpotifyDevice[]; error?: string; code?: string }>;
    playbackState: () => Promise<{ ok: boolean; state?: SpotifyPlaybackState | null; error?: string; code?: string }>;
    queue: () => Promise<{ ok: boolean; queue?: SpotifyQueue | null; error?: string; code?: string }>;
    recentlyPlayed: () => Promise<{ ok: boolean; tracks?: SpotifyTrack[]; contexts?: SpotifyPlayContext[]; error?: string; code?: string }>;
    prepareDevice?: (preferId?: string) => Promise<{ ok: boolean; device?: SpotifyDevice & { launched?: boolean }; error?: string; code?: string }>;
    lyrics: (track: { trackName: string; artistName: string; albumName?: string; durationMs?: number }) => Promise<{ ok: boolean; lyrics?: SpotifyLyrics; error?: string; code?: string }>;
    savedTracks: () => Promise<{ ok: boolean; tracks?: SpotifyTrack[]; error?: string; code?: string }>;
    libraryContains: (uris: string[]) => Promise<{ ok: boolean; contains?: boolean[]; error?: string; code?: string }>;
    saveLibrary: (uris: string[]) => Promise<{ ok: boolean; error?: string; code?: string }>;
    removeLibrary: (uris: string[]) => Promise<{ ok: boolean; error?: string; code?: string }>;
    search: (
      query: string,
      types?: string,
      limit?: number,
    ) => Promise<{ ok: boolean; tracks?: SpotifyTrack[]; playlists?: SpotifyPlaylist[]; error?: string; code?: string }>;
    browse?: (kind: SpotifyBrowseKind, args?: Record<string, unknown>) => Promise<SpotifyBrowseResult>;
    control: (payload: {
      action: "play" | "pause" | "next" | "previous" | "seek" | "volume" | "transfer" | "shuffle" | "repeat" | "queue";
      deviceId?: string;
      positionMs?: number;
      volumePercent?: number;
      contextUri?: string;
      uri?: string;
      uris?: string[];
      offsetUri?: string;
      offsetPosition?: number;
      play?: boolean;
      state?: boolean | "off" | "track" | "context";
    }) => Promise<{ ok: boolean; error?: string; code?: string }>;
    onAuthState: (callback: (payload: { connected: boolean; profile?: SpotifyProfile | null; pending?: boolean; error?: string }) => void) => () => void;
  };
  research: {
    execute: (payload: { prompt: string; runId?: string; checkpointId?: string; answers?: string; action?: "start" | "continue" | "cancel" }) => Promise<{ ok: boolean; text: string; needsClarification?: boolean; checkpointId?: string; questions?: string[]; analysisPrompt?: string; sources?: Array<{ url: string; publisher: string; branch: string }>; assumptions?: string[]; paused?: boolean; cancelled?: boolean }>;
    onAgentProgress: (callback: (payload: { runId: string; service: "clyra" | "research"; state: "running" | "completed" | "failed"; label: string; detail: string }) => void) => () => void;
  };
  memory?: {
    list: (projectId: string) => Promise<Array<{ id: string; text: string; createdAt: number; updatedAt: number }>>;
    search: (projectId: string, query: string, limit?: number) => Promise<Array<{ id: string; text: string; score: number }>>;
    add: (projectId: string, text: string) => Promise<{ saved: boolean; updated?: boolean; id?: string; reason?: string }>;
  };
  terminal?: {
    open: (payload: { projectId: string; tabId?: string }) => Promise<{ ok: boolean; cwd?: string }>;
    write: (payload: { data: string; tabId?: string }) => Promise<{ ok: boolean }>;
    resize: (payload: { cols: number; rows: number; tabId?: string }) => Promise<{ ok: boolean }>;
    kill: (payload?: { tabId?: string }) => Promise<{ ok: boolean }>;
    onData: (callback: (payload: { tabId?: string; data?: string } | string) => void) => () => void;
    onExit: (callback: (payload: { tabId?: string; code?: number } | number) => void) => () => void;
  };
  selectFolder?: () => Promise<{ canceled: boolean; path?: string }>;
};

declare global {
  interface Window {
    clyraDesktop?: ClyraDesktopBridge;
  }
}

export function getElectronDesktop() {
  return typeof window !== "undefined" && window.clyraDesktop?.runtime === "electron"
    ? window.clyraDesktop
    : undefined;
}

export function isElectronRuntime() {
  return Boolean(getElectronDesktop());
}

export async function requestElectronBrowser(
  path: string,
  options: { body?: any } = {},
) {
  const desktop = getElectronDesktop();
  if (!desktop) return null;
  const body = options.body || {};
  if (path === "/api/openbrowser/state") return desktop.browser.getState();
  if (path === "/api/openbrowser/navigate") return desktop.browser.navigate(String(body.target || ""));
  if (path === "/api/openbrowser/action") return desktop.browser.action(body.action);
  if (path === "/api/openbrowser/find") return desktop.browser.find(String(body.text || ""));
  if (path === "/api/openbrowser/zoom") return desktop.browser.zoom(body.delta);
  if (path === "/api/openbrowser/settings") return desktop.browser.updateSettings(body);
  if (path === "/api/openbrowser/bookmarks") return desktop.browser.addBookmark(body);
  if (path.startsWith("/api/openbrowser/bookmarks/")) {
    return desktop.browser.removeBookmark(decodeURIComponent(path.split("/").at(-1) || ""));
  }
  if (path === "/api/openbrowser/history") return desktop.browser.clearHistory(body.ids);
  if (path === "/api/openbrowser/viewport") return desktop.browser.getState();
  return null;
}
