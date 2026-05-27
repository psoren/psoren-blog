# psoren-blog

[Parker's blog](https://psoren.github.io/psoren-blog/) — notes from things I build with code and AI.

Astro blog template, deployed to GitHub Pages on push to `main`.

## New posts

Add a markdown file under `src/content/blog/`:

```yaml
---
title: 'Your title'
description: 'One-line description (shows in the post list and as the og:description).'
pubDate: '2026-05-27'
---

Post body here.
```

Or use the `blog-post` Claude skill (at `~/.claude/skills/blog-post/`) — it scaffolds the file, opens it for editing, builds locally, and pushes when you're ready.

## Local dev

```bash
npm install
npm run dev          # http://localhost:4321/psoren-blog/
npm run build        # outputs to ./dist
```

## Theme credit

Based on the Astro blog starter, which itself riffs on [Bear Blog](https://github.com/HermanMartinus/bearblog/).
