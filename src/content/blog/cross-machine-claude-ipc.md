---
title: 'Cross-machine Claude IPC: a bridge between a laptop and a Mac mini'
description: 'Getting Claude Code on a laptop to run Claude Code on an always-on Mac mini over Tailscale, and the macOS login-Keychain problem that blocks the obvious approach.'
pubDate: '2026-05-27'
coauthor: 'Claude (Opus 4.7, 1M context)'
---

An always-on Mac mini runs several private services — a status dashboard, a Kindle photo display, a few three.js dioramas — reachable only over Tailscale. A small dashboard on the mini lists them for quick access from a laptop, phone, or iPad. Maintaining that dashboard from the laptop without SSHing into the mini for every edit means the Claude Code session on the laptop has to invoke the Claude Code session on the mini. The naive approach doesn't work, because of how the macOS login Keychain is scoped.

## The naive approach

```bash
ssh parkers-mac-mini 'claude -p "what is your hostname?"'
# Not logged in · Please run /login
```

On macOS, Claude Code stores its OAuth token in the login Keychain, which is unlocked only inside the **GUI session**. A fresh SSH session is a separate session, so it inherits a *locked* Keychain. `claude` tries to read the token, the Keychain can't unlock without a GUI prompt (which SSH can't show), and it gives up.

ACLs on the keychain item don't help — that controls *which apps* may read the secret, not whether the database itself is unlocked. Running `security show-keychain-info ~/Library/Keychains/login.keychain-db` over SSH confirms it: it returns `User interaction is not allowed.`

## The shape that works

Don't have the SSH session invoke Claude. **Run a small daemon on the mini that wraps `claude -p`, started inside the GUI session.** SSH sessions just curl it over loopback.

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

The daemon is 70 lines of Python with no dependencies. It binds to `127.0.0.1`, so the only way in is via SSH to the mini.

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

Each cost 10–30 minutes to diagnose.

- **Mac App Store Tailscale** can't run a Tailscale-SSH server (sandbox). Fall back to regular `sshd` with key auth.
- **Key offered, server accepts, "Permission denied"** = passphrased private key + nothing to type into. Either `ssh-add --apple-use-keychain` it once, or use a fresh passphrase-less key.
- **`sshd` needs Full Disk Access** to read `authorized_keys` on recent macOS. Privacy → FDA → add `/usr/libexec/sshd-keygen-wrapper`, toggle Remote Login.
- **Keychain ACL ≠ unlocked Keychain.** ACL controls *which apps*; unlock controls *whether at all*. The first doesn't imply the second.
- **LaunchAgents have a minimal PATH.** Without an `EnvironmentVariables` block, `claude` is "not found" even when installed. Add every plausible install dir explicitly.

## What this enables

With `ask-mini` in `$PATH`, any script on the laptop can run work on the always-on machine — skills, cron jobs, other agents. The mini becomes a callable resource rather than a host to log into. The interface is plain shell: stdin/stdout over SSH, with no protocol and no auth tokens beyond the SSH key.

Source: [psoren/claude-bridge](https://github.com/psoren/claude-bridge).

## Postscript: prior art

After publishing, a web search turned up two existing projects with overlapping goals that predate this one:

- **[willjackson/claude-code-bridge](https://github.com/willjackson/claude-code-bridge)** — same name, WebSocket-based, supports file operations as well as prompt delegation. More elaborate than this one.
- **[rohitg00/tailclaude](https://github.com/rohitg00/tailclaude)** — Claude Code on a Tailnet, with OTel tracing and shared task state. The closest match to this stack.

Both also wrap the `claude` CLI, so they inherit OAuth/Keychain auth the same way this bridge does (an earlier claim that this approach was distinctive in that respect was wrong, and has been corrected in the bridge repo's README).

The bridge is kept anyway because its architecture is smaller — 75 lines of Python plus a 25-line bash CLI, no protocol, no auth tokens, no external dependencies — and because the specific Keychain workaround (a daemon born in the GUI session, with SSH never touching `claude`) is a different shape than the typical "configure SSH to unlock the keychain" solution. Whether that's worth a separate project or just a footnote on the others is a judgment call; the writeup is probably more useful than the daemon itself.
