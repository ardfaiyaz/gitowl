# Security policy

## Supported versions

gitowl is in alpha. Security fixes go into the latest release only.

| Version | Supported |
|---|---|
| latest release | ✅ |
| older releases | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub: open the repository's
[**Security** tab → **Report a vulnerability**](https://github.com/ardfaiyaz/gitowl/security/advisories/new).
Include:

- what an attacker could do, and under which conditions;
- steps or a proof of concept to reproduce it;
- the gitowl version (`gitowl --version`), operating system, and Git / GitHub CLI versions.

You can expect an acknowledgement within **7 days** and a status update at least every **14 days**
until it is resolved. We'll credit you in the release notes unless you prefer otherwise.

## How gitowl is designed to be safe

Knowing the intended boundaries helps you judge what counts as a vulnerability:

- **Local only.** The UI talks to a server bound to `127.0.0.1` on a random port. Every request needs a
  random per-session token and passes origin and host checks. Nothing listens on the network.
- **No shell.** Git and the GitHub CLI are run as programs with separate arguments; user input is never
  interpolated into a shell command. Paths, branch names, hashes and GitHub names are validated first.
- **Authentication through Git and `gh`.** Git uses your configured credential helper;
  GitHub access goes through `gh`, which uses the OS credential store when available and can
  fall back to a plaintext config file. gitowl does not read or store those authentication tokens.
  Actions secret values are passed to `gh` on standard input and are never shown, logged or stored.
- **Strict content security policy** in the window: scripts and styles from the app only, images only
  from the app or `data:` URLs, no frames. README content is rendered as plain React elements, never as HTML.
- **Recoverable by default.** History rewrites, resets and similar actions save a recovery point first;
  destructive GitHub actions need an explicit, often typed, confirmation.

A way around any of these is a vulnerability we want to hear about.
