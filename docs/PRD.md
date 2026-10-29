# gitowl — Product Requirements Document

**Version:** 1.0  
**Updated:** October 29, 2026  
**Product stage:** Desktop release 1.0 (v1.0.0); Phases A–C and E implemented, Phase D partly implemented
**Command:** `gitowl`  
**Former working name:** GitNest

## 1. Product summary

gitowl is a desktop Git interface launched from a terminal. A developer types `gitowl` and receives a dedicated application window for reviewing files, staging changes, making commits, exploring history, managing branches and remotes, and resolving conflicts.

When launched inside a Git repository or any of its subfolders, gitowl automatically opens that repository. When launched elsewhere, it presents one primary action: **Open folder**. Device scanning and a project-discovery catalog are intentionally excluded.

gitowl works with local Git repositories, including those connected to GitHub or other Git remotes. GitHub collaboration (pull requests, issues, Actions, releases, cloning) is available through the GitHub CLI. The desktop Git workflow does not require a gitowl account, a hosted application server, or Docker.

## 2. Problem and purpose

Git is powerful, but routine operations often require developers to remember commands, interpret index state, and understand history-rewriting consequences before seeing a useful preview. IDE source-control panels can be convenient but vary between editors and may obscure advanced workflows.

gitowl aims to make Git state visible and actions understandable. Developers should be able to answer:

- What changed, and how does it differ from the previous version?
- Which changes will be included in my next commit?
- Which branch am I on, and where will a push go?
- Which commit changed a file?
- What must I do to finish or abort an interrupted operation?
- Will editing a commit change its hash or affect published history?

The product should reduce command memorization while preserving Git's behavior, credential helpers, hooks, signing, and repository structure.

## 3. Target users

| User | Primary need |
| --- | --- |
| Developers learning Git | Clear staging, commit, branch and conflict workflows with useful explanations. |
| Developers comfortable in a terminal | A fast visual workspace launched from the current directory. |
| Developers using multiple editors | Consistent Git tooling independent of their IDE. |
| Maintainers | Searchable history, remote management, tags, and eventually pull requests and releases. |

The initial delivery target is Windows. The architecture supports macOS and Linux desktop builds, but platform-specific execution and packaging must be verified before those platforms are advertised as supported releases.

## 4. Goals and scope boundaries

### Goals

1. Open a repository quickly from the developer's current terminal context.
2. Make working-tree, index, branch and operation state understandable.
3. Commit only the changes the developer selected and reviewed.
4. Provide practical branch, remote, stash, tag and conflict workflows.
5. Introduce history editing through explicit previews, checks and recovery references.
6. Remain useful offline for local repository operations.
7. Keep repository contents local except for developer-initiated remote operations.
8. Deliver a maintainable desktop application with repeatable tests and builds.

### Outside the initial scope

- Scanning the entire device for repositories.
- Requiring cloud accounts for local Git operations.
- Replacing GitHub's repository hosting service.
- Hosting the local Git workspace as a public web application.
- A full code editor, terminal emulator or IDE.
- Automatically discarding edits, rewriting history, or force-pushing.
- Automatically publishing packages to every package ecosystem.
- Supporting bare repositories as editable working projects.

## 5. Status definitions

**Implemented** means a corresponding workflow exists in the inspected codebase. It does not imply a signed release, complete accessibility audit, or verification against every operating system and external service.

**Planned** means a product requirement that is not yet implemented, or a substantial extension of a currently limited workflow.

## 6. Core user journeys

### 6.1 Open from a repository

1. The developer opens a terminal in a Git repository or one of its subfolders.
2. The developer runs `gitowl`.
3. gitowl resolves the repository root and opens its own desktop window.
4. Changes, the current branch and available actions appear without a repository-selection step.

### 6.2 Open from another directory

1. The developer runs `gitowl` outside a repository.
2. The welcome screen shows one primary **Open folder** button.
3. The developer browses to a repository or enters a folder path.
4. gitowl validates the selection and opens the repository root.
5. Invalid selections retain the picker and show a useful error.

### 6.3 Review and commit selected changes

1. The developer selects a changed file to inspect its diff.
2. The developer stages selected files individually or uses Stage all.
3. The staged preview represents the next commit; unstaged edits remain separate.
4. The developer enters a commit message and submits.
5. gitowl checks the repository snapshot, runs Git commit, and refreshes the workspace.
6. Unselected edits remain available for a later commit.

### 6.4 Work on a remote branch

1. The developer fetches remote updates.
2. The developer searches local and fetched remote branches.
3. The developer checks out a remote branch under a chosen local name.
4. gitowl creates a tracking branch and displays its upstream.
5. For a local branch without an upstream, Publish branch previews a configured remote and establishes tracking after a successful push.

### 6.5 Resolve an interrupted integration

1. A merge or pull with merge/rebase encounters conflicts.
2. gitowl shows operation state and conflicted files.
3. The developer compares base/ours/theirs and edits the result for supported text conflicts, or resolves unsupported cases in an external editor.
4. Resolved changes are staged.
5. The developer finishes the merge commit or continues the rebase, or explicitly aborts.

### 6.6 Correct the latest commit

1. In History, the developer selects **Edit latest commit**.
2. gitowl loads the current branch, hash, message, author and prior committer details.
3. Blocking reasons are shown before submission.
4. The developer changes the message or author and acknowledges the hash change.
5. gitowl rechecks eligibility, retains the original commit in a recovery reference, and invokes Git amend.
6. The result shows original/new hashes and offers a guarded restore action.

## 7. Functional requirements

### FR-01 — CLI and application lifecycle — Implemented

- `gitowl` is the installed executable and primary launch command.
- A positional path opens that repository or a subfolder within it.
- Default launch creates a native desktop window; it does not automatically launch a browser.
- Closing the window exits the application and shuts down its local server.
- Ctrl+C in the launching terminal is supported as a shutdown signal.
- `--library` explicitly opens folder selection instead of the current repository. This flag does not enable a project catalog.
- `--no-browser` retains a development-only headless server mode; `--port` selects its port. The default port is assigned dynamically.
- A missing Git executable produces a useful installation/configuration error.

### FR-02 — Folder selection and repository context — Implemented

- Browse accessible directories and drive roots; navigate to parent folders or enter a path.
- Resolve repository roots through Git rather than relying solely on a `.git` directory test.
- Automatically detect repository context from nested folders.
- Use one active repository per server session. Independent projects can use independent processes.
- Repository-scoped API requests identify the intended repository and reject a mismatched active project.
- Do not scan the device or populate a discovery catalog.

### FR-03 — Working changes and staging — Implemented

- List new, modified, deleted, staged, unstaged and conflicted files.
- Stage or unstage individual files; support Stage all and Unstage all.
- Preserve existing partial staging unless the developer explicitly stages the latest whole-file edits.
- Distinguish a file that has both staged changes and additional unstaged changes.
- Discard selected changes only through an explicit destructive-action flow. Tracked-file restoration and removal of selected untracked files must be described accurately.
- Reject unsupported discard cases and active operations rather than silently forcing them.

**Implemented:** Staging and unstaging individual hunks from the diff, with a stale-diff check.

**Implemented:** Selecting individual added/removed lines inside a hunk.

**Planned:** Richer rename presentation, and clearer large-file/truncated-output handling.

### FR-04 — Diff inspection — Implemented with limitations

- Show staged changes, additional unstaged changes, or all changes against the latest commit.
- Show commit patches and file-filtered history patches.
- Identify additions/removals using text signs as well as color.
- Use bounded previews, with a text-preview limit for large/untracked files and a visible limit on displayed patch lines.
- Show an explanation for binary files instead of pretending they are editable text.

**Implemented:** Unified and side-by-side layouts with real old/new source line numbers, per-hunk and per-line staging, intra-line change highlighting, hide whitespace, wrap, find, full-file context, image diffs, and branch comparison diffs.

**Planned:** Hunk keyboard navigation.

### FR-05 — Commits — Implemented

- Require a non-empty commit message and eligible staged changes, or an eligible merge completion.
- Commit the index snapshot; preserve unselected working-tree edits.
- Reject a submission when the staged snapshot or HEAD no longer matches the reviewed snapshot.
- Surface Git errors, hooks, authentication and signing failures without silently bypassing them.
- Refresh repository state after success or failure.

### FR-06 — History and file history — Implemented

- Paginate the current branch history in batches of 40 commits.
- Search commit messages; filter by author, start date and file path.
- Show commit hash, message, author and date.
- Jump to a validated commit hash and inspect its patch.
- Identify the first-parent comparison for merge-commit patches.
- Link a changed file to its filtered history.

**Implemented:** File history follows renames and opens each commit's patch under the file's path at that time.

**Planned:** Interactive commit graph, all-branch history, richer before/after file browsing, and advanced history filters.

### FR-07 — Branch management — Implemented

- List and search local branches and fetched remote branches.
- Identify the current branch and display upstream information where available.
- Create a local branch from the current commit and switch to it.
- Switch local branches, rename branches, and delete eligible local branches with Git's protections.
- Check out a fetched remote branch into a named local tracking branch.
- Validate branch names and reject unintended option-like inputs.
- Preserve edits or let Git stop a switch that would overwrite them.

**Implemented:** Branch comparison (ahead/behind, unique commits, diff since divergence) and explicit base selection when creating branches.

**Planned:** Advanced branch protection awareness.

### FR-08 — Remotes, fetch, pull and push — Implemented

- Display configured remotes; add a remote, change its URL, or remove it.
- Fetch updates from configured remotes.
- Offer explicit pull strategies: fast-forward only, merge, or rebase. Default to fast-forward only.
- Use the current branch's upstream for ordinary pull/push behavior.
- Preview a configured destination before the first branch publish and establish upstream tracking after success.
- Validate configured remote names and use explicit branch/tag refspecs where appropriate.
- Use existing Git authentication/credential helpers. The app does not implement a GitHub sign-in flow yet.
- Present actionable errors for missing upstreams, diverged history, authentication failures and rejected pushes.

### FR-09 — Merge and rebase operation controls — Implemented with limitations

- Start an explicit local branch merge.
- Detect active merge/rebase state and surface continuation/abort controls.
- Continue or abort a rebase that has already been initiated, including a pull with rebase.
- Complete a merge after resolving/staging conflicts, or explicitly abort it.
- Describe destructive consequences before aborting or discarding conflict-resolution edits.

**Implemented:** Guided rebase plans from History ("Rewrite from here…") with reorder, squash, fixup and drop; plans are blocked for ranges with merges, tags or fetched-remote commits, and a recovery point is kept before running.

**Planned:** Rebasing onto a different base and plans that preserve merges.

### FR-10 — Text conflict editor — Implemented with limitations

- Display common base, Git index side 2 (ours), side 3 (theirs), and an editable result.
- Provide actions to use either side or reset the editor result.
- Reject unresolved conflict markers before staging a resolution.
- Reject a stale save when the working file or index conflict stages changed externally.
- Limit inline editing to supported UTF-8 text files and index-stage combinations.

**Implemented:** Take side 2 or side 3 as a whole for any conflict, including add/delete and binary conflicts.

**Planned:** Rename conflict guidance, broader encoding support for inline editing, and symlink conflict workflows.

### FR-11 — Stashes — Implemented

- Save current changes with an optional single-line message.
- Explicitly choose whether to include untracked files.
- List saved stashes and pop a selected stash.
- Block inappropriate stash actions during an active merge/rebase.
- Surface conflicts and preserve Git's conflict behavior when applying a stash fails.

**Planned:** Stable stash identity checks against external list changes, apply-without-drop, selective stash creation, and richer stash inspection.

### FR-12 — Commit identities and latest-commit editing — Implemented with limitations

- Edit repository-local `user.name` and `user.email` for future commits.
- Explain that commit identity is independent of remote authentication.
- Edit the latest commit's message or author only after showing a preview and hash-change acknowledgement.
- Require a clean index/working tree and an attached local branch.
- Block tagged commits, active operations and commits contained in fetched remote branches.
- Recheck the expected HEAD and branch before applying.
- Retain the previous commit under `refs/gitowl/recovery/` before amending.
- Keep recovery references created under the former application's namespace readable.
- Permit result-screen restoration only when the current tip, clean state and matching tree/parents make the restore eligible.
- Use normal Git committer identity/timestamp behavior and configured hooks/signing.

Publication knowledge reflects locally fetched remote state. It cannot prove that a commit has never been published elsewhere. The interface must state this limitation.

**Implemented:** Amend staged content into the latest commit; edit the message, author and committer of older commits with a preview of affected newer commits; a persistent recovery-point browser (recover as branch, delete). Older-commit rewrites keep merge commits, run the commit-msg hook on the new message and the post-rewrite hook with the rewritten list; signing follows `commit.gpgSign`.

### FR-13 — Tags, releases and packages

**Implemented:** List local tags; create lightweight or annotated tags; delete a local tag; push an explicitly selected local tag to a configured remote.

**Implemented:** GitHub release listing and creation from a pushed tag with notes, draft/pre-release flags and assets.

**Implemented:** npm and Cargo package publishing from Settings, with a mandatory dry run and typed name@version confirmation, using the developer's registry login.

**Planned:** Rich tag details and other package ecosystems. A tag is not a GitHub release, and a GitHub release is not automatically a package publication. Package support must define the registry, credentials, build/signing requirements and approval flow for each ecosystem.

### FR-14 — Ignore-file editing — Implemented

- Read and edit the active repository's `.gitignore`.
- Preserve the editor contents when saving fails.
- Detect external edits by comparing the current file to the version originally opened.
- Reject linked `.gitignore` files in the supported editor flow.
- Explain that ignoring an already tracked file does not untrack it.
- Leave saved changes visible for review and staging.

### FR-15 — GitHub collaboration — Implemented through the GitHub CLI

Authentication, token storage and sign-out are delegated to the GitHub CLI (`gh auth login`, OS keyring). gitowl calls `gh` with argument arrays and prompts disabled. Pull requests support list/search, detail (conversation, commits, checks, files), review, comment, merge, close/reopen, ready for review, local checkout and creation. Issues, Actions runs and releases are also available. Account repositories can be listed and cloned from the welcome screen.

Original requirements:

- Authenticate to GitHub independently of commit identity.
- List, inspect and create pull requests for the selected repository.
- Show source/target branches, changed files, diffs, checks and review status.
- Make remote writes explicit; respect GitHub permissions and repository protection rules.
- Support sign-out and secure credential storage without embedding credentials in the app or repository.
- Consider listing account repositories and cloning a selected repository in a later phase. This must not reintroduce device scanning or replace the one-button local startup.

## 8. Information architecture and UX requirements

### Main surfaces

1. **Welcome:** one primary Open folder action.
2. **Changes:** changed files, staging controls, diff preview and commit composer; active-operation state must remain visible.
3. **History:** search/filter/pagination, selected commit patch, file history and latest-commit editor.
4. **Branches and tags:** searchable local/remote branches, tracking checkout, branch actions and tag workflows.
5. **Settings:** project identity, remote configuration and `.gitignore` editing.
6. **Focused dialogs:** folder selection, pull strategy, stash actions, conflict resolution, commit metadata editing and consequential action confirmation.

### Design requirements

- Keep the repository name, path and current branch discoverable.
- Use readable desktop typography, consistent vector icons and shared semantic color/spacing tokens.
- Avoid hiding the current operation behind an error dialog.
- Label actions by their effect: stage, unstage, discard, publish, merge, continue, abort.
- Explain the difference between author, committer and remote authentication.
- Preserve entered values on errors and show errors near the relevant task.
- Provide visible keyboard focus, semantic labels, keyboard-contained modal dialogs, Escape behavior and focus restoration.
- Respect reduced-motion and forced-color preferences.
- Support narrow windows without hiding required actions or fixed bars covering content.
- Present destructive actions and history rewrites with concrete impact information.

The current design guidance is in DESIGN.md. Automated checks do not substitute for visual, keyboard, screen-reader and zoom testing.

## 9. Architecture and data ownership

| Layer | Current choice and responsibility |
| --- | --- |
| CLI | Rust + Clap; arguments, repository context and launch behavior. |
| Desktop shell | Wry + Tao; native window, system webview and app lifecycle. |
| Local API | Axum + Tokio; loopback session, request validation and serialized service operations. |
| Git integration | Installed Git executable invoked with argument arrays rather than shell-built commands. |
| Interface | React + TypeScript + Vite; components, forms, dialogs and diffs. |
| Distribution | Production frontend assets embedded in the release executable. |
| Tests/builds | Disposable Git repositories, HTTP smoke checks, platform CI and Docker-assisted headless Linux tests. |

The Git repository remains the source of truth. gitowl uses its working tree, index, commits, refs, config, stashes and tags rather than creating a separate competing repository database.

Default desktop operation does not require an AWS backend. Optional future cloud infrastructure can host downloads, build jobs or explicitly designed online features. A cloud website alone cannot operate repositories on the user's device.

## 10. Security, privacy and reliability requirements

- Bind the local API to loopback, not all network interfaces.
- Use a random session token and validate request origin/host.
- Restrict native-window navigation to the application's session; deny unsolicited popup windows.
- Scope filesystem operations to the intended repository and validate file paths.
- Serialize application mutations within a server session. External Git processes and other app instances are not covered by that serialization.
- Recheck relevant snapshots before commits, conflict saves, ignore-file saves and metadata edits.
- Do not silently bypass hooks, signing, credentials or Git's protections.
- Bound Git command execution and preview output; report errors rather than hanging indefinitely.
- Do not upload repository contents, start telemetry, or contact cloud services implicitly.
- Keep source secrets out of builds and distribution artifacts.
- Treat destructive actions and irreversible remote writes as explicit user actions.
- Document that Git hooks and credential helpers are user-configured executable behavior and can affect operation results.

## 11. Performance and usability targets

These are release targets, not measured guarantees:

- A typical local repository should open its initial workspace within three seconds after process startup on a supported development machine.
- History must remain paginated rather than loading the complete repository at once.
- Long Git operations must show a working state and prevent duplicate submission.
- External changes should refresh while the window is visible; the current implementation polls about every seven seconds.
- Long names, paths, errors and commit messages must not obscure essential controls.
- Large repositories, large patches, unusual filenames and non-ASCII text require benchmark and usability coverage before stable release.

Current implementation limits include approximately 1 MB for supported untracked/conflict inline text and a 5,000-row patch display cap. Some Git subprocess output is bounded; explicit truncation feedback needs further hardening.

## 12. Acceptance criteria

1. Running `gitowl` in a repository subfolder opens the correct repository in a dedicated window.
2. Running it outside a repository shows Open folder without a scanning action.
3. An invalid folder selection shows an error and leaves the picker usable.
4. Staging one of two changed files and committing records only the selected changes.
5. Existing staged and unstaged versions remain distinct; stale commit submissions are rejected.
6. Stage all and Unstage all update index state without deleting working files.
7. Discard actions require deliberate confirmation and produce the described tracked/untracked outcome.
8. History pagination and message/author/date/file filters return the correct commits.
9. Remote checkout creates an eligible local tracking branch; publishing establishes the selected upstream without force-pushing.
10. Branch rename/delete, remote changes and tag creation/deletion/push validate inputs and surface Git errors.
11. Stash creation respects the include-untracked choice; applying a conflicting stash follows Git's preservation behavior.
12. Pull strategies are explicit; merge/rebase conflicts can be resolved or the operation can be aborted.
13. Conflict saves reject stale file/index content and remaining conflict markers.
14. Latest-commit message/author edits preserve the intended file snapshot, reject ineligible states and retain recovery references.
15. Metadata recovery rejects a changed tip or incompatible tree/parents; legacy recovery references remain usable.
16. Local identity changes do not masquerade as GitHub authentication.
17. `.gitignore` saves reject conflicting external edits.
18. Requests with invalid session credentials or untrusted origins are rejected.
19. Default launch does not start an external browser; closing the app stops its session.
20. Keyboard-only operation, screen readers, 200% zoom, narrow windows, high contrast and reduced motion are reviewed before stable release.

## 13. Validation strategy and release gates

### Automated checks

- Frontend TypeScript compilation, lint and production build.
- Rust formatting, Clippy and repository-focused tests.
- HTTP smoke tests against disposable repositories and temporary local bare remotes.
- Separate startup checks inside/outside repositories.
- Tests for paths with spaces, uncommitted/staged changes, conflicts, remote tracking, pull modes, stashes, tags, metadata recovery and unauthorized requests.
- Windows, Linux and macOS build checks where configured; distinguish build success from a native runtime test.

### Manual checks

- Native startup/shutdown, window resizing, branch switching and credential failures.
- Keyboard navigation, modal focus/escape/restoration and assistive-technology behavior.
- Large-repository and large-output behavior.
- Real GitHub workflows only after the authentication/collaboration implementation exists and the intended remote actions are authorized.

### Stable-release gates

- No known data-loss issue in supported workflows.
- Destructive and rewrite flows tested with recovery/failure cases.
- Documented supported platforms and installer/signing status.
- Visual/accessibility verification completed for supported desktop environments.
- Documentation accurately matches released behavior and limits.

CI (`.github/workflows/check.yml`) records current evidence on Windows, macOS and Linux. Historical test results are not a claim that every future build or platform has been verified.

## 14. Roadmap

Status: Phases A, B, C and E are implemented; see ROADMAP.md. Phase D has release artifacts, installers, update checks and a benchmark; signing certificates and a first tagged release remain open.

### Phase A — Local alpha, implemented

Native launch, repository detection, one-button folder selection, changed files, staging, commits, diffs, history, branch/remote management, merge and pull/rebase controls, supported text conflict editing, stashes, local/tag-push workflows, identity, `.gitignore`, latest-commit message/author editing and guarded recovery.

### Phase B — Git workflow depth

Content amendments; older-commit reword/authorship corrections; explicit committer editing; side-by-side diffs and true source line numbers; hunk staging; richer branch/file comparisons; rename-following history; persistent recovery browsing; broader conflict support and guided rebase planning.

### Phase C — GitHub collaboration

Secure GitHub authentication, pull request listing/creation and review context, checks/status, releases and release assets. Package publishing is a separately scoped ecosystem feature.

### Phase D — Distribution and scale

Signed installers, versioned release artifacts, update strategy, larger-repository benchmarks, broader accessibility coverage and optional multi-project session support without device scanning.

## 15. Success measures

Track these through controlled usability testing first. Product telemetry requires a separate explicit privacy/consent decision; it is not currently implied.

- Time from launch to the first useful file diff.
- Completion rate for stage-selected-files and commit tasks.
- Successful branch checkout/publish tasks without terminal fallback.
- Completion/recovery rates for supported conflict and metadata-editing tasks.
- Number of accidental staging, discard or wrong-destination actions observed in testing.
- Time to diagnose authentication, upstream and operation-state errors.
- Critical keyboard/accessibility findings remaining at release.

## 16. Open decisions

Decided: GitHub authentication uses the GitHub CLI and its keyring storage; token scopes are those granted to `gh`.


- Stable release platform order and code-signing/distribution method.
- How published-history checks should expand beyond locally fetched refs.
- Whether and how to expose expert force-push/history-rewrite workflows.
- GitHub authentication method, token scopes and secure credential storage.
- Update delivery and supported package registries.
- Performance limits that should be configurable versus fixed.
- Whether a future persistent recovery browser or multi-project workspace should become part of the initial stable release.

## 17. Rename and compatibility

The product, executable (`gitowl`), desktop title, frontend, request/session identifiers (`x-gitowl-token`) and build workflows use **gitowl** (always lowercase, as in the logo). Earlier names were Gityard and GitNest. The local project folder and any hosting name or remote URL are not renamed automatically and must be changed separately.

New recovery refs use `refs/gitowl/recovery/`. Recovery refs written under the former names remain readable and restorable through the legacy `refs/gityard/recovery/` and `refs/gitnest/recovery/` namespaces; existing repository refs are not bulk-moved or deleted. The recent-projects list moves to `gitowl/recent.json` and is read from the old `gityard/recent.json` until the first save.

Historical audit files may retain their original source paths. They are evidence of prior runs, not current installation instructions.
