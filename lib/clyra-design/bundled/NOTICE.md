# Notice: bundled design systems and layouts

The files under `systems/` and `templates/` are copied from **OpenDesign**
(`nexu-io/open-design`), licensed under the **Apache License, Version 2.0**.
The upstream commit is recorded in `UPSTREAM_COMMIT`.

- `systems/<id>/DESIGN.md` and `tokens.css` are the upstream design-system
  files. Each `manifest.json` is a normalised copy of the upstream manifest;
  its description is taken from the first summary line of `DESIGN.md`.
- `templates/<id>/SKILL.md` and `example.html` are the upstream template
  files.

Only the English design files are included, and only a curated subset of the
upstream catalog. Modifications: the manifests were reduced to the fields
Clyra reads, and no upstream file was edited otherwise.

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
