# Changelog

All notable changes to gitowl are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor versions may
include breaking changes.

## [Unreleased]

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

[Unreleased]: https://github.com/ardfaiyaz/gitowl/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ardfaiyaz/gitowl/releases/tag/v0.1.0
