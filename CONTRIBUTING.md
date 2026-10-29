# Contributing to gitowl

Thanks for helping! gitowl is a desktop Git and GitHub workspace written in Rust and React.
This guide covers everything from setting up a development machine to getting a pull request merged.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Day-to-day workflow](#day-to-day-workflow)
- [Checks your change must pass](#checks-your-change-must-pass)
- [Coding guidelines](#coding-guidelines)
- [Design guidelines](#design-guidelines)
- [Commit messages and pull requests](#commit-messages-and-pull-requests)
- [Releasing (maintainers)](#releasing-maintainers)
- [License of contributions](#license-of-contributions)

## Ways to contribute

- **Report a bug**: use the [bug report form](https://github.com/ardfaiyaz/gitowl/issues/new?template=bug_report.yml). Include your OS, `gitowl --version`, `git --version` and the steps to reproduce.
- **Suggest a feature**: use the [feature request form](https://github.com/ardfaiyaz/gitowl/issues/new?template=feature_request.yml). Describe the problem before the solution.
- **Fix something**: issues labelled `good first issue` and `help wanted` are ready to pick up. Comment on the issue first so work isn't duplicated.
- **Security problems**: never in a public issue. Follow [SECURITY.md](SECURITY.md).

For anything larger than a small fix, open an issue to agree on the approach before writing code.

## Development setup

The [installation section of the README](README.md#build-from-source) lists every requirement with
versions for Windows, macOS and Linux. In short you need:

| Tool | Version | Why |
|---|---|---|
| Rust | **1.88** or newer (CI uses latest stable) | the app |
| Node.js | **20.19+**, **22.13+** or **24+** (CI uses 26) | building the UI |
| npm | 10 or newer (ships with Node.js) | UI dependencies |
| Git | **2.34** or newer | everything gitowl does runs through Git |
| GitHub CLI (`gh`) | 2.50 or newer, optional | only for the GitHub features |
| Platform webview toolchain | see README | the desktop window |

Then:

```sh
git clone https://github.com/ardfaiyaz/gitowl.git
cd gitowl
npm --prefix frontend ci          # exact UI dependencies from the lockfile
npm --prefix frontend run build   # the Rust build embeds frontend/dist
cargo run                         # opens gitowl on this repository
```

Useful variants:

```sh
cargo run -- path/to/some/repo     # open another repository
cargo run -- --library             # start on the Open folder screen
cargo run -- --no-browser --port 4318   # headless: prints a URL for HTTP checks, no window
cargo run --no-default-features    # headless-only build (no webview); used by Docker and tests
```

> **Rebuild the UI after frontend changes.** `cargo run` embeds whatever is in `frontend/dist`.
> `npm --prefix frontend run dev` is fine for styling, but Git operations need the Rust server.

## Project layout

```
gitowl/
├── src/                     Rust: CLI, local server, Git and GitHub boundaries
│   ├── main.rs              CLI flags, loopback HTTP server, session token, embedded UI
│   ├── desktop.rs           native window (tao + wry), navigation restrictions
│   ├── service.rs           the operation router: every UI action is an `op`
│   ├── git.rs               Git subprocess boundary and core helpers (+ tests)
│   ├── github.rs            GitHub CLI boundary: PRs, issues, Actions, settings (+ tests)
│   ├── branches.rs  remotes.rs  stash.rs  tags.rs  conflict.rs  hunks.rs
│   ├── commit_edit.rs       latest-commit editing and recovery points
│   ├── rewrite.rs           older-commit editing and rebase plans
│   └── packages.rs          npm / cargo publish
├── frontend/                React 19 + TypeScript + Vite UI (see frontend/README.md)
├── scripts/                 smoke, benchmark and live-GitHub end-to-end scripts (Node)
├── packaging/               Windows (Inno Setup), macOS (Info.plist), Linux (.desktop)
├── assets/brand/            logo masters and generated icons
├── docs/                    product requirements, roadmap, screenshots
├── DESIGN.md                interface rules every UI change follows
└── .github/workflows/       CI (check.yml) and releases (release.yml)
```

How a feature is wired: the UI calls `api("some_op", { repo, ...data })` (`frontend/src/api.ts`).
`service.rs` routes the op; Git work goes through `git::run` and GitHub work through `github::execute`,
which call the `git` and `gh` executables with **separate arguments, never a shell string**.

## Day-to-day workflow

1. Fork the repository and create a branch from `main`: `git switch -c fix/short-description`.
2. Make the change, with a test when it adds or changes logic.
3. Run the checks below.
4. Push and open a pull request; fill in the template.

## Checks your change must pass

CI runs exactly these on Windows, macOS and Linux. Run them locally first:

```sh
npm --prefix frontend run lint
npm --prefix frontend run build
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked
node scripts/smoke.mjs                 # end-to-end HTTP checks against the debug build
```

CI also runs the smoke script with `--outside` to check the welcome-screen startup path.
The separate `install.yml` workflow installs the documented Fedora/Arch packages and checks
native headers and linking in containers when the installation instructions change.
On Windows, `node scripts/desktop-smoke.mjs` also checks native-window rendering from a
write-protected executable folder. It requires the WebView2 Runtime and uses a temporary repository.

Optional:

```sh
node scripts/bench.mjs                 # times core operations on a generated 5,000-commit repository
docker compose run --rm checks         # Linux headless tests in a container (Docker Desktop, Linux containers)
GITOWL_GH_SANDBOX=you/sandbox-repo node scripts/github-e2e.mjs   # live GitHub writes; disposable repo you own ONLY
```

Unit tests, smoke checks and benchmarks work in temporary repositories (`work/` or the OS temp folder).
The optional `github-e2e.mjs` script uses your authenticated GitHub CLI and writes to the explicitly
selected sandbox repository.

## Coding guidelines

**Rust**
- `cargo fmt` formatting; no Clippy warnings.
- Run external programs with `Command` and separate arguments. Never build a shell command from user input.
- Validate everything that arrives from the UI at the boundary: paths with `git::validate_file`, branch names with `git check-ref-format`, hashes as hex, GitHub names against their allowed characters.
- Anything that rewrites history or deletes data saves a recovery point first (`refs/gitowl/recovery/…`) or requires an explicit, typed confirmation.
- New logic gets a test in the module's `tests` block. Tests use `tempfile` repositories.

**TypeScript / React**
- Type-check and lint clean (`npm run build`, `npm run lint`); the React Compiler rules are on.
- Talk to the backend only through `api()`. Keep component files exporting components only; shared helpers go in plain `.ts` modules.
- Reuse the shared parts (`Segmented`, `Dialog`, `Sheet`, `Skeleton`, `Banner`) rather than writing new ones.

**Both**
- Comments explain *why*, not what. Match the density of the surrounding code.
- Keep changes focused: no drive-by refactors in a feature pull request.

## Design guidelines

gitowl follows a macOS/iOS-style design system. Read [DESIGN.md](DESIGN.md) before changing the UI. The essentials:

- Colours, radii and shadows come from the CSS variables in `App.css`; never hard-code a new colour.
- Mutually exclusive choices use `<Segmented>`; confirmations use `<Dialog alert>`; forms use `<Sheet>`.
- Every control is keyboard-reachable with a visible focus ring and an accessible name.
- Check your change in **light and dark** mode and at a narrow window width.
- Include before/after screenshots in the pull request for visible changes.

## Commit messages and pull requests

- Write commit subjects in the imperative, under ~72 characters: `Add blame view to file history`.
- Explain the *why* in the body when it isn't obvious.
- One logical change per pull request. Link the issue it closes (`Closes #123`).
- The pull request template's checklist must be complete before review.
- A maintainer reviews and merges; CI must be green.

## Releasing (maintainers)

1. Update `version` in `Cargo.toml`, run `cargo build` to refresh `Cargo.lock`, and move the
   `Unreleased` notes in [CHANGELOG.md](CHANGELOG.md) under `## [<version>] - YYYY-MM-DD`.
2. Run the checks above and wait for branch CI to pass. Commit and push the release changes,
   then tag that commit: `git tag -a v0.2.0 -m "gitowl v0.2.0"` and `git push origin v0.2.0`.
3. `.github/workflows/release.yml` builds the Windows installer, macOS `.dmg`, Linux `.deb` and archives
   with SHA-256 checksums, and creates a **draft** release. It rejects tags that do not match
   `Cargo.toml` or lack dated changelog notes. Review the notes and artifacts, then publish it.

Code signing runs only when these repository secrets exist (otherwise artifacts are unsigned):
`WINDOWS_CERT_PFX` (base64), `WINDOWS_CERT_PASSWORD`; `MACOS_CERT_P12` (base64), `MACOS_CERT_PASSWORD`,
`MACOS_SIGN_IDENTITY`; and for notarization `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`.

## License of contributions

gitowl is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE). Unless you state
otherwise, any contribution you intentionally submit for inclusion is dual-licensed the same way,
without any additional terms or conditions.
