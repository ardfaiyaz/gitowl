# gitowl roadmap

## Phase A — Local alpha (implemented)
- CLI launch into a native desktop window and repository detection.
- Open folder welcome screen and folder picker; automatic opening from repository folders.
- Searchable local/remote branches, tracking checkout, explicit branch publishing and upstream setup.
- Keyboard-contained dialogs with Escape and focus restoration; shared vector icons and readable desktop controls.
- Individual/bulk staging, explicit discard, stash save/list/pop, commits and diff preview.
- Searchable history and file history.
- Local branches with rename/delete, remote management, basic merges, explicit pull strategies, and rebase continue/abort.
- Three-way UTF-8 text conflict editing with stale-write checks.
- Latest-commit message/author editor with clean-state checks, fetched-remote/tag checks, recovery references and guarded restore.
- Identity, .gitignore, lightweight/annotated tags, local tag deletion and selected tag push.

## Phase B — Git workflow depth (implemented)
- Latest-commit content amendment from staged changes.
- Older-commit message, author and committer editing with an affected-commits preview and guarded restore.
- Guided rebase plans: reorder, squash, fixup and drop, with a recovery point before every run.
- Persistent recovery-point browser: recover as branch, delete.
- Diffs with real old/new line numbers, side-by-side layout and hunk staging/unstaging.
- Branch comparison and branch creation from any branch, tag or commit.
- Rename-following file history.
- Intra-line change highlighting in unified and side-by-side diffs.
- "Explain changes": a rule-based (no LLM, offline) per-file explanation above every diff — functions added/removed/changed, how a function's approach changed (calls swapped, error handling, loops, conditions, async, logging), dependency bumps, tests and TODOs.
- Take-a-side resolution for add/delete and binary conflicts.
- Redesigned sidebar (search, grey active pill, projects, Light/Dark switch, collapsible icon rail with tooltips; Ctrl B).
- Dark mode (System / Light / Dark, remembered).
- Command palette (Ctrl K) with page shortcuts Ctrl 1–6.
- Undo last commit (with recovery point; refused once pushed), revert and cherry-pick from History; conflicts roll back cleanly.
- Open the repository in VS Code or the file manager from the palette.
- For you (review requests, changes requested on your PRs, assigned issues with Start work, failing CI) and the GitHub notifications Inbox on Overview when signed in; unread count as a red sidebar badge.
- New Repository (README, .gitignore and license templates, first commit), Publish to GitHub for repositories without a remote, and Fork / Sync fork.
- Actions: Run workflow with its declared inputs, full job logs grouped by step with search and error highlighting, artifact downloads, and live status for running runs.

## Phase C — GitHub collaboration (implemented through the GitHub CLI)
- Sign-in owned by `gh auth login` (OS keyring), independent from commit identity; sign out from the app.
- Pull requests: list/search/filter, detail with conversation, commits, checks and files, review, comment, merge (merge/squash/rebase), close/reopen, ready for review, local checkout, create.
- Issues: list/search/filter, detail, comment, close/reopen, create.
- Actions: run list, job and step results, re-run failed jobs, cancel.
- Releases: list, create from a pushed tag with notes, draft/pre-release flags and assets.
- Account repository list and clone (no device scanning).

## Phase D — Distribution and scale (partly implemented)
- Done: tag-triggered release workflow producing versioned Windows/Linux/macOS archives with SHA-256 checksums as a draft release.
- Done: `scripts/bench.mjs` large-repository benchmark (5,000 commits, 2,000 files: workspace opens in about 0.6 s on the development machine).
- Done: recent-projects list for switching between projects without scanning.
- Done: Windows installer, macOS .dmg, Linux .deb in the release workflow; Authenticode and Apple codesign/notarization steps that run when signing secrets are configured.
- Done: on-demand update check against the latest GitHub release.
- Done: [v0.1.0](https://github.com/ardfaiyaz/gitowl/releases/tag/v0.1.0), the first public alpha release, published October 29, 2026. Windows, macOS and Linux builds and production smoke tests passed; release download checksums and archive licenses were verified.
- Done: Fedora and Arch prerequisite installation and native-header/link checks in CI containers; Windows winget package IDs verified against the catalog.
- Done: keyboard and accessible-name pass (automated); every visible control is named and reachable by Tab.
- Open: buying signing certificates, clean-machine winget installation, Fedora/Arch desktop interaction checks, and a screen-reader (NVDA/VoiceOver) session with a person.

## Phase E — Review depth and design parity (implemented)
- Pull request review: details sidebar (reviewers, assignees, labels, milestone), inline review threads with suggestions, Apply suggestion, Resolve and Reply, auto-merge, update branch, convert to draft, live checks.
- Diff options (hide whitespace, wrap, find, show hidden lines), blame, reflog browser, reset to a commit, keyboard shortcuts list.
- Changes: co-authors, Clean untracked files, image diffs, Git LFS prompts, external diff tool, protected-branch notice, force push with lease after a rejected push.
- History: drag-to-reorder and squash, Verified signature badges.
- Settings: accounts and commit signing, Actions secrets and variables, repository settings and danger zone, editor choice.
- GitHub: issue editing (pin, lock, transfer, delete), security alerts, README, organizations, GitHub search in the command palette, Open on GitHub for files, commits and branches.

## Not planned yet
- Package publishing beyond npm and Cargo root packages (PyPI, NuGet, workspaces).
- Rebase plans across merges.
- Rendering README images from hosts other than GitHub (blocked by the app's content security policy by design).

Desktop interaction and accessibility verification remains required before calling the UI production-ready.
