---
title: 'Cross-machine Claude IPC: a bridge between my MBP and my Mac mini'
description: 'Getting Claude Code on a laptop to run Claude Code on an always-on Mac mini over Tailscale, and the macOS login-Keychain problem that blocks the obvious approach.'
pubDate: '2026-05-27'
coauthor: 'Claude (Opus 4.7, 1M context)'
---

I have a bunch of private sites running on my always-on Mac mini — financial dashboard, kindle photo display, a few three.js dioramas — all reachable only over Tailscale. I built a tiny dashboard on the mini that lists them so I can jump to any one from my laptop, phone, or iPad. Then I wanted to *maintain* that dashboard from my laptop without SSHing into the mini for every edit — and that meant the Claude on my MacBook needed to talk to the Claude on the mini. The naive approach doesn't work, because of how the macOS login Keychain is scoped.

## The naive approach

```bash
ssh parkers-mac-mini 'claude -p "what is your hostname?"'
# Not logged in · Please run /login
```

On macOS, Claude Code stores its OAuth token in the login Keychain. The login Keychain is unlocked only inside your **GUI session**. A fresh SSH session is a separate session, so it inherits a *locked* Keychain. `claude` tries to read the token, the Keychain can't unlock without a GUI prompt (which SSH can't show), and it gives up.

ACLs on the keychain item don't help — that controls *which apps* may read the secret, not whether the database itself is unlocked. You can verify by running `security show-keychain-info ~/Library/Keychains/login.keychain-db` over SSH; it returns `User interaction is not allowed.`

## The shape that works

Don't have the SSH session invoke Claude. **Run a tiny daemon on the mini that wraps `claude -p`, started inside the GUI session.** SSH sessions just curl it over loopback.

```
[ MBP zsh ]
    │  ssh (key auth)
    ▼
[ mini sshd ]
    │  curl http://127.0.0.1:9100/ask
    ▼
[ bridge daemon ]    ← born in the GUI session → Keychain unlocked
    │  subprocess: claude -p "<prompt>"
    ▼
[ Claude on mini ]
```

The daemon is 70 lines of Python with no dependencies. Bind to `127.0.0.1`, so the only way in is via SSH to the mini.

## The shell verb

```bash
HOST="${MINI_HOST:-parkers-mac-mini}"
PORT="${MINI_BRIDGE_PORT:-9100}"
if [ "$1" = "-" ]; then PROMPT="$(cat)"; else PROMPT="$*"; fi
ssh "$HOST" "curl -sS --max-time 310 -X POST --data-binary @- http://127.0.0.1:${PORT}/ask" <<< "$PROMPT"
```

In use:

```bash
$ ./ask-mini "In one sentence: what hostname are you on?"
Running on `Parkers-Mac-mini.local`.
```

## Gotchas worth saving

Each of these cost me 10–30 minutes.

- **Mac App Store Tailscale** can't run a Tailscale-SSH server (sandbox). Fall back to regular `sshd` with key auth.
- **Key offered, server accepts, "Permission denied"** = passphrased private key + nothing to type into. Either `ssh-add --apple-use-keychain` it once, or use a fresh passphrase-less key.
- **`sshd` needs Full Disk Access** to read `authorized_keys` on recent macOS. Privacy → FDA → add `/usr/libexec/sshd-keygen-wrapper`, toggle Remote Login.
- **Keychain ACL ≠ unlocked Keychain.** ACL controls *which apps*; unlock controls *whether at all*. The first doesn't imply the second.
- **LaunchAgents have a minimal PATH.** Without an `EnvironmentVariables` block, `claude` is "not found" even when installed. Add every plausible install dir explicitly.

## What this enables

With `ask-mini` in `$PATH`, any script on the laptop can run work on the always-on machine — skills, cron jobs, other agents. The mini becomes a callable resource rather than a host I log into. The interface is plain shell: stdin/stdout over SSH, with no protocol and no auth tokens beyond the SSH key.

Source: [psoren/claude-bridge](https://github.com/psoren/claude-bridge).

## Postscript: prior art

After publishing this, a web search turned up two existing projects with overlapping goals that predate mine:

- **[willjackson/claude-code-bridge](https://github.com/willjackson/claude-code-bridge)** — same name, WebSocket-based, supports file operations as well as prompt delegation. More elaborate than mine.
- **[rohitg00/tailclaude](https://github.com/rohitg00/tailclaude)** — Claude Code on your Tailnet, with OTel tracing and shared task state. The closest geographic match to my stack.

Both also wrap the `claude` CLI, so they inherit OAuth/Keychain auth the same way mine does (a claim I incorrectly made about mine being distinctive — fixed in the bridge repo's README).

I left mine standing anyway because the architecture is genuinely smaller — 75 lines of Python plus a 25-line bash CLI, no protocol, no auth tokens, no external dependencies — and because the specific Keychain workaround (born-in-GUI daemon, SSH never touches `claude`) is a different shape than the typical "configure SSH to unlock the keychain" solution. Whether that's worth a separate project or just a footnote on the others is a judgment call. The writeup is probably more useful than the daemon itself.
