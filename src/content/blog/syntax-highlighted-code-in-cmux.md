---
title: "Reading code in cmux: compose the primitive, don't fork the app"
description: "cmux shows source files as plain text. Instead of patching the app, I built a 200-line tool that hands a Shiki-highlighted URL to its own `cmux open` command — with live reload."
pubDate: '2026-06-03'
coauthor: 'Claude (Opus 4.8, 1M context)'
---

I live in [cmux](https://github.com/manaflow-ai/cmux) — a Ghostty-based terminal that stacks my agent sessions in vertical tabs. It renders Markdown beautifully and diffs with full syntax highlighting. But click a plain `.ts` file and you get flat, uncolored monospace. I kept bouncing to WebStorm just to *read* a file, which is a silly reason to leave the window I'm already in.

The fix turned out not to need a fork.

![ccode rendering a TypeScript file in cmux](/psoren-blog/ccode/screenshot-dark.png)

## The recon

cmux is open source (GPL, native Swift/AppKit), so I went spelunking in the app bundle. Three facts decided the design:

- It has **two preview surfaces**: a Markdown tab (an HTML webview, highlighted with highlight.js) and a generic *file preview tab* — a native plain-text view. Code lands in the second one. That's the flat text.
- It **already bundles Shiki** — the diff viewer ships 350+ language grammars and an oniguruma wasm worker. The highlighter I wanted was *already in the app*, just not wired to single files.
- There is **no plugin API**. The README is blunt about the philosophy: cmux is "a primitive, not a solution." It exposes a CLI and a Unix socket and expects you to compose.

So the obvious move — patch the native file-preview tab to call the bundled Shiki — is a trap. It means building the Swift app, and cmux auto-updates, so every release would wipe the patch. A fork you have to re-apply forever isn't a fix.

## Compose the primitive

`cmux open` takes a URL and renders it in cmux's in-app browser. That's the whole opening. Don't touch the app — render the file *yourself* and hand cmux a link:

```bash
ccode src/server.mjs
#  └─ ensures a tiny local server is running on 127.0.0.1:8765
#  └─ cmux open "http://127.0.0.1:8765/view?path=/abs/src/server.mjs"
```

The server reads the file, highlights it with Shiki (auto light/dark, line numbers, language detection), and serves an HTML page. cmux opens it as a normal browser tab. ~200 lines of Node, zero modification to cmux, survives every update. The whole thing is [psoren/cmux-code-viewer](https://github.com/psoren/cmux-code-viewer).

```
ccode foo.ts
   └─ local server (Shiki render)
        └─ cmux open http://127.0.0.1:8765/view?path=…
             └─ cmux in-app browser tab
                  ├─ /view      → HTML shell + highlighted code
                  ├─ /fragment  → re-rendered HTML on change
                  └─ /events    → SSE: server watches the file
```

## Live reload, because an agent is editing the file

The view I'm reading is often a file an agent is *actively rewriting*. So the server watches it — watching the parent directory, not the inode, since editors and agents replace files via rename — and pushes a one-line Server-Sent Event on change. The page refetches the highlighted fragment and swaps it in place, preserving scroll. No reload, no flicker.

![live reload as the file changes on disk](/psoren-blog/ccode/demo.gif)

That directory-watch detail is the one real gotcha: a naive `fs.watch` on the file path goes deaf the moment something does a write-to-temp-then-rename, which is most tools.

## It'll probably be native someday

The honest footnote: cmux is *already building* this. There's an in-progress [file-browser + editor panel](https://github.com/manaflow-ai/cmux/pull/1909) with Highlightr, a ["code viewer tab type" discussion](https://github.com/manaflow-ai/cmux/discussions/849), and a [file-preview render request](https://github.com/manaflow-ai/cmux/issues/1311). It's just not in my installed build yet (I checked the binary — no Highlightr). When it ships, this becomes redundant for casual reading. I'm fine with that.

The takeaway isn't the tool, it's the reflex: when something exposes a primitive as small as "open this URL," you can almost always compose the feature you want from the outside instead of forking your way in. The composed version is smaller, and it doesn't fight the next update.
