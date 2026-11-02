/* DOM primitives shared by every surface: element building, the single menu
   and tooltip system, modals and toasts. One implementation so a menu opened
   from the sidebar and one opened from a database header behave identically. */

export const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    /* Object.assign skips CSS custom properties, so "--table-header-color"
       silently did nothing. Anything starting with "--" goes through
       setProperty; the rest keeps the cheap camelCase assignment. */
    else if (key === "style" && typeof value === "object") {
      for (const [name, rule] of Object.entries(value)) {
        if (rule === null || rule === undefined || rule === false) continue;
        if (name.startsWith("--")) node.style.setProperty(name, String(rule));
        else node.style[name] = rule;
      }
    }
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "ref") value(node);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};

export const clear = (node) => { while (node.firstChild) node.firstChild.remove(); return node; };

/* Native append() renders a null child as the text "null", which is easy to
   miss in a conditional layout. Everything goes through this instead. */
export const append = (host, ...children) => {
  host.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return host;
};
export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

/* ------------------------------------------------------------- icons */

const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35",
  sparkle: "M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5ZM18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z",
  cards: "M4 7.5A1.5 1.5 0 0 1 5.5 6h9A1.5 1.5 0 0 1 16 7.5v9A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5v-9ZM8 3.5h10A2.5 2.5 0 0 1 20.5 6v10",
  check_square: "M9 11.5 11.5 14 15.5 9.5M5 4.5h14a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5Z",
  check: "m5 12.5 4.5 4.5L19 7",
  flag: "M6 21V4.5h11l-2 4 2 4H6",
  inbox: "M3.5 13.5h4l1.5 3h6l1.5-3h4M3.5 13.5 6 5h12l2.5 8.5v5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-5Z",
  page: "M6 3.5h7l5 5v12a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5ZM13 3.5v5h5",
  plus: "M12 5v14M5 12h14",
  chevron_right: "m9 5 7 7-7 7",
  chevron_down: "m5 9 7 7 7-7",
  chevron_left: "m15 5-7 7 7 7",
  arrow_left: "M19 12H5M11 6l-6 6 6 6",
  arrow_right: "M5 12h14M13 6l6 6-6 6",
  arrow_up: "M12 19V5M6 11l6-6 6 6",
  arrow_down: "M12 5v14M6 13l6 6 6-6",
  align_left: "M4 6h16M4 10.5h10M4 15h16M4 19.5h10",
  comments: "M4.500 5.500h15a.5.5 0 0 1 .5.5v9.500a.5.5 0 0 1-.5.5H12l-4 3.500V16H4.500a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5ZM8 9.500h8M8 12.500h5",
  translate: "M4 6h9M8.5 4v2M6 6c.5 3 2.500 5 5.500 6.500M11 6c-.5 3-2.500 5-6 7M12.500 20l3.500-8 3.500 8M13.800 17h4.400",
  align_center: "M4 6h16M7 10.5h10M4 15h16M7 19.5h10",
  align_right: "M4 6h16M10 10.5h10M4 15h16M10 19.5h10",
  kind_keyword: "M6 4.5h12M6 12h12M6 19.5h7",
  kind_variable: "M8.5 5.5C6 8 6 16 8.5 18.5M15.5 5.5C18 8 18 16 15.5 18.5M9.5 12h5",
  kind_function: "M9.5 19.5c-1.5 0-2-1-2-2.5v-3c0-1.2-.6-2-1.5-2 .9 0 1.5-.8 1.5-2V7c0-1.5.5-2.5 2-2.5M14.5 4.5c1.5 0 2 1 2 2.5v3c0 1.2.6 2 1.5 2-.9 0-1.5.8-1.5 2v3c0 1.5-.5 2.5-2 2.5",
  kind_method: "M12 3.5 20 8v8l-8 4.5L4 16V8ZM12 12l8-4M12 12v8.5M12 12 4 8",
  kind_property: "M4.5 8.5h15M4.5 15.5h15M10 4.5 8 19.5M16 4.5l-2 15",
  kind_snippet: "M8 4.5H6a1.5 1.5 0 0 0-1.5 1.5v4A2 2 0 0 1 3 12a2 2 0 0 1 1.5 2v4A1.5 1.5 0 0 0 6 19.5h2M16 4.5h2A1.5 1.5 0 0 1 19.5 6v4A2 2 0 0 0 21 12a2 2 0 0 0-1.5 2v4a1.5 1.5 0 0 1-1.5 1.5h-2",
  kind_literal: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM8.5 12h7",
  kind_builtin: "M12 3.5 4.5 7.5v9L12 20.5l7.5-4V7.5ZM12 12l7.5-4.5M12 12v8.5M12 12 4.5 7.5",
  kind_text: "M6 6.5h12M6 12h12M6 17.5h8",
  pencil: "m13.5 6.5 4 4M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L17 5a2.1 2.1 0 0 0-3 0L3.5 15.5v4Z",
  keyboard: "M3.5 6.5h17a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5h-17a.5.5 0 0 1-.5-.5V7a.5.5 0 0 1 .5-.5ZM6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M6.5 13h.01M10 13h.01M13.5 13h.01M17 13h.01M8.5 16h7",
  dots: "M6 12h.01M12 12h.01M18 12h.01",
  close: "m6 6 12 12M18 6 6 18",
  star: "m12 4 2.5 5.3 5.5.8-4 4 1 5.6-5-2.8-5 2.8 1-5.6-4-4 5.5-.8L12 4Z",
  share: "M4 12v7a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-7M12 3.5v11M8 7.5l4-4 4 4",
  trash: "M4.5 6.5h15M9.5 6.5V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8v1.7M6.5 6.5l.8 12.7a.8.8 0 0 0 .8.8h7.8a.8.8 0 0 0 .8-.8l.8-12.7",
  duplicate: "M8.5 8.5V5a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5h-3.5M5 8.5h9a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V9a.5.5 0 0 1 .5-.5Z",
  link: "M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.5-1.5",
  lock: "M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5Z",
  history: "M4 12a8 8 0 1 0 2.5-5.8M4 4.5V9h4.5M12 8v4.5l3 1.8",
  export: "M12 15V4M8 8l4-4 4 4M4.5 14v5.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5V14",
  import: "M12 4v11M8 11l4 4 4-4M4.5 14v5.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5V14",
  move: "M9 6h10M9 12h10M9 18h10M5 6h.01M5 12h.01M5 18h.01",
  grip: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
  panel: "M4.5 4.5h15a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5ZM9.5 4.5v15",
  text: "M6 6.5h12M9 6.5v11M15 6.5v11M7.5 17.5h3M13.5 17.5h3",
  h1: "M4 6v12M11 6v12M4 12h7M15 18V9l-2.5 1.5",
  h2: "M4 6v12M11 6v12M4 12h7M15 10.5a2 2 0 1 1 3.5 1.3L15 18h4",
  h3: "M4 6v12M11 6v12M4 12h7M15 9.5h4l-2.5 3a2.5 2.5 0 1 1-1.7 4.3",
  bullet: "M5 7h.01M5 12h.01M5 17h.01M9.5 7H19M9.5 12H19M9.5 17H19",
  numbers: "M5.5 6.5 4 7.5M5.5 6.5v4M4 17h3l-3 2.5h3M9.5 7.5H19M9.5 12H19M9.5 16.5H19",
  toggle: "m9 7 5 5-5 5",
  quote: "M7.5 7.5h3l-2 4h2v5h-5v-5l2-4ZM16 7.5h3l-2 4h2v5h-5v-5l2-4Z",
  callout: "M12 3.5a6 6 0 0 0-3.5 10.9V17h7v-2.6A6 6 0 0 0 12 3.5ZM9.5 20h5",
  divider: "M4 12h16",
  code: "m9 8-4.5 4L9 16M15 8l4.5 4L15 16",
  equation: "M6.5 5.5h11l-6 6.5 6 6.5h-11",
  image: "M4.5 5h15a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5ZM4 16l4.5-4.5 4 4 3-2.5L20 16M9 9.5h.01",
  video: "M4.5 6h11a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5ZM16 10l4-2.5v9L16 14",
  audio: "M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm0 0V7l11-2.5v11M20 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  file: "M7 3.5h6l4.5 4.5v12a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5ZM13 3.5V8h4.5",
  bookmark: "M6.5 4h11a.5.5 0 0 1 .5.5v15.5l-6-3.5-6 3.5V4.5a.5.5 0 0 1 .5-.5Z",
  embed: "M4.5 5.5h15a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5ZM4 9.5h16",
  table: "M4.5 5h15a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5ZM4 9.5h16M9.5 9.5V19M4 14.5h16",
  board: "M4.5 5h4a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5ZM11 5h4a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5ZM17.5 5h2a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5Z",
  calendar: "M4.5 6.5h15a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5V7a.5.5 0 0 1 .5-.5ZM4 10.5h16M8 4.5v4M16 4.5v4",
  timeline: "M4 7.5h9M7 12h11M4 16.5h7M3.5 5.5v13",
  gallery: "M4.5 5h6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5ZM13.5 5h6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5ZM4.5 13h6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5ZM13.5 13h6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5Z",
  list: "M4 7h16M4 12h16M4 17h10",
  chart: "M4 19.5V4M4 19.5h16M8 16v-5M12 16V7M16 16v-7",
  feed: "M5 4.5h14a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5ZM5 13.5h14a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5Z",
  form: "M6 4.5h12a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5ZM8.5 9h7M8.5 13h7M8.5 16.5h3",
  map: "m3.5 6.5 5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2v-13ZM9 4.5v13M15 6.5v13",
  dashboard: "M4.5 4.5h6a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5ZM13.5 4.5h6a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5ZM4.5 12.5h6a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .5-.5ZM13.5 16.5h6a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 1 .5-.5Z",
  filter: "M4 6h16l-6 7v5l-4 2v-7L4 6Z",
  sort: "M7 5v14M7 19l-3-3M17 19V5M17 5l3 3",
  group: "M4.5 5.5h6v5h-6zM13.5 5.5h6v5h-6zM4.5 13.5h6v5h-6zM13.5 13.5h6v5h-6z",
  shield: "M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-2.5ZM9.2 12.2l2 2 3.8-4",
  key: "M14.5 9.5a4 4 0 1 1-1.2-2.8M13.3 8.7 20 15.4M17.5 12.6l2 2M15.2 14.9l1.8 1.8",
  alert: "M12 8v5M12 16.5v.01M10.3 4.6 2.9 17.4A1.6 1.6 0 0 0 4.3 20h15.4a1.6 1.6 0 0 0 1.4-2.6L13.7 4.6a1.9 1.9 0 0 0-3.4 0Z",
  grid: "M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z",
  eye: "M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  eye_off: "M4 4l16 16M9.9 9.9A2.5 2.5 0 0 0 12 14.5c.7 0 1.4-.3 1.8-.8M6.5 7C4 8.7 2.5 12 2.5 12S6 18 12 18c1.5 0 2.8-.4 4-1M9.5 6.3A8 8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.6 3.2",
  mic: "M12 3.5a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-5 0V6A2.5 2.5 0 0 1 12 3.5ZM6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6",
  stop: "M7.5 7.5h9v9h-9z",
  pause: "M9.5 6v12M14.5 6v12",
  play: "m8 5.5 10 6.5-10 6.5v-13Z",
  book: "M5 4.5h6.5a2 2 0 0 1 2 2V20a1.75 1.75 0 0 0-1.75-1.75H5V4.5ZM19 4.5h-3.5a2 2 0 0 0-2 2V20a1.75 1.75 0 0 1 1.75-1.75H19V4.5Z",
  template: "M4.5 4.5h15a.5.5 0 0 1 .5.5v3.5H4V5a.5.5 0 0 1 .5-.5ZM4 8.5h6v11H4.5a.5.5 0 0 1-.5-.5v-10.5ZM10 8.5h10V19a.5.5 0 0 1-.5.5H10v-11Z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5-3a7.5 7.5 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2-1.2l-.3-2.4h-4l-.3 2.4a7.5 7.5 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 2 1.2l.3 2.4h4l.3-2.4a7.5 7.5 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z",
  bold: "M7 4.5h6a3.75 3.75 0 0 1 0 7.5H7v-7.5ZM7 12h7a3.75 3.75 0 0 1 0 7.5H7V12Z",
  italic: "M10 4.5h8M6 19.5h8M14.5 4.5l-5 15",
  underline: "M6.5 4v7a5.5 5.5 0 0 0 11 0V4M5 20h14",
  strike: "M4 12h16M7.5 8.5A3.5 3.5 0 0 1 11 5h2a3.5 3.5 0 0 1 3.4 2.7M16.5 15a3.5 3.5 0 0 1-3.5 4h-2a3.5 3.5 0 0 1-3.4-2.7",
  palette: "M12 20.5a8.5 8.5 0 1 1 0-17c4.7 0 8.5 3.4 8.5 7.2 0 2-1.7 3.3-3.6 3.3h-2a2.2 2.2 0 0 0-1.6 3.7 1.7 1.7 0 0 1-1.3 2.8ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  comment: "M20 12.5c0 3.9-3.6 7-8 7a9.4 9.4 0 0 1-2.6-.4L4.5 20.5l1.2-3.6A6.7 6.7 0 0 1 4 12.5c0-3.9 3.6-7 8-7s8 3.1 8 7Z",
  refresh: "M20 11a8 8 0 1 0-.7 4.5M20 5v6h-6",
  target: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Zm0-4.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  clock: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.5V12l3 1.8",
  users: "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 5a3.5 3.5 0 0 1 0 6.9M17 14.2a6.5 6.5 0 0 1 4.5 5.8",
  at: "M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Zm0 0v1.8a2.2 2.2 0 0 0 4.4 0V12a8 8 0 1 0-3.2 6.4",
  hash: "M6 9h13M5 15h13M10.5 4.5 8.5 19.5M16 4.5l-2 15",
  send: "M4 12 20 4l-4.5 16-3.5-6.5L4 12Z",
  undo: "M4 9h10a5.5 5.5 0 0 1 0 11h-4M4 9l4-4M4 9l4 4",
  align: "M4 6h16M4 10.5h10M4 15h16M4 19.5h10",
  type_size: "M3 7.5V5.5h9v2M7.5 5.5v13M5.5 18.5h4M13.5 11.5v-1.5h7v1.5M17 10v8.5M15.5 18.5h3",
  highlighter: "m8.5 15.5-3 .8.8-3 7.7-7.7a1.8 1.8 0 0 1 2.5 0l1.7 1.7a1.8 1.8 0 0 1 0 2.5ZM4 20.5h16",
  copy: "M9 9h9.5a.5.5 0 0 1 .5.5V19a.5.5 0 0 1-.5.5H9a.5.5 0 0 1-.5-.5V9.5A.5.5 0 0 1 9 9ZM15.5 9V5a.5.5 0 0 0-.5-.5H5a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h3.5",
  terminal: "m5 7.5 4 4-4 4M12.5 16h6",
  stop: "M7.5 7.5h9v9h-9z",
  expand: "M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15",
  collapse: "M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5",
};

export const icon = (name, size = 16) => {
  const path = PATHS[name];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.dataset.icon = name;
  if (path) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
    node.setAttribute("d", path);
    svg.append(node);
  }
  return svg;
};

export const hasIcon = (name) => Boolean(PATHS[name]);

/* Clyra's Bloub avatar as a static mark, baked from the animation engine
   itself (src/components/bloub/engine) so it is the same face the chat
   avatar wears rather than a redrawing of it. The eyes are holes cut through
   the ink, exactly as the engine masks them.

   The engine's idle pose has the head turned away, which puts the eyes near
   the silhouette edge — legible at 160px, invisible at 20px. This uses the
   front-facing gaze instead, so the mark still reads at avatar size. */
const BLOUB_EYE = "M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z";
const BLOUB_EYE_MATRIX = [
  "matrix(0.96,0,0,1,-26.66,0)",
  "matrix(0.96,0,0,1,26.66,0)",
];
let bloubSeed = 0;

export function bloub(size = 22) {
  const ns = "http://www.w3.org/2000/svg";
  const uid = `bloub-${++bloubSeed}`;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "-112 -112 224 224");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("bloub");

  const defs = document.createElementNS(ns, "defs");
  const mask = document.createElementNS(ns, "mask");
  mask.setAttribute("id", uid);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("x", "-112");
  mask.setAttribute("y", "-112");
  mask.setAttribute("width", "224");
  mask.setAttribute("height", "224");
  const solid = document.createElementNS(ns, "circle");
  solid.setAttribute("cx", "0.19");
  solid.setAttribute("cy", "0.33");
  solid.setAttribute("r", "100");
  solid.setAttribute("fill", "#fff");
  mask.append(solid);
  for (const matrix of BLOUB_EYE_MATRIX) {
    const eye = document.createElementNS(ns, "path");
    eye.setAttribute("d", BLOUB_EYE);
    eye.setAttribute("transform", matrix);
    eye.setAttribute("fill", "#000");
    mask.append(eye);
  }
  defs.append(mask);

  const body = document.createElementNS(ns, "circle");
  body.setAttribute("cx", "0.19");
  body.setAttribute("cy", "0.33");
  body.setAttribute("r", "100");
  body.setAttribute("fill", "currentColor");
  body.setAttribute("mask", `url(#${uid})`);

  svg.append(defs, body);
  return svg;
}


/* ------------------------------------------------------------ toasts */

let toastTimer;
export function toast(message, kind = "info") {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.className = `toast visible${kind === "error" ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), kind === "error" ? 5200 : 2600);
}

/* ------------------------------------------------------------- layers */

const layers = () => document.getElementById("layers");
const openLayers = [];

/* Every popover, modal and peek registers here so Escape and outside-click
   always close the topmost surface and nothing can be orphaned on screen. */
function pushLayer(node, { onClose, scrim = false, closeOnOutside = true } = {}) {
  const backdrop = el("div", { class: `layer${scrim ? " scrim" : ""}` });
  const entry = {
    node,
    backdrop,
    close(reason) {
      const index = openLayers.indexOf(entry);
      if (index === -1) return;
      openLayers.splice(index, 1);
      /* Leave the way it arrived — a short fade and settle — rather than vanishing. The layer stops taking input
         at once; only its picture lingers for the exit. */
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        || document.documentElement.classList.contains("reduce-motion");
      if (reduced) { node.remove(); backdrop.remove(); }
      else {
        node.classList.add("is-leaving");
        backdrop.classList.add("is-leaving");
        setTimeout(() => { node.remove(); backdrop.remove(); }, 170);
      }
      onClose?.(reason);
    },
  };
  if (closeOnOutside) backdrop.addEventListener("mousedown", () => entry.close("outside"));
  layers().append(backdrop, node);
  openLayers.push(entry);
  return entry;
}

export const closeTopLayer = (reason = "escape") => openLayers[openLayers.length - 1]?.close(reason);
export const closeAllLayers = () => { while (openLayers.length) openLayers[openLayers.length - 1].close("all"); };
export const layerCount = () => openLayers.length;

/* Keeps a floating surface inside the viewport, preferring below-and-right
   of the anchor and flipping only when there is not enough room. */
export function position(node, anchor, { align = "start", side = "bottom", gap = 4 } = {}) {
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  node.style.visibility = "hidden";
  node.style.left = "0px";
  node.style.top = "0px";
  const box = node.getBoundingClientRect();
  const margin = 8;
  let top = side === "top" ? rect.top - box.height - gap : rect.bottom + gap;
  if (top + box.height > window.innerHeight - margin) {
    const above = rect.top - box.height - gap;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - box.height - margin);
  }
  let left = align === "end" ? rect.right - box.width : align === "center" ? rect.left + rect.width / 2 - box.width / 2 : rect.left;
  left = Math.min(Math.max(margin, left), window.innerWidth - box.width - margin);
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(Math.max(margin, top))}px`;
  node.style.visibility = "";
}

/* ------------------------------------------------------------- search */

/* One relevance rule for every searchable menu. An exact label beats a label
   that starts with the term, which beats a word inside the label, which beats
   the keyword aliases — so "table" can never rank below "table of contents"
   just because the catalogue declares it later. Returns -1 for no match. */
export function matchScore(label, keywords, term) {
  if (!term) return 0;
  const name = String(label || "").toLowerCase();
  const aliases = String(keywords || "").toLowerCase();
  if (name === term) return 100;
  if (name.startsWith(term)) return 90 - Math.min(20, name.length - term.length);
  if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)) return 60;
  if (name.includes(term)) return 45;
  for (const word of aliases.split(/\s+/)) {
    if (!word) continue;
    if (word === term) return 40;
    if (word.startsWith(term)) return 30;
  }
  if (aliases.includes(term)) return 15;
  return -1;
}

/* --------------------------------------------------------------- menu */

export function menu(anchor, items, options = {}) {
  const node = el("div", { class: `menu ${options.class || ""}`, role: "menu" });
  let entry;
  const rows = [];

  const build = (query = "") => {
    clear(node);
    rows.length = 0;
    if (options.search) {
      const input = el("input", {
        class: "menu-search", placeholder: options.searchPlaceholder || "Search…", value: query,
        oninput: (event) => { build(event.target.value); node.querySelector(".menu-search")?.focus(); },
        onkeydown: (event) => handleKey(event),
      });
      node.append(input);
      queueMicrotask(() => input.focus());
    }
    const term = query.trim().toLowerCase();
    /* Idle, the menu keeps its authored order and its section labels. With a
       term typed, the labels and separators drop out and what is left is
       ranked, so the first row is always the closest match. */
    const visible = !term ? items : items
      .map((item, index) => ({ item, index, rank: item.type ? -1 : matchScore(item.label, item.keywords, term) }))
      .filter((scored) => scored.rank >= 0)
      .sort((a, b) => b.rank - a.rank || a.index - b.index)
      .map((scored) => scored.item);
    let lastWasSeparator = true;
    let rendered = 0;
    for (const item of visible) {
      if (item.type === "separator") {
        if (lastWasSeparator) continue;
        node.append(el("div", { class: "menu-separator" }));
        lastWasSeparator = true;
        continue;
      }
      if (item.type === "label") { node.append(el("div", { class: "menu-label", text: item.label })); lastWasSeparator = true; continue; }
      if (item.type === "custom") { node.append(item.render()); lastWasSeparator = false; rendered += 1; continue; }
      const row = el("button", {
        class: `menu-item${item.class ? ` ${item.class}` : ""}${item.danger ? " danger" : ""}${item.checked ? " checked" : ""}`,
        role: "menuitem", type: "button", disabled: item.disabled || false,
        onclick: (event) => {
          if (item.disabled) return;
          event.stopPropagation();
          if (item.switch) row.querySelector(".m-switch")?.classList.toggle("on");
          if (!item.keepOpen) entry.close("select");
          item.onSelect?.(event);
        },
        onmouseenter: () => setActive(rows.indexOf(row)),
      },
        item.icon !== undefined ? el("span", { class: "m-icon" }, typeof item.icon === "string" ? (hasIcon(item.icon) ? icon(item.icon) : item.icon) : item.icon) : null,
        el("span", { class: "m-label", text: item.label }),
        item.switch ? el("span", { class: `m-switch${item.checked ? " on" : ""}`, "aria-hidden": "true" }, el("i")) : item.checked ? el("span", { class: "m-check" }, icon("check_square", 14)) : null,
        item.hint ? el("span", { class: "m-sub", text: item.hint }) : null,
        item.shortcut ? el("span", { class: "shortcut", text: item.shortcut }) : null,
      );
      rows.push(row);
      node.append(row);
      lastWasSeparator = false;
      rendered += 1;
    }
    /* Only a menu that genuinely produced nothing is empty — a menu built
       entirely from custom sections has content even with no rows. */
    if (!rendered) node.append(el("div", { class: "menu-empty", text: options.emptyLabel || "No results" }));
    position(node, anchor, options);
    setActive(0);
  };

  let activeIndex = -1;
  const setActive = (index) => {
    rows.forEach((row) => row.classList.remove("active"));
    activeIndex = Math.max(-1, Math.min(index, rows.length - 1));
    const row = rows[activeIndex];
    if (row) { row.classList.add("active"); row.scrollIntoView({ block: "nearest" }); }
  };
  const handleKey = (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(activeIndex + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(activeIndex - 1); }
    else if (event.key === "Enter") { event.preventDefault(); rows[activeIndex]?.click(); }
    else if (event.key === "Escape") { event.preventDefault(); entry.close("escape"); }
  };
  node.addEventListener("keydown", handleKey);

  entry = pushLayer(node, options);
  build("");
  if (!options.search) queueMicrotask(() => (rows[0] || node).focus?.());
  const reposition = () => position(node, anchor, options);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  const close = entry.close;
  entry.close = (reason) => {
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
    close(reason);
  };
  return entry;
}

/* ------------------------------------------------------------- modal */

export function modal({ title, body, footer, width, onClose, className = "" }) {
  const node = el("div", { class: `modal ${className}`, role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog" });
  if (width) node.style.width = `min(${width}px, calc(100vw - 48px))`;
  let entry;
  append(node,
    title === null ? null : el("div", { class: "modal-header" },
      el("div", { class: "modal-title", text: title || "" }),
      el("button", { class: "icon-button", type: "button", "aria-label": "Close", onclick: () => entry.close("close") }, icon("close", 14)),
    ),
    el("div", { class: "modal-body scroll" }, body),
    footer ? el("div", { class: "modal-footer" }, footer) : null,
  );
  entry = pushLayer(node, { scrim: true, onClose });
  queueMicrotask(() => node.querySelector("input, textarea, button.primary, button")?.focus());
  return entry;
}

export function confirmDialog({ title, message, confirmLabel = "Delete", danger = true }) {
  return new Promise((resolve) => {
    let entry;
    const cancel = el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel");
    const confirm = el("button", {
      class: `button ${danger ? "danger" : "primary"}`, type: "button",
      onclick: () => { resolved = true; entry.close("confirm"); resolve(true); },
    }, confirmLabel);
    let resolved = false;
    entry = modal({
      title, width: 420,
      body: el("div", { style: { fontSize: "14px", color: "var(--text-secondary)" }, text: message }),
      footer: [cancel, confirm],
      onClose: () => { if (!resolved) resolve(false); },
    });
  });
}

/* ------------------------------------------------------------ tooltip */

let tooltipNode = null;
let tooltipTimer = null;

/* 500ms matches the delay a desktop app uses: long enough that moving across
   a toolbar does not flash a trail of labels. */
export function tooltip(target, label, shortcut) {
  target.setAttribute("aria-label", label);
  const show = () => {
    tooltipTimer = setTimeout(() => {
      tooltipNode?.remove();
      tooltipNode = el("div", { class: "tooltip" }, label, shortcut ? el("span", { class: "shortcut", text: shortcut }) : null);
      layers().append(tooltipNode);
      position(tooltipNode, target, { align: "center", gap: 6 });
    }, 500);
  };
  const hide = () => { clearTimeout(tooltipTimer); tooltipNode?.remove(); tooltipNode = null; };
  target.addEventListener("mouseenter", show);
  target.addEventListener("mouseleave", hide);
  target.addEventListener("mousedown", hide);
  target.addEventListener("blur", hide);
  return target;
}

export const iconButton = (name, label, onClick, { shortcut, size = 16, className = "" } = {}) =>
  tooltip(
    el("button", { class: `icon-button ${className}`, type: "button", onclick: onClick }, icon(name, size)),
    label, shortcut,
  );

export const isMac = navigator.platform.toLowerCase().includes("mac");
export const mod = isMac ? "⌘" : "Ctrl";
export const modKey = (event) => (isMac ? event.metaKey : event.ctrlKey);

export { pushLayer };
