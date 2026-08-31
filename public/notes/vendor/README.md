# Vendored runtime for the Notes code runner

Notes is served as plain ES modules from `public/notes/` with no bundler, so
the terminal drawer cannot `import` from `node_modules`. These three files are
copied verbatim, at install time, from the packages the rest of the app
already depends on:

| file            | source                                  |
| --------------- | --------------------------------------- |
| `xterm.js`      | `@xterm/xterm/lib/xterm.js` (UMD)       |
| `addon-fit.js`  | `@xterm/addon-fit/lib/addon-fit.js`     |
| `xterm.css`     | `@xterm/xterm/css/xterm.css`            |

They are loaded lazily — only when a code block's Run button is pressed for
the first time — so opening a note never pays for them.

Refresh them with `npm run notes:vendor` after bumping either package.
