# Changelog

All notable changes to gitowl are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor versions may
include breaking changes.

## [Unreleased]

### Added
- A dedicated Repository settings page with live GitHub settings, searchable sections, existing repository and secret controls, and links to manage additional settings on GitHub.

### Changed
- Top success/error banners are replaced with centered GitHub Desktop-style toast capsules, matching its colors, padding, typography and entrance/exit timing. Success messages dismiss after three seconds; errors retain dismissal, details and recovery actions.
- Changes and History give diffs a larger reading area, larger code text and more space between panels.
- Workspace startup shows an animated gitowl logo splash for at least 2.2 seconds, continuing until loading finishes, instead of a skeleton card.
- Dark mode now uses GitHub's dark palette throughout the app, including panels, controls, dialogs, status colors, diffs and logs. Light mode keeps its existing palette.

### Fixed
- Dropdown labels stay on one line, comparison selectors size to their text, and grouped controls retain space for labels and chevrons instead of squeezing or clipping.
- Centered action-button labels and icons, added consistent wrapping toolbar gaps, and improved spacing for branch, recovery and package actions in narrow windows.
- Open on GitHub from History opens the selected commit's detail page instead of its file tree.
- The commit editor uses a short, plain-language message when uncommitted changes block editing.
- Added bottom spacing below the reflog panel.

## [0.1.1] - 2026-10-29

### Fixed
- Windows desktop startup after installing to `Program Files`: WebView2 stores its data in
  `%LOCALAPPDATA%\gitowl\WebView2` instead of trying to write beside the executable.

### Added
- Windows native-window startup checks from a write-protected executable folder in CI and releases.

## [0.1.0] - 2026-10-29

First public alpha release.

### Added
- Native desktop window launched with `gitowl`, staging and commits, diffs with hunk and
  line staging, history with filters, branches, remotes, stashes, tags, merges, pull strategies,
  conflict resolution, commit editing, rebase plans with recovery points, and GitHub pull requests,
  issues, Actions and releases through the GitHub CLI.
- Pull request review: details sidebar (reviewers, assignees, labels, milestone), inline review threads,
  suggested changes with Apply suggestion, Resolve and Reply, auto-merge, update branch, convert to draft,
  and live checks.
- Diff options (hide whitespace, wrap lines, find, show hidden lines), blame, reflog browser and
  reset to a commit with a recovery point.
- Changes: co-authors, Clean untracked files, image diffs (side by side, swipe, onion skin), Git LFS
  prompts, Open in diff tool, protected-branch notice, and force push with lease after a rejected push.
- History: drag-to-reorder and squash, Alt ↑/↓, and Verified signature badges.
- Settings: General, Accounts & signing, Commits & remotes, Recovery & packages, Secrets & variables,
  and Repository & danger zone.
- GitHub: issue editing (assignees, labels, milestone, pin, lock, transfer, delete), security alerts,
  README, organizations, and Search GitHub in the command palette.
- Open on GitHub for files, commits and branches; Open in terminal.
- Keyboard shortcuts: Ctrl Enter to commit, Ctrl ⇧ F to fetch, J / K to move between files.
- Dual MIT/Apache-2.0 licensing, contributor and security policies, issue forms and dependency updates.
- Windows installer, macOS disk image, Linux Debian package and portable archives with SHA-256 checksums.

### Changed
- macOS/iOS-style interface throughout: segmented controls, alerts for every confirmation, inset grouped settings.

[Unreleased]: https://github.com/ardfaiyaz/gitowl/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ardfaiyaz/gitowl/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ardfaiyaz/gitowl/releases/tag/v0.1.0
