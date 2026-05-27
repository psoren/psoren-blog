---
title: 'Cross-machine Claude IPC: a bridge between my MBP and my Mac mini'
description: 'How to get the Claude on your laptop to talk to the Claude on your always-on Mac mini, over Tailscale, without losing your mind to macOS Keychain.'
pubDate: '2026-05-27'
---

I have two Macs that matter to me. A MacBook Pro that goes everywhere, and a Mac mini that sits at home, plugged in, always on, doing low-stakes long-running stuff — financial dashboards, hue automation, scrapers. Each runs Claude Code. Until this week they were islands.

I wanted to be able to say, from a Claude session on the laptop:

> "ask the mini what's running on port 5173, and report back"

…and have that just work. No copy-pasting between terminals. No `tmux attach` over SSH. Just one Claude delegating to another over the Tailnet.

This post is the story of getting there. It turned into a tour of macOS's least-loved corners — Keychain ACLs, sandboxed `tailscaled`, LaunchAgent PATH inheritance — and the architecture I landed on is dumb enough that I want to write it down before I forget why each piece is the way it is.

## The naive thing doesn't work

The obvious first attempt:

```bash
ssh parkers-mac-mini 'claude -p "what is your hostname?"'
```

This fails with `Not logged in · Please run /login`, even when Claude is fully authenticated on the mini. The reason is that on macOS, Claude Code stores its OAuth token in the **login Keychain**, and the login Keychain is unlocked only inside the user's GUI session. A fresh SSH session is a separate session — it inherits a *locked* Keychain. When `claude` tries to read its credential, the Keychain can't unlock without a GUI prompt (which the SSH session can't show), so it gives up and says the token doesn't exist.

You can verify this — from an SSH session:

```bash
security show-keychain-info ~/Library/Keychains/login.keychain-db
# security: ... User interaction is not allowed.
```

The keychain DB exists, the item exists, the ACL might even allow your tool — but the database itself is sealed.

There are workarounds (`security unlock-keychain` with a stored password; using `ANTHROPIC_API_KEY` to bypass the OAuth flow entirely; switching from the Mac App Store Tailscale build to the open-source `tailscaled` so you can run Tailscale-SSH which has a different keychain story). None of them are good. Stashing your Mac password on disk is gross. Burning API credits when you're already paying for a Claude subscription is silly. Reinstalling Tailscale just to get past one error message is over-investing.

## The right shape

The fix once I saw it was obvious. **Don't have the SSH session invoke Claude at all.** Instead, run a tiny daemon on the mini that wraps `claude -p`, and have the SSH session just curl it over loopback.

```
[ MBP zsh ]
    │ ssh (key auth)
    ▼
[ mini sshd ]
    │ curl POST http://127.0.0.1:9100/ask
    ▼
[ bridge daemon ]   ← launched from a GUI Terminal → Keychain unlocked
    │ subprocess: claude -p "<prompt>"
    ▼
[ Claude on mini ]  ← reads OAuth from Keychain without issue
```

The daemon is born inside the GUI session, so it inherits the unlocked Keychain. SSH sessions never touch Keychain directly — they just talk to a local HTTP socket. The Keychain headache goes away.

The whole daemon is 70 lines of Python with no dependencies — `http.server` + `subprocess.run(["claude", "-p", prompt])`. Bind to `127.0.0.1` so the only way in is via SSH to the mini.

## What I had to argue with along the way

Even after picking the right architecture, getting it deployed took a march through macOS-specific weirdness. Saving these here so the next person (probably future-me) doesn't have to re-discover them.

**Mac App Store Tailscale can't run a Tailscale-SSH server.** If you try `sudo tailscale set --ssh` you get *"the tailscale ssh server does not run in sandboxed gui mode."* So Tailscale-SSH was out, and I fell back to regular `sshd` + key auth. Fine.

**Permission denied even though the key is offered and accepted.** Classic symptom: `debug1: Server accepts key: /Users/parker/.ssh/id_ed25519` followed immediately by `Permission denied`. That means the server says "yes that pubkey is authorized" but the client can't prove possession because the private key has a passphrase and there's nothing to type it. Solution: either `ssh-add --apple-use-keychain` (one-time passphrase entry, stashed in macOS Keychain), or generate a fresh passphrase-less key dedicated to the link. I went with the fresh key.

**`sshd` needs Full Disk Access to read `~/.ssh/authorized_keys`.** Not on every Mac, but on enough of them. Add `/usr/libexec/sshd-keygen-wrapper` to Privacy → Full Disk Access, then toggle Remote Login off/on so sshd restarts and picks up the new permission.

**Allow-listing the Keychain item is necessary but not sufficient.** Setting the *Claude Code-credentials* keychain item to "Allow all applications to access this item" controls *which apps can read the secret*, but doesn't unlock the *keychain database* in non-GUI sessions. That's the distinction I missed for an hour. ACL = which apps can use the credential. Unlocked DB = whether the credential can be decrypted at all.

**LaunchAgents need their PATH spelled out.** This bit me at the very end. The bridge was running cleanly under launchd, the Keychain ACL was open, the credential was readable — and yet `claude` failed with `command not found`. The default `launchd` PATH is the bare `/usr/bin:/bin:/usr/sbin:/sbin`. None of `/opt/homebrew/bin`, `/usr/local/bin`, or the `cmux.app` bundled bin dir are in it. Fix: an `EnvironmentVariables` block in the plist that lists every plausible install dir.

**`bash -lc` is *not* the same as a GUI shell.** When SSH'd in, `bash -lc 'claude --version'` *does* source `~/.zshrc` and friends — but it still doesn't have GUI Keychain access. Don't confuse "I have my full PATH" with "I have my full session." They're orthogonal.

## What the IPC actually looks like

The MBP-side CLI:

```bash
#!/usr/bin/env bash
HOST="${MINI_HOST:-parkers-mac-mini}"
PORT="${MINI_BRIDGE_PORT:-9100}"
if [ "$1" = "-" ]; then PROMPT="$(cat)"; else PROMPT="$*"; fi
ssh "$HOST" "curl -sS --max-time 310 -X POST --data-binary @- http://127.0.0.1:${PORT}/ask" <<< "$PROMPT"
```

And in use:

```bash
$ ./ask-mini "In one short sentence: what hostname are you running on?"
Running on `Parkers-Mac-mini.local`.
```

That's it. From any Tailnet device with my SSH key, I can hand a prompt to my always-on Claude and get the response back as plain text. The whole thing — daemon, CLI, plist — fits in under 150 lines.

## Why this matters more than it looks

The interesting part isn't the SSH plumbing. It's the new shape of operation:

- **Delegation.** "I'm on my laptop and I want to know X about the mini" stops requiring a context switch. I just ask. The mini's Claude reads its own filesystem, runs its own commands, and answers.
- **Always-on agents.** The mini is plugged in, on power, with stable network. Long-running tasks belong there. The bridge is the missing primitive that lets the laptop *commission* such tasks instead of doing them itself.
- **Composability.** Now that there's a clean `ask-mini` shell verb, anything I write on the laptop can use it. Skills, scripts, even cron'd tasks. The mini becomes a callable resource.

The bigger lesson: the right interface for cross-machine AI is *not* "shared chat session" or "synced state." It's **delegation through plain shell**. One agent shelling out to another, both fully autonomous, communicating through stdin/stdout. The IPC is so boring it doesn't need a protocol. That's the point.

Source code (for the curious): [psoren/parker-site-registry](https://github.com/psoren/parker-site-registry) — the `bridge/` directory is the daemon and the CLI.
