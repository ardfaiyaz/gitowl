import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Segmented } from "./Segmented";
import { api } from "../api";
import type { Repo } from "../types";
import { Dialog, Skeleton } from "./Dialog";
import { Diff, type LinePos } from "./Diff";
import { ChecksCard, Outcome, Pill, PrSidebar, ReviewThread } from "./PrParts";
import { GitHubMore } from "./GitHubMore";
import { Sheet } from "./RepoDialogs";
import { outcome, running, when, type Check, type ReviewThread as Thread } from "../github";
import { JobLog, RunWorkflowDialog } from "./ActionsParts";

type Action = (op: string, data?: object) => Promise<boolean>;
type User = { login: string };
type Label = { name: string };
type Comment = { author: User; body: string; createdAt?: string; state?: string };
type Status = {
  signedIn: boolean;
  detail: string;
  repo: {
    nameWithOwner?: string;
    url?: string;
    description?: string;
    visibility?: string;
    stargazerCount?: number;
    forkCount?: number;
    viewerPermission?: string;
    isFork?: boolean;
    defaultBranchRef?: { name: string };
    error?: string;
  } | null;
};
type Item = {
  number: number;
  title: string;
  author: User;
  state: string;
  url: string;
  labels?: Label[];
  isDraft?: boolean;
  headRefName?: string;
  baseRefName?: string;
  reviewDecision?: string;
  comments?: Comment[] | number;
  updatedAt?: string;
};
type PrDetail = Item & {
  body: string;
  additions: number;
  deletions: number;
  files: { path: string; additions: number; deletions: number }[];
  commits: { oid: string; messageHeadline: string }[];
  comments: Comment[];
  reviews: Comment[];
  statusCheckRollup: Check[];
  mergeable: string;
  headRefOid: string;
  mergeStateStatus: string;
  autoMergeRequest: object | null;
  milestone: { title: string } | null;
  assignees: User[];
  labels: { name: string; color?: string }[];
  reviewRequests: { login?: string; name?: string; slug?: string }[];
  latestReviews: { author: User | null; state: string }[];
};
type PrView = { detail: PrDetail; diff: string; threads: Thread[]; behindBy: number | null };
type IssueDetail = Item & {
  body: string;
  comments: Comment[];
  assignees: User[];
  createdAt: string;
  milestone: { title: string } | null;
  labels: { name: string; color?: string }[];
  isPinned: boolean;
  locked: boolean;
};
type Run = {
  databaseId: number;
  displayTitle: string;
  workflowName: string;
  status: string;
  conclusion: string;
  headBranch: string;
  event: string;
  createdAt: string;
  url: string;
};
type RunDetail = Run & {
  jobs: { databaseId: number; name: string; status: string; conclusion: string; steps: { name: string; conclusion: string }[] }[];
  artifacts: number;
};
type Release = { tagName: string; name: string; isDraft: boolean; isPrerelease: boolean; isLatest: boolean; publishedAt: string };
type Section = "prs" | "issues" | "runs" | "releases" | "more";
type Confirm = { title: string; body: string; label: string; op: string; data: object };

// Conversation as chat bubbles: the signed-in account's messages sit right, everyone else left.
function Thread({ items, me }: { items: Comment[]; me: string }) {
  return (
    <ul className="chat stagger">
      {items.map((c, i) => {
        const login = c.author?.login || "ghost";
        const mine = !!me && login.toLowerCase() === me.toLowerCase();
        return (
          <li key={i} className={"chat-item" + (mine ? " mine" : "")}>
            {!mine && (
              <span className="chat-avatar" aria-hidden="true">
                {login.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="chat-bubble">
              <p className="chat-meta">
                <strong>{login}</strong>
                {c.state && (mine ? " · " + c.state.replace(/_/g, " ").toLowerCase() : <Pill value={c.state} />)}{" "}
                <small>{when(c.createdAt)}</small>
              </p>
              {c.body && <pre>{c.body}</pre>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
const sendIcon = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5m-6 6 6-6 6 6" />
  </svg>
);

// GitHub collaboration through the GitHub CLI: pull requests, issues, Actions and releases.
export function GitHubPanel({
  repo,
  busy,
  action,
  headerSlot,
}: {
  repo: Repo;
  busy: boolean;
  action: Action;
  // The page header's control slot: the GitHub sections sit beside the title, as on the board.
  headerSlot: HTMLElement | null;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [section, setSection] = useState<Section>("prs");
  const [state, setState] = useState("open");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[] | Run[] | Release[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pr, setPr] = useState<PrView | null>(null);
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [deleteTyped, setDeleteTyped] = useState<string | null>(null);
  const [linePick, setLinePick] = useState<(LinePos & { number: number }) | null>(null);
  const [lineBody, setLineBody] = useState("");
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [runningWorkflow, setRunningWorkflow] = useState(false);
  const [logJob, setLogJob] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [review, setReview] = useState("comment");
  const [method, setMethod] = useState("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [prTab, setPrTab] = useState("conversation");
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const signedIn = !!status?.signedIn && !status.repo?.error;
  const listKey = [section, state, search, repo.path].join("\n");
  // gh auth status prints "Logged in to github.com account NAME" (older gh: "as NAME").
  const me = /Logged in to \S+ (?:account|as) ([\w-]+)/.exec(status?.detail || "")?.[1] || "";

  useEffect(() => {
    let active = true;
    api<Status>("gh_status", { repo: repo.path })
      .then((v) => active && setStatus(v))
      .catch((e) => active && fail(e));
    return () => {
      active = false;
    };
  }, [repo.path, revision]);

  useEffect(() => {
    // More has its own cards instead of a list.
    if (!signedIn || section === "more") return;
    let active = true;
    const op = { prs: "gh_prs", issues: "gh_issues", runs: "gh_runs", releases: "gh_releases" }[section];
    const timer = setTimeout(() => {
      api<{ items: Item[] | Run[] | Release[] }>(op, { repo: repo.path, state, search })
        .then((v) => {
          if (active) {
            setItems(v.items);
            setLoadedKey([section, state, search, repo.path].join("\n"));
            setError("");
          }
        })
        .catch((e) => active && fail(e));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [signedIn, section, state, search, repo.path, revision]);

  useEffect(() => {
    if (selected === null) return;
    let active = true;
    const load =
      section === "prs"
        ? api<PrView>("gh_pr", { repo: repo.path, number: selected }).then((v) => active && setPr(v))
        : section === "issues"
          ? api<{ detail: IssueDetail; locked: boolean }>("gh_issue", { repo: repo.path, number: selected }).then((v) => active && setIssue({ ...v.detail, locked: v.locked }))
          : section === "runs"
            ? api<{ detail: RunDetail; artifacts: number }>("gh_run", { repo: repo.path, number: selected }).then((v) => active && setRun({ ...v.detail, artifacts: v.artifacts }))
            : Promise.resolve();
    load.catch((e) => active && fail(e));
    return () => {
      active = false;
    };
  }, [selected, section, repo.path, revision]);

  // A run in progress refreshes its jobs and steps every 5 seconds until it completes.
  const liveRun = section === "runs" && run && run.status !== "completed" ? run.databaseId : null;
  useEffect(() => {
    if (liveRun === null) return;
    const timer = setInterval(() => {
      api<{ detail: RunDetail; artifacts: number }>("gh_run", { repo: repo.path, number: liveRun })
        .then((v) => setRun({ ...v.detail, artifacts: v.artifacts }))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [liveRun, repo.path]);

  // While any check is still running, the open pull request refreshes every 10 seconds.
  const livePr = section === "prs" && pr?.detail.statusCheckRollup?.some(running) ? pr.detail.number : null;
  useEffect(() => {
    if (livePr === null) return;
    const timer = setInterval(() => {
      api<PrView>("gh_pr", { repo: repo.path, number: livePr })
        .then(setPr)
        .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [livePr, repo.path]);

  // Applying commits to the pull request's branch on GitHub, so it is confirmed first.
  function applySuggestion(commentId: string) {
    setConfirm({
      title: "Apply suggestion",
      body: `Commit this suggested change to ${pr?.detail.headRefName} on GitHub? It becomes a new commit on the pull request.`,
      label: "Commit suggestion",
      op: "gh_pr_apply_suggestion",
      data: { comment: commentId },
    });
  }
  async function perform(op: string, data: object = {}) {
    const ok = await action(op, data);
    if (ok) setRevision((v) => v + 1);
    return ok;
  }
  function open(next: Section) {
    setSection(next);
    setSelected(null);
    setPr(null);
    setIssue(null);
    setRun(null);
    setItems([]);
    setState("open");
    setSearch("");
    setCreating(false);
  }
  function startCreate() {
    setCreating(true);
    setSelected(null);
    if (section === "prs")
      setForm({ base: status?.repo?.defaultBranchRef?.name || "main", head: repo.branch, title: "", body: "", draft: false });
    else if (section === "releases") {
      setForm({ tag: "", title: "", notes: "", assets: "", draft: false, prerelease: false });
      api<{ tags: string[] }>("branches", { repo: repo.path }).then((v) => setTags(v.tags)).catch(fail);
    } else setForm({ title: "", body: "" });
  }
  const field = (key: string, label: string, multiline = false, extra: ReactNode = null) => (
    <>
      <label htmlFor={"gh-" + key}>{label}</label>
      {multiline ? (
        <textarea id={"gh-" + key} rows={6} value={String(form[key] ?? "")} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      ) : (
        <input id={"gh-" + key} value={String(form[key] ?? "")} onChange={(e) => setForm({ ...form, [key]: e.target.value })} list={extra ? "gh-tags" : undefined} />
      )}
      {extra}
    </>
  );
  const check = (key: string, label: string) => (
    <label className="confirmation-check">
      <input type="checkbox" checked={!!form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
      {label}
    </label>
  );

  if (!status)
    return error ? (
      <div className="empty">
        <h3>Checking GitHub…</h3>
        <pre className="inline-warning">{error}</pre>
      </div>
    ) : (
      <section className="github-workspace">
        <Skeleton rows={5} label="Checking GitHub…" />
      </section>
    );
  if (!status.signedIn)
    return (
      <section className="github-connect">
        <h2>Connect GitHub</h2>
        <p>
          gitowl uses the GitHub CLI, which keeps your sign-in in your system
          keyring. Your commit identity is separate and stays in Settings.
        </p>
        <ol>
          <li>
            Install GitHub CLI from <code>https://cli.github.com</code>.
          </li>
          <li>
            Run <code>gh auth login</code> in a terminal and follow the browser
            sign-in.
          </li>
          <li>Come back here and check again.</li>
        </ol>
        <pre className="hint">{status.detail}</pre>
        <button className="primary" onClick={() => setRevision((v) => v + 1)}>
          Check again
        </button>
      </section>
    );
  if (status.repo?.error)
    return (
      <section className="github-connect">
        <h2>This project is not linked to a GitHub repository</h2>
        <p>Add a GitHub remote in Settings, then check again.</p>
        <pre className="hint">{status.repo.error}</pre>
        <button onClick={() => setRevision((v) => v + 1)}>Check again</button>
      </section>
    );

  const info = status.repo!;
  const list = items as Item[];
  // Pin, lock and transfer need triage access; deleting an issue needs admin.
  const canTriage = ["ADMIN", "MAINTAIN", "WRITE", "TRIAGE"].includes(info.viewerPermission ?? "");
  return (
    <section className="github-workspace" aria-label="GitHub">
      <header className="github-header">
        <div>
          <h2>{info.nameWithOwner}</h2>
          <p>
            {info.description || "No description"} · {info.visibility?.toLowerCase()} · ★{" "}
            {info.stargazerCount} · forks {info.forkCount} · your access:{" "}
            {info.viewerPermission?.toLowerCase()}
          </p>
        </div>
        <div className="button-row">
          {info.isFork ? (
            <button disabled={busy} title="Brings your fork up to date with its parent; stops if your fork has its own commits" onClick={() => void perform("gh_sync")}>
              Sync fork
            </button>
          ) : (
            // Forking is offered only where you can't push, which is when you'd need one.
            !["ADMIN", "MAINTAIN", "WRITE"].includes(info.viewerPermission ?? "") && (
              <button disabled={busy} title="Creates your own copy on GitHub; origin becomes the fork, the original becomes upstream" onClick={() => void perform("gh_fork")}>
                Fork
              </button>
            )
          )}
          <button disabled={busy} onClick={() => void perform("gh_browse")}>
            Open on GitHub
          </button>
          <button
            disabled={busy}
            onClick={() =>
              setConfirm({
                title: "Sign out of GitHub CLI",
                body: "This signs the GitHub CLI out on this computer, including for terminal use. Git pushes that use another credential helper are unaffected.",
                label: "Sign out",
                op: "gh_logout",
                data: {},
              })
            }
          >
            Sign out
          </button>
        </div>
      </header>
      {headerSlot &&
        createPortal(
          <Segmented
            label="GitHub sections"
            value={section}
            options={[
              ["prs", "Pull requests"],
              ["issues", "Issues"],
              ["runs", "Actions"],
              ["releases", "Releases"],
              ["more", "More"],
            ]}
            onChange={open}
          />,
          headerSlot,
        )}
      {error && (
        <div className="inline-warning" role="alert">
          <pre>{error}</pre>
          <button onClick={() => { setError(""); setRevision((v) => v + 1); }}>Retry</button>
        </div>
      )}
      {section === "more" ? (
        <GitHubMore repo={repo.path} busy={busy} perform={perform} />
      ) : (
      <div className="github-layout">
        <aside className="github-list">
          <div className="github-filters">
            {(section === "prs" || section === "issues") && (
              <>
                <input type="search" aria-label="Search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select aria-label="State" value={state} onChange={(e) => setState(e.target.value)}>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  {section === "prs" && <option value="merged">Merged</option>}
                  <option value="all">All</option>
                </select>
              </>
            )}
            {section !== "runs" && (
              <button className="primary" disabled={busy} onClick={startCreate}>
                New {section === "prs" ? "pull request" : section === "issues" ? "issue" : "release"}
              </button>
            )}
            {section === "runs" && (
              <>
                <button onClick={() => setRevision((v) => v + 1)}>Refresh</button>
                <button className="primary" disabled={busy} onClick={() => setRunningWorkflow(true)}>
                  Run workflow…
                </button>
              </>
            )}
          </div>
          {!items.length && loadedKey !== listKey ? (
            <Skeleton rows={4} />
          ) : !items.length ? (
            <p className="hint">Nothing here yet.</p>
          ) : (
            <div className="github-group stagger">
              {section === "runs"
                ? (items as Run[]).map((r) => (
                    <button key={r.databaseId} className={"github-row " + (selected === r.databaseId ? "selected" : "")} onClick={() => { setCreating(false); setSelected(r.databaseId); }}>
                      <Pill value={outcome(r)} />
                      <strong>{r.displayTitle}</strong>
                      <small>{r.workflowName} · {r.headBranch} · {r.event} · {when(r.createdAt)}</small>
                    </button>
                  ))
                : section === "releases"
                  ? (items as Release[]).map((r) => (
                      <div key={r.tagName} className="github-row">
                        <strong>{r.name || r.tagName}</strong>
                        <small>
                          <code>{r.tagName}</code> {r.isLatest && <Pill value="latest" />} {r.isDraft && <Pill value="draft" />}{" "}
                          {r.isPrerelease && <Pill value="prerelease" />} {when(r.publishedAt)}
                        </small>
                      </div>
                    ))
                  : list.map((item) => (
                      <button key={item.number} className={"github-row " + (selected === item.number ? "selected" : "")} onClick={() => { setCreating(false); setPr(null); setIssue(null); setSelected(item.number); }}>
                        <span className="github-row-top">
                          <Pill value={item.isDraft ? "draft" : item.state} />
                          <small>#{item.number}</small>
                        </span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.author?.login}
                          {item.headRefName && ` · ${item.headRefName} → ${item.baseRefName}`}
                          {item.reviewDecision && ` · ${item.reviewDecision.replace(/_/g, " ").toLowerCase()}`}
                          {item.labels?.map((l) => ` · ${l.name}`)}
                        </small>
                      </button>
                    ))}
            </div>
          )}
        </aside>
        <div className="github-detail">
          {creating ? (
            <form
              className="github-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const op = section === "prs" ? "gh_pr_create" : section === "issues" ? "gh_issue_create" : "gh_release_create";
                if (await perform(op, form)) setCreating(false);
              }}
            >
              <h2>New {section === "prs" ? "pull request" : section === "issues" ? "issue" : "release"}</h2>
              {section === "prs" && (
                <>
                  <p>The head branch must already be pushed. Use Publish branch first if needed.</p>
                  {field("head", "Compare (head branch)")}
                  {field("base", "Into (base branch)")}
                </>
              )}
              {section === "releases" && (
                <>
                  <p>The tag must already be pushed (Branches &amp; tags → Push tag). A tag alone is not a release.</p>
                  {field("tag", "Tag", false, (
                    <datalist id="gh-tags">
                      {tags.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  ))}
                </>
              )}
              {field("title", "Title")}
              {section === "releases" ? field("notes", "Release notes", true) : field("body", "Description", true)}
              {section === "prs" && check("draft", "Create as draft")}
              {section === "releases" && (
                <>
                  {field("assets", "Assets (one repository file path per line)", true)}
                  {check("draft", "Save as draft")}
                  {check("prerelease", "Mark as pre-release")}
                </>
              )}
              <div className="modal-footer">
                <button type="button" onClick={() => setCreating(false)} disabled={busy}>
                  Cancel
                </button>
                <button className="primary" disabled={busy || !String((section === "releases" ? form.tag : form.title) ?? "").trim()}>
                  {busy ? "Publishing…" : "Publish to GitHub"}
                </button>
              </div>
            </form>
          ) : selected !== null && section !== "releases" && pr?.detail.number !== selected && issue?.number !== selected && run?.databaseId !== selected ? (
            <Skeleton rows={5} label="Loading details…" />
          ) : section === "prs" && pr ? (
            <article className="github-article pr-review">
              <header className="pr-head">
                <Pill value={pr.detail.isDraft ? "draft" : pr.detail.state} />
                <h2>
                  {pr.detail.title} <span className="pr-number">#{pr.detail.number}</span>
                </h2>
                <div className="button-row">
                  {pr.detail.state === "OPEN" &&
                    (pr.detail.isDraft ? (
                      <button disabled={busy} onClick={() => void perform("gh_pr_ready", { number: pr.detail.number })}>
                        Ready for review
                      </button>
                    ) : (
                      <button disabled={busy} onClick={() => void perform("gh_pr_draft", { number: pr.detail.number })}>
                        Convert to draft
                      </button>
                    ))}
                  <button disabled={busy} onClick={() => void perform("gh_pr_checkout", { number: pr.detail.number })}>
                    Check out locally
                  </button>
                  <button disabled={busy} onClick={() => void perform("gh_browse", { number: pr.detail.number })}>
                    Open on GitHub
                  </button>
                  <button
                    disabled={busy || pr.detail.state === "MERGED"}
                    onClick={() =>
                      pr.detail.state === "OPEN"
                        ? setConfirm({ title: "Close pull request", body: `Close #${pr.detail.number} without merging?`, label: "Close", op: "gh_pr_close", data: { number: pr.detail.number } })
                        : void perform("gh_pr_reopen", { number: pr.detail.number })
                    }
                  >
                    {pr.detail.state === "OPEN" ? "Close…" : "Reopen"}
                  </button>
                </div>
              </header>
              <div className="pr-grid">
                <div className="pr-main">
                  <Segmented
                    className="github-tabs small"
                    label="Pull request sections"
                    value={prTab}
                    options={[
                      ["conversation", `Conversation (${pr.detail.comments.length + pr.detail.reviews.length})`],
                      ["commits", `Commits (${pr.detail.commits.length})`],
                      ["files", `Files changed (${pr.detail.files.length})`],
                    ]}
                    onChange={setPrTab}
                  />
                  {prTab === "conversation" && (
                    <>
                      <pre className="github-body">{pr.detail.body || "No description."}</pre>
                      <div className="gh-card chat-card">
                        <Thread me={me} items={[...pr.detail.reviews, ...pr.detail.comments].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))} />
                        <form
                          className="composer"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const ok =
                              review === "plain"
                                ? await perform("gh_pr_comment", { number: pr.detail.number, body: comment })
                                : await perform("gh_pr_review", { number: pr.detail.number, event: review, body: comment });
                            if (ok) setComment("");
                          }}
                        >
                          <label htmlFor="gh-comment" className="visually-hidden">Add to the conversation</label>
                          <textarea id="gh-comment" rows={1} placeholder="Comment or review…" value={comment} onChange={(e) => setComment(e.target.value)} />
                          <select aria-label="Response type" value={review} onChange={(e) => setReview(e.target.value)}>
                            <option value="plain">Comment</option>
                            <option value="comment">Review: comment</option>
                            <option value="approve">Review: approve</option>
                            <option value="request-changes">Review: request changes</option>
                          </select>
                          <button className="primary send-button" aria-label="Submit" disabled={busy || (review !== "approve" && !comment.trim())}>
                            {sendIcon}
                          </button>
                        </form>
                      </div>
                    </>
                  )}
                  {prTab === "commits" && (
                    <ul className="grouped-list stagger">
                      {pr.detail.commits.map((c) => (
                        <li key={c.oid}>
                          <code>{c.oid.slice(0, 8)}</code> {c.messageHeadline}
                        </li>
                      ))}
                    </ul>
                  )}
                  {prTab === "files" && (
                    <div className="github-diff">
                      <p className="hint">Click a line number to comment.</p>
                      {pr.threads
                        .filter((t) => t.isOutdated || t.line === null)
                        .map((t) => (
                          <ReviewThread key={t.id} thread={t} busy={busy} perform={perform} onApply={applySuggestion} />
                        ))}
                      <Diff
                        text={pr.diff}
                        comment={{
                          onPick: (pos) => {
                            setLinePick({ ...pos, number: pr.detail.number });
                            setLineBody("");
                          },
                          render: (pos) => (
                            <>
                              {pr.threads
                                .filter((t) => !t.isOutdated && t.path === pos.file && t.line === pos.line && t.diffSide === pos.side)
                                .map((t) => (
                                  <ReviewThread key={t.id} thread={t} original={pos.text} busy={busy} perform={perform} onApply={applySuggestion} />
                                ))}
                              {linePick?.number === pr.detail.number && linePick.file === pos.file && linePick.line === pos.line && linePick.side === pos.side && (
                                <form
                                  className="composer diff-comment"
                                  onSubmit={async (e) => {
                                    e.preventDefault();
                                    const { file, line, side } = linePick;
                                    const data = { number: pr.detail.number, path: file, line, side, commit: pr.detail.headRefOid, body: lineBody };
                                    if (await perform("gh_pr_line_comment", data)) setLinePick(null);
                                  }}
                                >
                                  <label htmlFor="gh-line-comment" className="visually-hidden">{`Comment on ${pos.file} line ${pos.line}`}</label>
                                  <textarea id="gh-line-comment" rows={2} autoFocus placeholder="Comment on this line…" value={lineBody} onChange={(e) => setLineBody(e.target.value)} />
                                  {pos.side === "RIGHT" && (
                                    <button type="button" disabled={busy} onClick={() => setLineBody((b) => b + (b ? "\n" : "") + "```suggestion\n" + pos.text + "\n```")}>
                                      Suggest change
                                    </button>
                                  )}
                                  <button type="button" disabled={busy} onClick={() => setLinePick(null)}>
                                    Cancel
                                  </button>
                                  <button className="primary" disabled={busy || !lineBody.trim()}>
                                    Comment
                                  </button>
                                </form>
                              )}
                            </>
                          ),
                        }}
                      />
                    </div>
                  )}
                  <ChecksCard
                    pr={pr.detail}
                    behindBy={pr.behindBy}
                    busy={busy}
                    perform={perform}
                    method={method}
                    setMethod={setMethod}
                    deleteBranch={deleteBranch}
                    setDeleteBranch={setDeleteBranch}
                    onMerge={() =>
                      setConfirm({
                        title: "Merge pull request",
                        body: `Merge #${pr.detail.number} into ${pr.detail.baseRefName} on GitHub using “${method}”${deleteBranch ? " and delete the remote head branch" : ""}? Repository protection rules still apply.`,
                        label: "Merge on GitHub",
                        op: "gh_pr_merge",
                        data: { number: pr.detail.number, method, deleteBranch },
                      })
                    }
                  />
                </div>
                <PrSidebar key={pr.detail.number} repo={repo.path} pr={pr.detail} busy={busy} perform={perform} />
              </div>
            </article>
          ) : section === "issues" && issue ? (
            <article className="github-article pr-review">
              <header className="pr-head">
                <Pill value={issue.state} />
                {issue.isPinned && <Pill value="pinned" />}
                {issue.locked && <Pill value="locked" />}
                <h2>
                  {issue.title} <span className="pr-number">#{issue.number}</span>
                </h2>
                <div className="button-row">
                  {issue.state === "OPEN" && (
                    <button className="primary" disabled={busy} title="Creates a linked branch and checks it out; its pull request closes the issue" onClick={() => void perform("gh_issue_develop", { number: issue.number })}>
                      Start work
                    </button>
                  )}
                  {canTriage && (
                    <>
                      <button disabled={busy} onClick={() => void perform(issue.isPinned ? "gh_issue_unpin" : "gh_issue_pin", { number: issue.number })}>
                        {issue.isPinned ? "Unpin" : "Pin"}
                      </button>
                      <button disabled={busy} onClick={() => void perform(issue.locked ? "gh_issue_unlock" : "gh_issue_lock", { number: issue.number })}>
                        {issue.locked ? "Unlock" : "Lock"}
                      </button>
                      <button disabled={busy} onClick={() => setTransferTo("")}>
                        Transfer…
                      </button>
                    </>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      issue.state === "OPEN"
                        ? setConfirm({ title: "Close issue", body: `Close issue #${issue.number}?`, label: "Close issue", op: "gh_issue_close", data: { number: issue.number } })
                        : void perform("gh_issue_reopen", { number: issue.number })
                    }
                  >
                    {issue.state === "OPEN" ? "Close…" : "Reopen"}
                  </button>
                  <button disabled={busy} onClick={() => void perform("gh_browse", { number: issue.number })}>
                    Open on GitHub
                  </button>
                  {info.viewerPermission === "ADMIN" && (
                    <button className="destructive-text" disabled={busy} onClick={() => setDeleteTyped("")}>
                      Delete…
                    </button>
                  )}
                </div>
              </header>
              <p className="hint">
                Opened by {issue.author.login} · {when(issue.createdAt)}
              </p>
              <div className="pr-grid">
              <div className="pr-main">
              <pre className="github-body">{issue.body || "No description."}</pre>
              <div className="gh-card chat-card">
              <Thread me={me} items={issue.comments} />
              <form
                className="composer"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await perform("gh_issue_comment", { number: issue.number, body: comment })) setComment("");
                }}
              >
                <label htmlFor="gh-issue-comment" className="visually-hidden">Comment</label>
                <textarea id="gh-issue-comment" rows={1} placeholder="Comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
                <button className="primary send-button" aria-label="Comment" disabled={busy || !comment.trim()}>
                  {sendIcon}
                </button>
              </form>
              </div>
              </div>
              <PrSidebar kind="issue" key={issue.number} repo={repo.path} pr={issue} busy={busy} perform={perform} />
              </div>
            </article>
          ) : section === "runs" && run ? (
            <article className="github-article">
              <section className="gh-card github-detail-head">
              <p className="pill-row">
                <Pill value={outcome(run)} />
              </p>
              <h2>{run.displayTitle}</h2>
              <p>
                {run.workflowName} · {run.headBranch} · {run.event}
              </p>
              <div className="button-row merge-controls">
                {run.status !== "completed" ? (
                  <button disabled={busy} onClick={() => setConfirm({ title: "Cancel run", body: "Cancel this workflow run on GitHub?", label: "Cancel run", op: "gh_run_cancel", data: { number: run.databaseId } })}>
                    Cancel run…
                  </button>
                ) : (
                  run.conclusion !== "success" && (
                    <button disabled={busy} onClick={() => void perform("gh_run_rerun", { number: run.databaseId })}>
                      Re-run failed jobs
                    </button>
                  )
                )}
                {run.artifacts > 0 && (
                  <button disabled={busy} onClick={() => void action("gh_run_download", { number: run.databaseId })}>
                    Download artifacts ({run.artifacts})
                  </button>
                )}
              </div>
              </section>
              {run.jobs.map((job) => (
                <section key={job.name} className="job-group">
                  <h3 className="group-label job-head">
                    <span>
                      {job.name} · {outcome(job).replace(/_/g, " ")}
                    </span>
                    {job.status === "completed" && (
                      <button
                        className="link-button"
                        aria-expanded={logJob === job.databaseId}
                        onClick={() => setLogJob(logJob === job.databaseId ? null : job.databaseId)}
                      >
                        {logJob === job.databaseId ? "Hide log" : "View log"}
                      </button>
                    )}
                  </h3>
                  {logJob === job.databaseId && <JobLog repoPath={repo.path} run={run.databaseId} job={job.databaseId} />}
                  <ul className="grouped-list checks stagger">
                    {job.steps.map((s, i) => (
                      <li key={i}>
                        <Outcome value={s.conclusion || "pending"} />
                        <span className="check-name">{s.name}</span>
                        <small>{(s.conclusion || "pending").replace(/_/g, " ")}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </article>
          ) : (
            <div className="empty">
              <h3>Select an item</h3>
              <p>Pull requests, issues and workflow runs open here.</p>
            </div>
          )}
        </div>
      </div>
      )}
      {runningWorkflow && (
        <RunWorkflowDialog
          repoPath={repo.path}
          branch={repo.branch}
          busy={busy}
          onClose={() => setRunningWorkflow(false)}
          onRun={(form) => void perform("gh_workflow_run", form).then((ok) => ok && setRunningWorkflow(false))}
        />
      )}
      {transferTo !== null && issue && (
        <Sheet
          title={"Transfer #" + issue.number}
          action="Transfer"
          busy={busy}
          disabled={!/^[\w.-]+\/[\w.-]+$/.test(transferTo.trim())}
          onClose={() => setTransferTo(null)}
          onSubmit={() =>
            void perform("gh_issue_transfer", { number: issue.number, target: transferTo.trim() }).then((ok) => {
              if (ok) {
                setTransferTo(null);
                setSelected(null);
              }
            })
          }
        >
          <ul className="grouped-list form-rows">
            <li>
              <label htmlFor="it-target">Repository</label>
              <input id="it-target" autoFocus value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="owner/repository" />
            </li>
          </ul>
          <p className="sheet-note">Moves the issue, its comments and assignees. Labels and milestones carry over only where the destination has them.</p>
        </Sheet>
      )}
      {deleteTyped !== null && issue && (
        <Dialog alert="destructive" title={`Delete issue #${issue.number}?`} busy={busy} onClose={() => setDeleteTyped(null)}>
          <p>The issue and its comments are deleted on GitHub. This can't be undone.</p>
          <label className="alert-confirm">
            Type <strong>{issue.number}</strong> to confirm
            <input value={deleteTyped} onChange={(e) => setDeleteTyped(e.target.value)} aria-label={`Type ${issue.number} to confirm`} />
          </label>
          <div className="modal-footer">
            <button onClick={() => setDeleteTyped(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary destructive"
              disabled={busy || deleteTyped !== String(issue.number)}
              onClick={() =>
                void perform("gh_issue_delete", { number: issue.number, confirm: deleteTyped }).then((ok) => {
                  if (ok) {
                    setDeleteTyped(null);
                    setSelected(null);
                  }
                })
              }
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog alert={/close|sign out|delete|cancel/i.test(confirm.label) ? "destructive" : "caution"} title={confirm.title} busy={busy} onClose={() => setConfirm(null)}>
          <p>{confirm.body}</p>
          <div className="modal-footer">
            <button onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await perform(confirm.op, confirm.data)) setConfirm(null);
              }}
            >
              {confirm.label}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
