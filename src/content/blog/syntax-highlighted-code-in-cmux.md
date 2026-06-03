---
title: 'Syntax-highlighted code files in cmux'
description: "cmux shows source files as plain text. cmux-code-viewer is a ~200-line tool that highlights a file with Shiki and opens it in cmux's browser via the cmux open command, with live reload on change."
pubDate: '2026-06-03'
coauthor: 'Claude (Opus 4.8, 1M context)'
---

[cmux](https://github.com/manaflow-ai/cmux) is a Ghostty-based terminal that stacks agent sessions in vertical tabs. It renders Markdown and highlights diffs, but a plain `.ts` file opens as uncolored monospace, so reading code means switching to a separate editor. cmux is open source and exposes enough of a CLI to fix this without modifying the app.

![ccode rendering a TypeScript file in cmux](/psoren-blog/ccode/screenshot-dark.png)

## What cmux exposes

cmux is GPL, native Swift/AppKit. Three things in the app bundle determine the design:

- It has two preview surfaces: a Markdown tab (an HTML webview, highlighted with highlight.js) and a generic file preview tab — a native plain-text view. Code lands in the second one.
- It already bundles Shiki. The diff viewer ships 350+ language grammars and an oniguruma wasm worker. The highlighter is already in the app, just not wired to single files.
- There is no plugin API. The README states the philosophy: cmux is "a primitive, not a solution." It exposes a CLI and a Unix socket and expects composition.

Patching the native file-preview tab to call the bundled Shiki would mean building the Swift app, and cmux auto-updates, so every release would overwrite the patch.

## The approach

`cmux open` takes a URL and renders it in cmux's in-app browser. So instead of touching the app, a local server renders the file and cmux opens the link:

```bash
ccode src/server.mjs
#  └─ ensures a tiny local server is running on 127.0.0.1:8765
#  └─ cmux open "http://127.0.0.1:8765/view?path=/abs/src/server.mjs"
```

The server reads the file, highlights it with Shiki (auto light/dark, line numbers, language detection), and serves an HTML page. cmux opens it as a normal browser tab. It's ~200 lines of Node and changes nothing in the app, so it keeps working across cmux updates. Source: [psoren/cmux-code-viewer](https://github.com/psoren/cmux-code-viewer).

```
ccode foo.ts
   └─ local server (Shiki render)
        └─ cmux open http://127.0.0.1:8765/view?path=…
             └─ cmux in-app browser tab
                  ├─ /view      → HTML shell + highlighted code
                  ├─ /fragment  → re-rendered HTML on change
                  └─ /events    → SSE: server watches the file
```

## Live reload

The file being viewed is often one an agent is rewriting, so the server watches it and pushes a Server-Sent Event on each change. The page refetches the highlighted fragment and swaps it in place, preserving scroll position.

![live reload as the file changes on disk](/psoren-blog/ccode/demo.gif)

It watches the parent directory rather than the file path. Editors and agents usually replace a file by writing a temp file and renaming it over the original, which a watch bound to the original path misses.

## cmux is adding this natively

cmux has in-progress work for the same thing: a file-browser and editor panel using Highlightr ([PR #1909](https://github.com/manaflow-ai/cmux/pull/1909)), a ["code viewer tab type" discussion](https://github.com/manaflow-ai/cmux/discussions/849), and a [file-preview render request](https://github.com/manaflow-ai/cmux/issues/1311). It isn't in the current released build yet — that binary has no Highlightr strings. When it ships, this tool stops being necessary for casual reading. Until then it covers the gap, and because it depends only on `cmux open`, it doesn't break on update.
