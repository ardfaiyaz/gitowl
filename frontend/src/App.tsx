import { Fragment, useEffect, useState, useCallback, useRef, type CSSProperties } from "react";
import "./App.css";
import "./styles/shell.css";
import { api } from "./api";
import type { FileChange, Repo } from "./types";
import { Icon } from "./components/Icon";
import { CommitEditDialog } from "./components/CommitEditDialog";
import { Dialog } from "./components/Dialog";
import { BranchPanel, PublishDialog } from "./components/BranchPanel";
import { PullDialog } from "./components/PullDialog";
import { RemotePanel } from "./components/RemotePanel";
import { StashDialog } from "./components/StashDialog";
import { Diff } from "./components/Diff";
import { GitHubPanel } from "./components/GitHubPanel";
import { RebasePlanDialog, type Arrange } from "./components/RebasePlanDialog";
import { RecoveryPanel } from "./components/RecoveryPanel";
import { Blame, Reflog, ResetDialog, ShortcutsDialog } from "./components/HistoryParts";
import { Segmented } from "./components/Segmented";
import { CleanDialog, CoAuthors, ForcePushDialog, ImageDiff, NewBranchSheet } from "./components/ChangesParts";
import { isImage } from "./images";
import { AccountsPane, GeneralExtras, RepoPane, SecretsPane } from "./components/SettingsParts";
import { CloneDialog } from "./components/CloneDialog";
import { PackagePanel, UpdatePanel } from "./components/PackagePanel";
import { Overview } from "./components/Overview";
import { Sidebar, type Tab, type Theme } from "./components/Sidebar";
import { CommandPalette, type Command, type SearchResult } from "./components/CommandPalette";
import { NewRepoDialog, PublishRepoDialog } from "./components/RepoDialogs";
import { RepositorySettings } from "./components/RepositorySettings";
import { WorkspaceSplash } from "./components/WorkspaceSplash";
import { Toast } from "./components/Toast";

type Commit = {
  id: string;
  author: string;
  message: string;
  time: string;
  path?: string;
  // git %G?: G verified, U good but untrusted key, N unsigned, others unverifiable.
  signature?: string;
};
type Browse = {
  path: string;
  parent: string | null;
  roots: string[];
  directories: { name: string; path: string }[];
};
type Conflict = {
  base: string;
  ours: string;
  theirs: string;
  result: string;
  stages: string;
  file: string;
};
// The chosen appearance is a per-viewer convenience; "system" follows the OS setting.
function readTheme(): Theme {
  try {
    const t = localStorage.getItem("gitowl-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

type SettingsPane = "general" | "accounts" | "commits" | "recovery" | "secrets" | "repository";
// Per-viewer conveniences live in localStorage; private windows can refuse it, so reads fall back.
function readStored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice still applies for this session.
  }
}
function App() {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [osDark, setOsDark] = useState(systemDark);
  const [palette, setPalette] = useState(false);
  const [unread, setUnread] = useState(0);
  const [home, setHome] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dismissError = useCallback(() => setError(""), []);
  const dismissNotice = useCallback(() => setNotice(""), []);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [splashFinished, setSplashFinished] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSplashFinished(true), 2200);
    return () => clearTimeout(timer);
  }, []);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState("working");
  const [diff, setDiff] = useState("");
  const [message, setMessage] = useState("");
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [folder, setFolder] = useState("");
  const [commits, setCommits] = useState<Commit[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [since, setSince] = useState("");
  const [historyFile, setHistoryFile] = useState("");
  const [commitFile, setCommitFile] = useState("");
  const [blame, setBlame] = useState(false);
  const [hideWhitespace, setHideWhitespace] = useState(false);
  // Full context applies to one diff at a time; opening another file or commit collapses it again.
  const [fullFor, setFullFor] = useState("");
  const [shortcuts, setShortcuts] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("general");
  const [coAuthors, setCoAuthors] = useState<string[]>([]);
  const [rail, setRail] = useState(() => readStored("gitowl-sidebar", "full") === "rail");
  const [editor, setEditor] = useState(() => readStored("gitowl-editor", "code"));
  const [cleaning, setCleaning] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [newBranch, setNewBranch] = useState(false);
  const [protectedBranch, setProtectedBranch] = useState("");
  const [lfs, setLfs] = useState<{ installed: boolean; lfs: string[]; large: string[] }>({ installed: false, lfs: [], large: [] });
  // The last mutation that ran; a rejected push offers Force push in its error toast.
  const [lastOp, setLastOp] = useState("");
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [commitId, setCommitId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ignore, setIgnore] = useState<string | null>(null);
  const [oldIgnore, setOldIgnore] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolution, setResolution] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [editingCommit, setEditingCommit] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [stashing, setStashing] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<FileChange | null>(null);
  const [abortOperation, setAbortOperation] = useState<"merge" | "rebase" | null>(
    null,
  );
  const [recent, setRecent] = useState<string[]>([]);
  const [recentFilter, setRecentFilter] = useState("");
  const [github, setGithub] = useState<{ path: string; connected: boolean; signedIn: boolean } | null>(
    null,
  );
  const [cloning, setCloning] = useState(false);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [publishingRepo, setPublishingRepo] = useState(false);
  const [editTarget, setEditTarget] = useState("");
  const [planTarget, setPlanTarget] = useState("");
  const [resetTarget, setResetTarget] = useState("");
  const [planArrange, setPlanArrange] = useState<Arrange | undefined>();
  const [dragId, setDragId] = useState("");
  const [dropHint, setDropHint] = useState<{ id: string; mode: Arrange["mode"] } | null>(null);
  const [takeSide, setTakeSide] = useState<"ours" | "theirs" | null>(null);
  const repoRef = useRef(repo);
  useEffect(() => {
    repoRef.current = repo;
  }, [repo]);
  const busyRef = useRef(busy);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const openRepo = useCallback(async (path: string) => {
    const value = await api<Repo>("open", { path });
    setRepo(value);
    setRecent((list) => [value.path, ...list.filter((p) => p !== value.path)]);
    setTab("overview");
    setCommits([]);
    setHistoryLoaded(false);
    setSelected("");
    setDiff("");
    setBrowse(null);
    setName(value.identity.name);
    setEmail(value.identity.email);
    setIgnore(null);
    setMessage("");
    setPage(0);
    setPulling(false);
    setStashing(false);
    setDiscardTarget(null);
    setAbortOperation(null);
  }, []);
  useEffect(() => {
    let active = true;
    api<{ repo: string | null; home: string; recent: string[] }>("bootstrap")
      .then(async (value) => {
        if (!active) return;
        setHome(value.home);
        setRecent(value.recent);
        setFolder(value.home);
        if (value.repo) await openRepo(value.repo);
      })
      .catch(fail)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [openRepo]);
  const refresh = useCallback(async () => {
    const current = repoRef.current;
    if (!current) return;
    const value = await api<Repo>("status", { repo: current.path });
    if (repoRef.current?.path === current.path) setRepo(value);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!busyRef.current && document.visibilityState === "visible")
        void refresh().catch(fail);
    }, 7000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!repo || !selected || tab !== "changes") return;
    let active = true;
    api<{ text: string }>("diff", {
      repo: repo.path,
      file: selected,
      mode,
      ignoreWhitespace: hideWhitespace,
      fullContext: fullFor === "c:" + selected + mode,
    })
      .then((v) => {
        if (active) setDiff(v.text);
      })
      .catch((e) => {
        if (active) fail(e);
      });
    return () => {
      active = false;
    };
  }, [repo, selected, mode, tab, hideWhitespace, fullFor]);
  useEffect(() => {
    if (!ready || !splashFinished || error) return;
    const desktop = window as Window & {
      ipc?: { postMessage: (message: string) => void };
    };
    desktop.ipc?.postMessage(repo?.path ? "ready:repository" : "ready:welcome");
  }, [ready, splashFinished, error, repo?.path]);
  const repoPath = repo?.path;
  useEffect(() => {
    if (!repoPath || tab !== "history") return;
    let active = true;
    const timer = setTimeout(() => {
      api<{ commits: Commit[]; more: boolean }>("history", {
        repo: repoPath,
        query,
        author,
        since,
        file: historyFile,
        page,
      })
        .then((value) => {
          if (active) {
            setCommits(value.commits);
            setMore(value.more);
          }
        })
        .catch(fail)
        .finally(() => active && setHistoryLoaded(true));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [repoPath, tab, query, author, since, historyFile, page, historyRevision]);
  // GitHub status is optional decoration: checked once per repository, failures read as "not connected".
  useEffect(() => {
    if (!repoPath) return;
    let active = true;
    api<{ signedIn: boolean; repo: { error?: string } | null }>("gh_status", {
      repo: repoPath,
    })
      .then((v) => ({ signedIn: !!v.signedIn, connected: !!v.signedIn && !!v.repo && !v.repo.error }))
      .catch(() => ({ signedIn: false, connected: false }))
      .then((s) => active && setGithub({ path: repoPath, ...s }));
    return () => {
      active = false;
    };
  }, [repoPath]);
  const githubConnected =
    github && github.path === repoPath ? github.connected : null;
  // For you and the Inbox are about the account, so they only need sign-in, not a linked repository.
  const githubSignedIn = github && github.path === repoPath ? github.signedIn : null;
  const branchName = repo?.branch;
  // Protected branches on GitHub reject direct pushes, so Changes suggests a new branch up front.
  useEffect(() => {
    if (!repoPath || !githubConnected || !branchName || branchName === "Detached HEAD") return;
    let active = true;
    api<{ protected: boolean }>("gh_branch_protected", { repo: repoPath, branch: branchName })
      .then((v) => active && setProtectedBranch(v.protected ? repoPath + "\n" + branchName : ""))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [repoPath, githubConnected, branchName]);
  const changedFiles = repo?.files.map((f) => f.path).join("\n") ?? "";
  useEffect(() => {
    if (!repoPath || !changedFiles) return;
    let active = true;
    // shortcut: checks the first 200 changed files only; enough for normal commits.
    api<{ installed: boolean; lfs: string[]; large: string[] }>("lfs_info", { repo: repoPath, files: changedFiles.split("\n").slice(0, 200) })
      .then((v) => active && setLfs(v))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [repoPath, changedFiles]);
  useEffect(() => {
    document.documentElement.classList.toggle("sidebar-rail", rail);
    store("gitowl-sidebar", rail ? "rail" : "full");
  }, [rail]);
  useEffect(() => store("gitowl-editor", editor), [editor]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setRail((r) => !r);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const searchGitHub = useCallback((query: string) => api<SearchResult>("gh_search", { repo: repoPath, query }), [repoPath]);
  const openUrl = useCallback(
    (url: string) => {
      void api("open_in", { repo: repoPath, target: "url", url }).catch(fail);
    },
    [repoPath],
  );
  async function task(work: () => Promise<void>) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function mutate(op: string, data: object = {}) {
    setLastOp(op);
    return task(async () => {
      try {
        const value = await api<{ message: string }>(op, {
          repo: repo?.path,
          ...data,
        });
        setNotice(
          op === "unstage"
            ? "File removed from the next commit. Your working file is unchanged."
            : op === "stage"
              ? "File staged for the next commit."
              : value.message,
        );
        if (
          [
            "switch",
            "create_branch",
            "checkout_remote",
            "branch_rename",
            "branch_delete",
            "discard",
            "stash_pop",
            "rebase_continue",
            "rebase_abort",
            "pull",
            "gh_pr_checkout",
          ].includes(op)
        ) {
          setSelected("");
          setDiff("");
          setMode("working");
        }
        if (op === "stage") setMode("staged");
        if (op === "unstage") setMode("working");
        if (op === "commit") {
          setMessage("");
          setCoAuthors([]);
          setSelected("");
          setDiff("");
        }
      } finally {
        await refresh();
      }
    });
  }
  async function browseTo(path: string) {
    const value = await api<Browse>("browse", { path });
    setBrowse(value);
    setFolder(value.path);
  }
  async function viewCommit(id: string, file = historyFile, ignoreWhitespace = hideWhitespace, fullContext = false) {
    await task(async () => {
      const value = await api<{ text: string }>("commit_diff", {
        repo: repo?.path,
        id,
        file,
        ignoreWhitespace,
        fullContext,
      });
      setCommitId(id);
      setCommitFile(file);
      setFullFor(fullContext ? "h:" + id + file : "");
      setDiff(value.text);
    });
  }
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setOsDark(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function setTheme(next: Theme) {
    // Colours cross-fade briefly instead of flashing; reduced motion turns this off in CSS.
    document.documentElement.classList.add("theme-switching");
    window.setTimeout(() => document.documentElement.classList.remove("theme-switching"), 300);
    setThemeState(next);
    try {
      if (next === "system") localStorage.removeItem("gitowl-theme");
      else localStorage.setItem("gitowl-theme", next);
    } catch {
      // Storage can be unavailable; the choice still applies for this session.
    }
  }
  const dark = theme === "dark" || (theme === "system" && osDark);
  // The branch tip is the first row only when History is unfiltered and on page one.
  const isHeadCommit =
    !page && !query && !author && !historyFile && !since && commits[0]?.id === commitId;
  // Reordering only makes sense on the plain, unfiltered newest-first list.
  const reorderable = !page && !query && !author && !historyFile && !since;
  // Drag and Alt+arrows open the rebase plan pre-arranged; its preview and recovery point still apply.
  function arrangeCommits(move: string, onto: string, mode: Arrange["mode"]) {
    const older = commits.findIndex((c) => c.id === move) > commits.findIndex((c) => c.id === onto) ? move : onto;
    setPlanArrange({ move, onto, mode });
    setPlanTarget(older);
  }
  // Blame needs one file: the File path filter, or that file's earlier name in the selected commit.
  const blameFile = historyFile && (commitFile || historyFile);
  const clearCommit = () => {
    setCommitId("");
    setDiff("");
    setHistoryRevision((v) => v + 1);
  };
  function goTo(next: Tab) {
    setTab(next);
    setDiff("");
    setCommitId("");
  }
  const pushBlocked =
    !repo ||
    busy ||
    repo.branch === "Detached HEAD" ||
    repo.merging ||
    repo.rebasing;
  // A repository with no remote at all is published to GitHub first; otherwise push or publish the branch.
  const push = () =>
    !repo?.remoteNames.length ? setPublishingRepo(true) : repo.upstream ? void mutate("push") : setPublishing(true);
  const pushLabel = !repo?.remoteNames.length ? "Publish to GitHub" : repo.upstream ? "Push" : "Publish branch";
  const staged = repo?.files.filter((f) => f.staged).length || 0;
  const conflicted = repo?.files.some((f) => f.conflict) || false;
  const pages: [Tab, string][] = [
    ["overview", "Overview"],
    ["changes", "Changes"],
    ["history", "History"],
    ["branches", "Branches & tags"],
    ["github", "GitHub"],
    ["settings", "Settings"],
    ["repository", "Repository settings"],
  ];
  const commands: Command[] = repo
    ? [
        ...(pushBlocked ? [] : [{ id: "push", group: "Git", label: pushLabel, hint: repo.branch, run: push }]),
        ...(busy ? [] : [{ id: "fetch", group: "Git", label: "Fetch", hint: "update remote branches", keys: "Ctrl ⇧ F", run: () => void mutate("fetch") }]),
        ...(busy || !repo.upstream ? [] : [{ id: "pull", group: "Git", label: "Pull…", hint: "choose a strategy", run: () => setPulling(true) }]),
        ...(busy ? [] : [{ id: "stash", group: "Git", label: "Stash…", run: () => setStashing(true) }]),
        ...pages.map(([key, label], i) => ({ id: "go-" + key, group: "Go to", label, keys: "Ctrl " + (i + 1), run: () => goTo(key) })),
        ...(busy ? [] : [{ id: "open", group: "Go to", label: "Open another folder…", run: () => void task(() => browseTo(repo.path)) }]),
        { id: "open-editor", group: "Open", label: "Open in " + (editor === "code" ? "VS Code" : editor === "zed" ? "Zed" : "editor"), hint: repo.name, run: () => void mutate("open_in", { target: "editor", editor }) },
        { id: "open-folder", group: "Open", label: "Open in file manager", hint: repo.name, run: () => void mutate("open_in", { target: "folder" }) },
        { id: "open-terminal", group: "Open", label: "Open in terminal", hint: repo.name, run: () => void mutate("open_in", { target: "terminal" }) },
        ...(githubConnected
          ? [
              { id: "open-gh-repo", group: "Open", label: "Open repository on GitHub", hint: repo.name, run: () => void mutate("gh_browse") },
              { id: "open-gh-branch", group: "Open", label: "Open branch on GitHub", hint: repo.branch, run: () => void mutate("gh_browse", { branch: repo.branch }) },
            ]
          : []),
        ...recent
          .filter((p) => p !== repo.path)
          .slice(0, 5)
          .map((p) => ({ id: "recent-" + p, group: "Projects", label: p.split(/[\\/]/).pop() || p, hint: p, run: () => void task(() => openRepo(p)) })),
        { id: "theme-light", group: "Appearance", label: "Light appearance", run: () => setTheme("light") },
        { id: "theme-dark", group: "Appearance", label: "Dark appearance", run: () => setTheme("dark") },
        { id: "theme-system", group: "Appearance", label: "Match system appearance", run: () => setTheme("system") },
        { id: "shortcuts", group: "Appearance", label: "Keyboard shortcuts", run: () => setShortcuts(true) },
      ]
    : [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skipped while typing or in a dialog, so fields and dialogs keep their own keys.
      if (!ready || !splashFinished || !repo || document.querySelector("dialog[open]")) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const n = Number(e.key);
      if (ctrl && n >= 1 && n <= pages.length) {
        e.preventDefault();
        goTo(pages[n - 1][0]);
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (!busy) void mutate("fetch");
      } else if (!ctrl && !e.altKey && !e.shiftKey && tab === "changes" && (e.key === "j" || e.key === "k")) {
        const at = repo.files.findIndex((f) => f.path === selected);
        const next = repo.files[Math.max(0, Math.min(repo.files.length - 1, at + (e.key === "j" ? 1 : -1)))];
        if (next) {
          setSelected(next.path);
          setMode(next.staged ? "staged" : "working");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const recentMatches = recent.filter((path) =>
    path.toLowerCase().includes(recentFilter.trim().toLowerCase()),
  );
  if (!ready || !splashFinished) return <WorkspaceSplash dark={dark} />;
  return (
    <div className={repo ? "app" : "app welcome"}>
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      {repo && (
        <Sidebar
          repo={repo}
          tab={tab}
          busy={busy}
          github={githubSignedIn}
          recent={recent}
          unread={githubSignedIn ? unread : 0}
          theme={theme}
          dark={dark}
          onTab={goTo}
          onSearch={() => setPalette(true)}
          onOpenRecent={(path) => void task(() => openRepo(path))}
          onSwitchProject={() => void task(() => browseTo(repo.path))}
          onTheme={setTheme}
          rail={rail}
          onRail={setRail}
        />
      )}
      {palette && repo && (
        <CommandPalette
          commands={commands}
          onClose={() => setPalette(false)}
          search={githubConnected ? searchGitHub : undefined}
          onOpenUrl={openUrl}
        />
      )}
      <main id="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span aria-hidden="true">/</span>
            <strong>{repo?.name || "Welcome"}</strong>
          </div>
          <div className="top-actions">
            <span className={busy ? "activity" : "visually-hidden"} role="status">
              {busy ? "Working…" : notice}
            </span>
            {repo && (
              <>
                <button disabled={busy} onClick={() => void mutate("fetch")}>
                  <Icon name="down" /> Fetch
                </button>
                <button
                  disabled={
                    busy ||
                    !repo.upstream ||
                    repo.merging ||
                    repo.rebasing
                  }
                  title={
                    repo.merging || repo.rebasing
                      ? "Finish or abort the current operation first"
                      : repo.upstream
                        ? "Pull from " +
                          repo.upstream +
                          " with a chosen strategy"
                        : "Publish this branch or check out a remote branch to set an upstream"
                  }
                  onClick={() => {
                    setError("");
                    setPulling(true);
                  }}
                >
                  <Icon name="down" /> Pull
                </button>
                <button
                  className="primary"
                  disabled={pushBlocked}
                  onClick={push}
                >
                  {pushLabel}
                </button>
              </>
            )}
          </div>
        </header>
        <div className="toast-notification-container" role="region" aria-label="Notifications">
          <Toast
            kind="error"
            text={error}
            onDismiss={dismissError}
            action={
              lastOp === "push" && /\[rejected\]|non-fast-forward|stale info/.test(error) && repo?.upstream ? (
                <button className="destructive-text" onClick={() => setForcing(true)}>
                  Force push…
                </button>
              ) : undefined
            }
          />
          <Toast kind="success" text={notice} onDismiss={dismissNotice} />
        </div>
        {!repo ? (
          <section className="welcome-card" aria-label="Welcome to gitowl">
            <div className="welcome-main">
              <h1 className="welcome-lockup">
                <img src={dark ? "/gitowl-lockup-on-dark.svg" : "/gitowl-lockup.svg"} alt="gitowl" width="300" height="110" />
              </h1>
              <p>Welcome · Version 0.1.0 alpha · Your Git and GitHub workspace</p>
              <div className="action-list">
                <button disabled={busy} onClick={() => void task(() => browseTo(home))}>
                  <span className="action-icon">
                    <Icon name="folder" />
                  </span>
                  <span className="action-text">
                    <strong>Open Folder…</strong>
                    <small>A repository or any folder inside it</small>
                  </span>
                  <svg className="icon chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setCloning(true);
                  }}
                >
                  <span className="action-icon">
                    <Icon name="cloud" />
                  </span>
                  <span className="action-text">
                    <strong>Clone from GitHub…</strong>
                    <small>Pick from your account’s repositories</small>
                  </span>
                  <svg className="icon chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setCreatingRepo(true);
                  }}
                >
                  <span className="action-icon">
                    <Icon name="changes" />
                  </span>
                  <span className="action-text">
                    <strong>New Repository…</strong>
                    <small>Start a project with a README, .gitignore and license</small>
                  </span>
                  <svg className="icon chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              </div>
              <p className="startup-hint">
                Tip: run <code>gitowl</code> in any repository folder.
              </p>
            </div>
            <section className="welcome-recent" aria-label="Recent projects">
              <div className="search-field">
                <svg className="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
                </svg>
                <input
                  type="search"
                  aria-label="Search recent projects"
                  placeholder="Search"
                  value={recentFilter}
                  onChange={(e) => setRecentFilter(e.target.value)}
                />
              </div>
              <h2 className="side-label">Recent</h2>
              {!recentMatches.length ? (
                <p className="hint recent-empty">
                  {recent.length
                    ? "No recent projects match your search."
                    : "Projects you open appear here."}
                </p>
              ) : (
                <ul className="recent stagger">
                  {recentMatches.map((path, i) => {
                    const project = path.split(/[\\/]/).pop() || path;
                    return (
                      <li
                        key={path}
                        style={{ "--i": Math.min(i, 8) } as CSSProperties}
                      >
                        <button
                          className="recent-open"
                          disabled={busy}
                          onClick={() => void task(() => openRepo(path))}
                        >
                          <span
                            className={"project-tile tone-" + (i % 4)}
                            aria-hidden="true"
                          >
                            {project[0]?.toUpperCase()}
                          </span>
                          <span className="recent-text">
                            <strong>{project}</strong>
                            <small>{path}</small>
                          </span>
                        </button>
                        <button
                          className="forget"
                          aria-label={"Remove " + path + " from recent projects"}
                          disabled={busy}
                          onClick={() =>
                            void task(async () => {
                              const value = await api<{ recent: string[] }>(
                                "recent_forget",
                                { path },
                              );
                              setRecent(value.recent);
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </section>
        ) : (
          <div className="screen" key={tab}>
            {tab !== "overview" && (
            <div className="project-header">
              <div>
                <h1>
                  {tab === "changes"
                    ? "Working changes"
                    : tab === "history"
                      ? "Commit history"
                      : tab === "branches"
                        ? "Branches & tags"
                        : tab === "github"
                          ? "GitHub"
                          : tab === "repository"
                            ? "Repository settings"
                            : "Settings"}
                </h1>
              </div>
              {/* Page-level controls (the GitHub sections) render here through a portal. */}
              <div ref={setHeaderSlot} className="header-slot" />
            </div>
            )}
            {(repo.merging || repo.rebasing) && (
              <div className="operation-banner" role="status">
                <div>
                  <strong>
                    {repo.rebasing ? "Rebase in progress" : "Merge in progress"}
                  </strong>
                  <p>
                    {conflicted
                      ? "Resolve the conflicted files in Changes, then stage the results."
                      : repo.rebasing
                        ? "Stage any remaining changes, then continue the rebase."
                        : "Finish the merge commit in Changes, or abort to return to the previous state."}
                  </p>
                </div>
                <div className="button-row">
                  {repo.rebasing ? (
                    <button
                      className="primary"
                      disabled={busy || conflicted}
                      title={
                        conflicted
                          ? "Resolve and stage all conflicted files first"
                          : "Continue the rebase after staging resolved files"
                      }
                      onClick={() => void mutate("rebase_continue")}
                    >
                      Continue rebase
                    </button>
                  ) : (
                    tab !== "changes" && (
                      <button onClick={() => setTab("changes")}>
                        Review merge in Changes
                      </button>
                    )
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setAbortOperation(repo.rebasing ? "rebase" : "merge");
                    }}
                  >
                    Abort {repo.rebasing ? "rebase" : "merge"}…
                  </button>
                </div>
              </div>
            )}
            {tab === "changes" && protectedBranch === repo.path + "\n" + repo.branch && (
              <div className="note info protected-note" role="status">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <span>
                  <strong>{repo.branch} is protected on GitHub.</strong> Direct pushes need a pull request. Commit on a new branch instead?
                </span>
                <button className="primary small" disabled={busy} onClick={() => setNewBranch(true)}>
                  Create branch
                </button>
              </div>
            )}
            {tab === "changes" && (
              <div className="changes-layout">
                <section className="file-panel">
                  <div className="panel-heading">
                    <strong role="heading" aria-level={2}>
                      Changed files
                    </strong>
                    <span className="count">{repo.files.length}</span>
                  </div>
                  <p className="panel-help">
                    Check a file to include its current changes.
                  </p>
                  <div
                    className="file-toolbar"
                    role="group"
                    aria-label="File actions"
                  >
                    <button
                      disabled={busy || !repo.files.length || conflicted}
                      onClick={() => void mutate("stage_all")}
                    >
                      Stage all
                    </button>
                    <button
                      disabled={busy || !staged || conflicted}
                      onClick={() => void mutate("unstage_all")}
                    >
                      Unstage all
                    </button>
                    <button
                      disabled={
                        busy ||
                        !repo.files.length ||
                        repo.merging ||
                        repo.rebasing
                      }
                      onClick={() => {
                        setError("");
                        setStashing(true);
                      }}
                    >
                      Stash…
                    </button>
                  </div>
                  <div className="file-list">
                    {repo.files.map((file) => (
                      <div
                        key={file.path}
                        className={
                          "file-row " +
                          (selected === file.path ? "selected" : "")
                        }
                      >
                        <input
                          aria-label={"Stage " + file.path}
                          type="checkbox"
                          disabled={busy || file.conflict}
                          checked={file.staged}
                          onChange={() =>
                            void mutate(file.staged ? "unstage" : "stage", {
                              file: file.path,
                            })
                          }
                        />
                        <button
                          aria-current={selected === file.path ? "true" : undefined}
                          onClick={() => {
                            setSelected(file.path);
                            setMode(file.staged ? "staged" : "working");
                          }}
                          title={file.path}
                        >
                          {(() => {
                            const letter = file.conflict
                              ? "!"
                              : file.code === "??"
                                ? "A"
                                : file.code.trim()[0];
                            return (
                              <span className="status-letter" data-code={letter}>
                                {letter}
                              </span>
                            );
                          })()}
                          <span>{file.path}</span>
                          {lfs.lfs.includes(file.path) && <span className="tag-lfs">LFS</span>}
                          {file.staged && file.unstaged && (
                            <small>+ edits</small>
                          )}
                        </button>
                        {(file.unstaged || file.code === "??") &&
                          !file.conflict && (
                            <button
                              type="button"
                              className="row-discard"
                              disabled={busy}
                              aria-label={"Discard changes in " + file.path}
                              title={"Discard changes in " + file.path}
                              onClick={() => {
                                setError("");
                                setDiscardTarget(file);
                              }}
                            >
                              Discard
                            </button>
                          )}
                      </div>
                    ))}
                    {repo.files.some((f) => f.code === "??") && (
                      <div className="file-row untracked-row">
                        <span className="hint">
                          {repo.files.filter((f) => f.code === "??").length} untracked file
                          {repo.files.filter((f) => f.code === "??").length === 1 ? "" : "s"}
                        </span>
                        <button className="small" disabled={busy} onClick={() => setCleaning(true)}>
                          Clean…
                        </button>
                      </div>
                    )}
                    {!repo.files.length && (
                      <div className="empty compact">
                        <Icon name="check" />
                        <h3>Working tree clean</h3>
                        <p>Your changes are committed.</p>
                      </div>
                    )}
                  </div>
                  {lfs.large.map((file) => (
                    <div key={file} className="note info lfs-note">
                      <span>
                        <code>{file}</code> is over 50 MB. {lfs.installed ? "Store it with Git LFS so the repository stays small?" : "Install Git LFS to store large files outside the repository."}
                      </span>
                      {lfs.installed && (
                        <button className="small" disabled={busy} onClick={() => void mutate("lfs_track", { file })}>
                          Track with LFS
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="commit-form">
                    <label htmlFor="commit-message">Commit message</label>
                    <textarea
                      id="commit-message"
                      placeholder="What changed, and why?"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => {
                        // Ctrl+Enter presses Commit, so its disabled state still decides.
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") document.getElementById("commit-button")?.click();
                      }}
                    />
                    <CoAuthors value={coAuthors} onChange={setCoAuthors} busy={busy} />
                    <div className="commit-summary">
                      <span>{staged} staged files</span>
                      <span>{repo.identity.name || "Set your identity"}</span>
                    </div>
                    <button
                      id="commit-button"
                      className="primary full"
                      disabled={
                        busy ||
                        repo.rebasing ||
                        (!staged && !repo.merging) ||
                        !message.trim() ||
                        conflicted
                      }
                      onClick={() =>
                        void mutate("commit", {
                          message,
                          fingerprint: repo.fingerprint,
                          coAuthors,
                        })
                      }
                    >
                      {repo.rebasing
                        ? "Finish the rebase first"
                        : repo.merging
                          ? "Finish merge commit"
                          : `Commit ${staged} file${staged === 1 ? "" : "s"} to ${repo.branch}`}
                    </button>
                    <p className="hint">
                      Unselected edits stay here for later.
                    </p>
                  </div>
                </section>
                <section className="diff-panel">
                  <div className="panel-heading">
                    <strong role="heading" aria-level={2}>
                      {selected ? <code>{selected}</code> : "Change preview"}
                    </strong>
                    {selected && (
                      <select
                        aria-label="Diff comparison"
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="staged">Staged · next commit</option>
                        <option value="working">
                          Unstaged · additional edits
                        </option>
                        <option value="head">
                          All changes · latest commit
                        </option>
                      </select>
                    )}
                  </div>
                  {selected && (
                    <div className="diff-toolbar">
                      <span className="hint">
                        Green: additions · Red: removals
                      </span>
                      <div className="toolbar-actions">
                        <button
                          onClick={() => {
                            setHistoryFile(selected);
                            setTab("history");
                            setPage(0);
                            setDiff("");
                          }}
                        >
                          File history
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void mutate("stage", { file: selected })
                          }
                        >
                          Stage latest edits
                        </button>
                        {githubConnected && !repo.files.some((f) => f.path === selected && f.code === "??") && (
                          <button disabled={busy} title={`Opens ${selected} on ${repo.branch} at GitHub`} onClick={() => void mutate("gh_browse", { path: selected, branch: repo.branch })}>
                            Open on GitHub
                          </button>
                        )}
                        {!isImage(selected) && (
                          <button disabled={busy} onClick={() => void mutate("difftool", { file: selected, mode })}>
                            Open in diff tool
                          </button>
                        )}
                        {repo.files.find((f) => f.path === selected)
                          ?.conflict && (
                          <button
                            className="primary"
                            onClick={() =>
                              void task(async () => {
                                const value = await api<Conflict>(
                                  "conflict_read",
                                  { repo: repo.path, file: selected },
                                );
                                setConflict({ ...value, file: selected });
                                setResolution(value.result);
                              })
                            }
                          >
                            Resolve conflict
                          </button>
                        )}
                        {repo.files.find((f) => f.path === selected)
                          ?.conflict && (
                          <>
                            <button onClick={() => setTakeSide("ours")}>
                              Take side 2…
                            </button>
                            <button onClick={() => setTakeSide("theirs")}>
                              Take side 3…
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {selected && isImage(selected) ? (
                    <ImageDiff repo={repo.path} file={selected} mode={mode} busy={busy} action={mutate} />
                  ) : (
                  <Diff
                    text={diff}
                    options={{
                      hideWhitespace,
                      fullContext: fullFor === "c:" + selected + mode,
                      set: (next) => {
                        if (next.hideWhitespace !== undefined) setHideWhitespace(next.hideWhitespace);
                        if (next.fullContext !== undefined) setFullFor(next.fullContext ? "c:" + selected + mode : "");
                      },
                    }}
                    hunkAction={
                      hideWhitespace || fullFor === "c:" + selected + mode
                        ? undefined
                        : mode === "staged"
                        ? "Unstage hunk"
                        : mode === "working" &&
                            repo.files.some(
                              (f) =>
                                f.path === selected &&
                                f.code !== "??" &&
                                !f.conflict,
                            )
                          ? "Stage hunk"
                          : undefined
                    }
                    onHunk={(index, lines) =>
                      void mutate("hunk", {
                        file: selected,
                        mode,
                        index,
                        lines,
                        previous: diff,
                      })
                    }
                  />
                  )}
                </section>
              </div>
            )}
            {tab === "history" && (
              <div className="history-area">
                <div className="filters">
                  <input
                    placeholder="Search commit messages…"
                    aria-label="Search commit messages"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                  />
                  <input
                    placeholder="Author"
                    aria-label="Filter author"
                    value={author}
                    onChange={(e) => {
                      setAuthor(e.target.value);
                      setPage(0);
                    }}
                  />
                  <input
                    placeholder="File path"
                    aria-label="Filter file"
                    value={historyFile}
                    onChange={(e) => {
                      setHistoryFile(e.target.value);
                      setPage(0);
                    }}
                  />
                  <label className="date-filter">
                    Since
                    <input
                      type="date"
                      value={since}
                      onChange={(e) => {
                        setSince(e.target.value);
                        setPage(0);
                      }}
                    />
                  </label>
                </div>
                <div className="history-layout">
                  <section
                    className="commit-list stagger"
                    aria-busy={!historyLoaded}
                  >
                    {!historyLoaded &&
                      [0, 1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="commit-row" aria-hidden="true">
                          <span className="commit-node" />
                          <div className="skeleton-stack">
                            <span className="skeleton skeleton-line" />
                            <span className="skeleton skeleton-line short" />
                          </div>
                        </div>
                      ))}
                    {historyLoaded && commits.map((commit, i) => (
                      <button
                        style={{ "--i": Math.min(i, 8) } as CSSProperties}
                        aria-current={commitId === commit.id ? "true" : undefined}
                        aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                        className={
                          "commit-row " +
                          (commitId === commit.id ? "selected" : "") +
                          (dropHint?.id === commit.id ? " drop-" + dropHint.mode : "") +
                          (dragId === commit.id ? " dragging" : "")
                        }
                        key={commit.id}
                        draggable={reorderable}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(commit.id);
                        }}
                        onDragEnd={() => {
                          setDragId("");
                          setDropHint(null);
                        }}
                        onDragOver={(e) => {
                          if (!dragId || dragId === commit.id) return;
                          e.preventDefault();
                          const box = e.currentTarget.getBoundingClientRect();
                          const y = (e.clientY - box.top) / box.height;
                          // Top quarter: above (newer). Bottom quarter: below (older). Middle: squash into it.
                          const mode = y < 0.25 ? "newer" : y > 0.75 ? "older" : "squash";
                          if (dropHint?.id !== commit.id || dropHint.mode !== mode) setDropHint({ id: commit.id, mode });
                        }}
                        onDragLeave={() => dropHint?.id === commit.id && setDropHint(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragId && dropHint) arrangeCommits(dragId, commit.id, dropHint.mode);
                          setDragId("");
                          setDropHint(null);
                        }}
                        onKeyDown={(e) => {
                          if (!reorderable || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                          const neighbour = commits[i + (e.key === "ArrowUp" ? -1 : 1)];
                          if (!neighbour) return;
                          e.preventDefault();
                          arrangeCommits(commit.id, neighbour.id, e.key === "ArrowUp" ? "newer" : "older");
                        }}
                        onClick={() =>
                          void viewCommit(commit.id, commit.path || historyFile)
                        }
                      >
                        {reorderable && (
                          <span className="commit-grip" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="9" cy="6" r="1.6" />
                              <circle cx="15" cy="6" r="1.6" />
                              <circle cx="9" cy="12" r="1.6" />
                              <circle cx="15" cy="12" r="1.6" />
                              <circle cx="9" cy="18" r="1.6" />
                              <circle cx="15" cy="18" r="1.6" />
                            </svg>
                          </span>
                        )}
                        <span className="commit-node" />
                        <div>
                          <strong>{commit.message}</strong>
                          <p>
                            {commit.author} ·{" "}
                            {new Date(
                              Number(commit.time) * 1000,
                            ).toLocaleDateString()}
                          </p>
                          <code>{commit.id.slice(0, 8)}</code>
                          {(commit.signature === "G" || commit.signature === "U") && (
                            <span className="verified" title={commit.signature === "U" ? "Good signature from a key you have not marked as trusted" : "Signature verified"}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
                                <path d="M5 12l5 5L20 7" />
                              </svg>
                              Verified
                            </span>
                          )}
                          {commit.path && commit.path !== historyFile && (
                            <small> · as {commit.path}</small>
                          )}
                        </div>
                      </button>
                    ))}
                    {reorderable && commits.length > 1 && (
                      <p className="hint commit-reorder-hint">
                        Drag a commit to reorder; drop it on another to squash. Keyboard: Alt ↑/↓ moves the focused commit. You see a preview, and a recovery point is saved first.
                      </p>
                    )}
                    {historyLoaded && !commits.length && (
                      <div className="empty compact">
                        <h3>No matching commits</h3>
                        <p>Change the filters, or make your first commit.</p>
                      </div>
                    )}
                    {(page > 0 || more) && (
                      <div className="pagination">
                        <button
                          disabled={!page}
                          onClick={() => setPage(page - 1)}
                        >
                          Previous
                        </button>
                        <span>Page {page + 1}</span>
                        <button
                          disabled={!more}
                          onClick={() => setPage(page + 1)}
                        >
                          Next
                        </button>
                      </div>
                    )}
                    <form
                      className="inline-form hash-search"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void viewCommit(
                          String(new FormData(e.currentTarget).get("hash")),
                        );
                      }}
                    >
                      <input
                        name="hash"
                        placeholder="Jump to commit hash…"
                        aria-label="Commit hash"
                      />
                      <button>Go</button>
                    </form>
                  </section>
                  <section className="diff-panel">
                    <div className="panel-heading">
                      <strong role="heading" aria-level={2}>
                        {commitId ? <code>{commitId.slice(0, 12)}</code> : "Commit details"}
                      </strong>
                      <div className="button-row">
                        {commitId && (
                          <>
                            {isHeadCommit ? (
                              <button
                                disabled={busy}
                                title="Keeps the changes staged; a recovery point is saved"
                                onClick={() => void mutate("undo_commit").then(clearCommit)}
                              >
                                Undo commit
                              </button>
                            ) : (
                              <button
                                disabled={busy}
                                onClick={() => void mutate("cherry_pick", { id: commitId }).then(clearCommit)}
                              >
                                Cherry-pick onto {repo.branch}
                              </button>
                            )}
                            <button
                              disabled={busy}
                              title="Adds a new commit that undoes this one"
                              onClick={() => void mutate("revert", { id: commitId }).then(clearCommit)}
                            >
                              Revert
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => setEditTarget(commitId)}
                            >
                              Edit this commit…
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => setPlanTarget(commitId)}
                            >
                              Rewrite from here…
                            </button>
                            {!isHeadCommit && (
                              <button disabled={busy} title="Move the branch back to this commit; a recovery point is saved first" onClick={() => setResetTarget(commitId)}>
                                Reset to here…
                              </button>
                            )}
                            {githubConnected && (
                              <button disabled={busy} onClick={() => void mutate("gh_browse", { commit: commitId })}>
                                Open on GitHub
                              </button>
                            )}
                          </>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => setEditingCommit(true)}
                        >
                          Edit latest commit…
                        </button>
                      </div>
                    </div>
                    {blameFile && (
                      <div className="diff-toolbar">
                        <strong>
                          <code>{blameFile}</code>
                        </strong>
                        <Segmented
                          className="diff-mode"
                          label="File view"
                          value={blame ? "blame" : "diff"}
                          options={[
                            ["diff", "Diff"],
                            ["blame", "Blame"],
                          ]}
                          onChange={(v) => setBlame(v === "blame")}
                        />
                      </div>
                    )}
                    {blameFile && blame ? (
                      <Blame
                        repo={repo.path}
                        file={blameFile}
                        id={commitId}
                        onOpen={(id) => {
                          setBlame(false);
                          void viewCommit(id, blameFile);
                        }}
                      />
                    ) : (
                      <Diff
                        text={diff}
                        options={
                          commitId
                            ? {
                                hideWhitespace,
                                fullContext: fullFor === "h:" + commitId + commitFile,
                                set: (next) => {
                                  const ws = next.hideWhitespace ?? hideWhitespace;
                                  setHideWhitespace(ws);
                                  void viewCommit(commitId, commitFile, ws, next.fullContext ?? fullFor === "h:" + commitId + commitFile);
                                },
                              }
                            : undefined
                        }
                      />
                    )}
                    <Reflog key={repo.path} repo={repo.path} busy={busy} action={mutate} />
                  </section>
                </div>
              </div>
            )}
            {tab === "branches" && (
              <BranchPanel
                key={repo.path}
                repo={repo}
                busy={busy}
                action={mutate}
                operationError={error}
              />
            )}
            {tab === "github" && (
              <GitHubPanel
                key={repo.path}
                repo={repo}
                headerSlot={headerSlot}
                busy={busy}
                action={mutate}
              />
            )}
            {tab === "repository" && (
              <RepositorySettings
                key={repo.path}
                repo={repo.path}
                connected={githubConnected}
                busy={busy}
                action={mutate}
                onConnect={() => goTo("github")}
                headerSlot={headerSlot}
              />
            )}
            {tab === "settings" && (
              <div className="settings-layout">
                <nav className="settings-nav" aria-label="Settings sections">
                  {(
                    [
                      ["App", [["general", "General"], ["accounts", "Accounts & signing"]]],
                      [
                        "This repository",
                        [
                          ["commits", "Commits & remotes"],
                          ["recovery", "Recovery & packages"],
                          ["secrets", "Secrets & variables"],
                          ["repository", "Repository & danger zone"],
                        ],
                      ],
                    ] as [string, [SettingsPane, string][]][]
                  ).map(([group, panes]) => (
                    <Fragment key={group}>
                      <p>{group}</p>
                      {panes.map(([key, label]) => (
                        <button key={key} aria-current={settingsPane === key ? "true" : undefined} onClick={() => setSettingsPane(key)}>
                          {label}
                        </button>
                      ))}
                    </Fragment>
                  ))}
                </nav>
                <div className="settings-pane" key={settingsPane}>
                {settingsPane === "general" && (
                  <>
                    <section>
                      <h2>Appearance</h2>
                      <div className="settings-group">
                        <div className="settings-row">
                          <span>
                            Theme<small>System follows Windows' light or dark setting.</small>
                          </span>
                          <Segmented
                            label="Theme"
                            value={theme}
                            options={[
                              ["system", "System"],
                              ["light", "Light"],
                              ["dark", "Dark"],
                            ]}
                            onChange={setTheme}
                          />
                        </div>
                      </div>
                    </section>
                    <GeneralExtras repo={repo.path} rail={rail} onRail={setRail} editor={editor} onEditor={setEditor} />
                    <section>
                      <h2>Keyboard shortcuts</h2>
                      <div className="settings-group">
                        <div className="settings-row">
                          <span>View every shortcut and when it works</span>
                          <button onClick={() => setShortcuts(true)}>Open list</button>
                        </div>
                      </div>
                    </section>
                    <UpdatePanel busy={busy} run={task} />
                  </>
                )}
                {settingsPane === "commits" && (
                  <>
                <section>
                  <h2>Commit identity</h2>
                  <div className="settings-group">
                    <div className="settings-row">
                      <label htmlFor="identity-name">Name</label>
                      <input id="identity-name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="settings-row">
                      <label htmlFor="identity-email">Email</label>
                      <input id="identity-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <div className="settings-row">
                      <span>
                        <small>For future commits in this repository. GitHub sign-in and existing commits don't change.</small>
                      </span>
                      <button className="primary" disabled={busy} onClick={() => void mutate("identity", { name, email })}>
                        Save
                      </button>
                    </div>
                  </div>
                </section>
                <section className="settings-card">
                  <RemotePanel
                    repo={repo}
                    busy={busy}
                    action={mutate}
                    operationError={error}
                  />
                </section>
                <section className="settings-card">
                  <h2>Ignored files</h2>
                  <p>
                    Edit .gitignore. Patterns do not automatically untrack files
                    already in Git.
                  </p>
                  {ignore === null ? (
                    <button
                      onClick={() =>
                        void task(async () => {
                          const value = await api<{ text: string }>(
                            "ignore_read",
                            { repo: repo.path },
                          );
                          setIgnore(value.text);
                          setOldIgnore(value.text);
                        })
                      }
                    >
                      Open .gitignore
                    </button>
                  ) : (
                    <>
                      <textarea
                        className="ignore-editor"
                        aria-label="Gitignore contents"
                        value={ignore}
                        onChange={(e) => setIgnore(e.target.value)}
                      />
                      <button
                        disabled={busy}
                        onClick={() =>
                          void task(async () => {
                            const result = await api<{ message: string }>(
                              "ignore_save",
                              {
                                repo: repo.path,
                                content: ignore,
                                previous: oldIgnore,
                              },
                            );
                            setOldIgnore(ignore);
                            setNotice(result.message);
                            await refresh();
                          })
                        }
                      >
                        Save .gitignore
                      </button>
                    </>
                  )}
                </section>
                  </>
                )}
                {settingsPane === "accounts" && <AccountsPane key={repo.path} repo={repo.path} busy={busy} action={mutate} />}
                {settingsPane === "secrets" &&
                  (githubConnected ? <SecretsPane key={repo.path} repo={repo.path} busy={busy} action={mutate} /> : <p className="hint">Secrets and variables need a GitHub remote and sign-in; connect on the GitHub page.</p>)}
                {settingsPane === "repository" &&
                  (githubConnected ? <RepoPane key={repo.path} repo={repo.path} busy={busy} action={mutate} /> : <p className="hint">Repository settings need a GitHub remote and sign-in; connect on the GitHub page.</p>)}
                {settingsPane === "recovery" && (
                  <>
                    <RecoveryPanel key={repo.path} repo={repo.path} busy={busy} action={mutate} />
                    <PackagePanel key={"pkg" + repo.path} repo={repo.path} busy={busy} run={task} />
                  </>
                )}
                </div>
              </div>
            )}
            {tab === "overview" && (
              <Overview
                repo={repo}
                github={githubConnected}
                signedIn={!!githubSignedIn}
                pushBlocked={pushBlocked}
                onPush={push}
                onNavigate={goTo}
                onMutate={mutate}
                onError={fail}
                onUnread={setUnread}
              />
            )}
          </div>
        )}
        <footer className="statusbar">
          {repo ? (
            <>
              <button className="status-branch" popoverTarget="branch-popover" aria-label={`Branch details: ${repo.branch}`}>
                <i className="online" />
                {repo.branch + " · " + repo.files.length + " changed files"}
              </button>
              <div id="branch-popover" popover="auto" className="branch-popover" role="dialog" aria-label="Branch details">
                <strong>{repo.branch}</strong>
                <span>
                  {repo.upstream
                    ? `Tracking ${repo.upstream}` +
                      (repo.counts ? ` · ${repo.counts.split("\t")[0]} ahead, ${repo.counts.split("\t")[1] ?? 0} behind` : "")
                    : "Not published yet"}
                </span>
                <span>{repo.files.length} changed files</span>
                <div className="branch-popover-actions">
                  <button className="primary" popoverTarget="branch-popover" popoverTargetAction="hide" onClick={() => goTo("changes")}>
                    Changes
                  </button>
                  <button popoverTarget="branch-popover" popoverTargetAction="hide" onClick={() => goTo("branches")}>
                    Branches & tags
                  </button>
                </div>
              </div>
            </>
          ) : (
            <span>
              <i className="online" />
              Ready when you are
            </span>
          )}
          {repo?.upstream && repo.counts && (
            <span>
              {repo.counts.split("\t")[0]} ahead · {repo.counts.split("\t")[1] ?? 0} behind {repo.upstream}
            </span>
          )}
        </footer>
      </main>
      {editingCommit && repo && (
        <CommitEditDialog
          key={repo.path}
          repo={repo.path}
          busy={busy}
          run={task}
          onClose={() => setEditingCommit(false)}
          onUpdated={async () => {
            setCommitId("");
            setDiff("");
            setHistoryRevision((v) => v + 1);
            await refresh();
          }}
        />
      )}
      {editTarget && repo && (
        <CommitEditDialog
          key={repo.path + editTarget}
          repo={repo.path}
          commit={editTarget}
          busy={busy}
          run={task}
          onClose={() => setEditTarget("")}
          onUpdated={async () => {
            setCommitId("");
            setDiff("");
            setHistoryRevision((v) => v + 1);
            await refresh();
          }}
        />
      )}
      {planTarget && repo && (
        <RebasePlanDialog
          key={repo.path + planTarget}
          repo={repo.path}
          commit={planTarget}
          initial={planArrange}
          busy={busy}
          run={task}
          onClose={() => {
            setPlanTarget("");
            setPlanArrange(undefined);
          }}
          onUpdated={async () => {
            setCommitId("");
            setDiff("");
            setHistoryRevision((v) => v + 1);
            await refresh();
          }}
        />
      )}
      {creatingRepo && (
        <NewRepoDialog
          home={home}
          busy={busy}
          onClose={() => setCreatingRepo(false)}
          onCreate={(form) =>
            void task(async () => {
              const made = await api<{ path: string; message: string }>("init_repo", form);
              setCreatingRepo(false);
              await openRepo(made.path);
              setNotice(made.message);
            })
          }
        />
      )}
      {publishingRepo && repo && (
        <PublishRepoDialog
          repo={repo}
          busy={busy}
          onClose={() => setPublishingRepo(false)}
          onPublish={(form) => void mutate("gh_publish", form).then((ok) => ok && setPublishingRepo(false))}
        />
      )}
      {cloning && (
        <CloneDialog
          home={home}
          busy={busy}
          run={task}
          onClose={() => setCloning(false)}
          onCloned={async (path) => {
            setCloning(false);
            await openRepo(path);
          }}
        />
      )}
      {takeSide && (
        <Dialog
          alert="destructive"
          title={"Take side " + (takeSide === "ours" ? "2" : "3")}
          busy={busy}
          onClose={() => setTakeSide(null)}
        >
          <p>
            Replace <strong>{selected}</strong> with the{" "}
            {takeSide === "ours"
              ? "side 2 (ours: your branch)"
              : "side 3 (theirs: the incoming change)"}{" "}
            version and mark it resolved? If that side deleted the file, it is
            removed. Edits you made to this file during the conflict are lost.
          </p>
          {error && (
            <pre className="modal-error" role="alert">
              {error}
            </pre>
          )}
          <div className="modal-footer">
            <button onClick={() => setTakeSide(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  await mutate("conflict_take", {
                    file: selected,
                    side: takeSide,
                  })
                )
                  setTakeSide(null);
              }}
            >
              Take this side
            </button>
          </div>
        </Dialog>
      )}
      {publishing && repo && (
        <PublishDialog
          key={repo.path + repo.branch}
          repo={repo}
          busy={busy}
          action={mutate}
          operationError={error}
          onClose={() => setPublishing(false)}
        />
      )}
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
      {resetTarget && repo && (
        <ResetDialog
          commit={resetTarget}
          branch={repo.branch}
          busy={busy}
          action={async (op, data) => {
            const ok = await mutate(op, data);
            if (ok) {
              setCommitId("");
              setDiff("");
              setHistoryRevision((v) => v + 1);
            }
            return ok;
          }}
          onClose={() => setResetTarget("")}
        />
      )}
      {cleaning && repo && <CleanDialog repo={repo.path} busy={busy} action={mutate} onClose={() => setCleaning(false)} />}
      {forcing && repo && <ForcePushDialog repo={repo.path} busy={busy} action={mutate} onClose={() => setForcing(false)} />}
      {newBranch && <NewBranchSheet busy={busy} action={mutate} onClose={() => setNewBranch(false)} />}
      {pulling && repo && (
        <PullDialog
          key={repo.path + repo.upstream}
          repo={repo}
          busy={busy}
          action={mutate}
          operationError={error}
          onClose={() => setPulling(false)}
        />
      )}
      {stashing && repo && (
        <StashDialog
          key={repo.path}
          repo={repo.path}
          busy={busy}
          action={mutate}
          operationError={error}
          onClose={() => setStashing(false)}
        />
      )}
      {discardTarget && (
        <Dialog
          alert="destructive"
          title="Discard changes"
          busy={busy}
          onClose={() => setDiscardTarget(null)}
        >
          <p>
            {discardTarget.code === "??"
              ? "Delete the untracked file "
              : "Restore the latest commit version of "}
            <strong>{discardTarget.path}</strong>
            {discardTarget.code === "??"
              ? "? This cannot be undone."
              : " and remove its staged and unstaged changes? This cannot be undone."}
          </p>
          {error && (
            <pre className="modal-error" role="alert">
              {error}
            </pre>
          )}
          <div className="modal-footer">
            <button
              onClick={() => setDiscardTarget(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  await mutate("discard", { file: discardTarget.path })
                )
                  setDiscardTarget(null);
              }}
            >
              {busy ? "Discarding…" : "Discard changes"}
            </button>
          </div>
        </Dialog>
      )}
      {abortOperation && (
        <Dialog
          alert="destructive"
          title={
            abortOperation === "rebase" ? "Abort rebase" : "Abort merge"
          }
          busy={busy}
          onClose={() => setAbortOperation(null)}
        >
          <p>
            {abortOperation === "rebase"
              ? "Abort the rebase and restore the previous branch tip? Conflict-resolution edits made during this rebase can be lost."
              : "Abort the merge and return to the state before it? Conflict-resolution edits made during this merge can be lost."}
          </p>
          <div className="modal-footer">
            <button
              onClick={() => setAbortOperation(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  await mutate(
                    abortOperation === "rebase"
                      ? "rebase_abort"
                      : "merge_abort",
                  )
                )
                  setAbortOperation(null);
              }}
            >
              {busy
                ? "Aborting…"
                : abortOperation === "rebase"
                  ? "Abort rebase"
                  : "Abort merge"}
            </button>
          </div>
        </Dialog>
      )}
      {conflict && (
        <Dialog
          title={"Resolve: " + conflict.file}
          wide
          busy={busy}
          onClose={() => setConflict(null)}
        >
          <p>
            Compare the common base and both Git index sides, then edit the
            result. Saving stages the resolved file.
          </p>
          {error && (
            <pre className="modal-error" role="alert">
              {error}
            </pre>
          )}
          <div className="conflict-sides">
            {[
              ["Common base", conflict.base],
              ["Index side 2 · ours", conflict.ours],
              ["Index side 3 · theirs", conflict.theirs],
            ].map(([label, value]) => (
              <div key={label}>
                <label>{label}</label>
                <pre>{value}</pre>
              </div>
            ))}
          </div>
          <div className="button-row">
            <button onClick={() => setResolution(conflict.ours)}>
              Use side 2
            </button>
            <button onClick={() => setResolution(conflict.theirs)}>
              Use side 3
            </button>
            <button onClick={() => setResolution(conflict.result)}>
              Reset editor
            </button>
          </div>
          <label htmlFor="resolution">Resolved result</label>
          <textarea
            id="resolution"
            className="resolution-editor"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
          <div className="modal-footer">
            <span className="hint">
              Remove all conflict markers before saving.
            </span>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  const result = await api<{ message: string }>(
                    "conflict_save",
                    {
                      repo: repo?.path,
                      file: conflict.file,
                      previous: conflict.result,
                      stages: conflict.stages,
                      content: resolution,
                    },
                  );
                  setNotice(result.message);
                  setConflict(null);
                  await refresh();
                })
              }
            >
              Save & mark resolved
            </button>
          </div>
        </Dialog>
      )}
      {browse && (
        <Dialog title="Open folder" busy={busy} onClose={() => setBrowse(null)}>
          <p>Choose a Git repository or a folder inside it.</p>
          {error && (
            <pre className="modal-error" role="alert">
              {error}
            </pre>
          )}
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void task(() => browseTo(folder));
            }}
          >
            <input
              aria-label="Folder path"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
            <button>Go</button>
          </form>
          <div className="button-row">
            {browse.roots.map((root) => (
              <button
                key={root}
                onClick={() => void task(() => browseTo(root))}
              >
                {root}
              </button>
            ))}
            {browse.parent && (
              <button onClick={() => void task(() => browseTo(browse.parent!))}>
                Parent folder
              </button>
            )}
          </div>
          <div className="directory-list">
            {browse.directories.map((dir) => (
              <button
                key={dir.path}
                onClick={() => void task(() => browseTo(dir.path))}
              >
                <Icon name="folder" /> {dir.name}
              </button>
            ))}
          </div>
          <div className="modal-footer">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void task(() => openRepo(browse.path))}
            >
              Open repository
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
export default App;
