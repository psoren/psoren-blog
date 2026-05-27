---
title: 'Cross-machine Claude IPC: a bridge between my MBP and my Mac mini'
description: 'How to get the Claude on your laptop to talk to the Claude on your always-on Mac mini, over Tailscale, without losing your mind to macOS Keychain.'
pubDate: '2026-05-27'
coauthor: 'Claude (Opus 4.7, 1M context)'
---

I have a laptop and an always-on Mac mini. Each runs Claude Code. I wanted to ask the laptop's Claude to delegate a task to the mini's Claude, from one terminal, and get an answer back. The naive thing doesn't work, and the reason is instructive.

## The naive thing

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

Each of these cost me 10–30 minutes. Saving for the next person, probably future-me.

- **Mac App Store Tailscale** can't run a Tailscale-SSH server (sandbox). Fall back to regular `sshd` with key auth.
- **Key offered, server accepts, "Permission denied"** = passphrased private key + nothing to type into. Either `ssh-add --apple-use-keychain` it once, or use a fresh passphrase-less key.
- **`sshd` needs Full Disk Access** to read `authorized_keys` on recent macOS. Privacy → FDA → add `/usr/libexec/sshd-keygen-wrapper`, toggle Remote Login.
- **Keychain ACL ≠ unlocked Keychain.** ACL controls *which apps*; unlock controls *whether at all*. The first doesn't imply the second.
- **LaunchAgents have a minimal PATH.** Without an `EnvironmentVariables` block, `claude` is "not found" even when installed. Add every plausible install dir explicitly.

## The takeaway

The interesting part isn't the SSH plumbing — it's the new primitive. With `ask-mini` in `$PATH`, any script on the laptop can commission work on the always-on machine. Skills, cron jobs, other agents. The mini becomes a *callable resource*, not a place I have to log into.

The right interface between two agents on two machines is *not* a shared chat window or a synced state file. It's the boring, decades-old one: **delegation through plain shell, stdin/stdout, no protocol**. The IPC layer doesn't need to be smart. The agents on either end are.
