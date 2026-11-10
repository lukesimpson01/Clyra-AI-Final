/* Files: the whole workspace as a drive, in the main space like any other
   view. The sidebar only carries the button that opens it. */
import { el } from "../dom.js";
import { subscribe } from "../state.js";
import { FileManager } from "../file-manager.js";

export function renderFiles(host, app) {
  const manager = new FileManager(app, { page: true });
  const scroll = el("div", { class: "page-scroll scroll fm-scroll" }, el("div", { class: "fm-column" }, manager.render()));
  host.append(scroll);
  /* The list follows the workspace, but a rename in progress is never interrupted. */
  const off = subscribe((reason) => {
    if ((reason === "pages" || reason === "workspace") && !manager.node.querySelector(".fm-rename")) manager.render();
  });
  return { destroy() { off(); } };
}
