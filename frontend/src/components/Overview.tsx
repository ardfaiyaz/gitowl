import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../api";
import type { Repo } from "../types";
import { Icon } from "./Icon";
import type { Tab } from "./Sidebar";
import { ago } from "../ago";
import { Segmented } from "./Segmented";

type Commit = { id: string; author: string; message: string; time: string };
type PullRequest = {
  number: number;
  title: string;
  author?: { login: string };
  headRefName?: string;
  baseRefName?: string;
  isDraft?: boolean;
  reviewDecision?: string;
};

const agoIso = (iso: string) => ago(String(Date.parse(iso) / 1000));
const stagger = (i: number) => ({ "--i": Math.min(i, 8) }) as CSSProperties;
const Skeleton = ({ width }: { width?: number | string }) => (
  <span className="skeleton skeleton-line" style={{ width }} aria-hidden="true" />
);

// Repository dashboard: local state first, GitHub data only when it is available.
export function Overview({
  repo,
  github,
  signedIn,
  pushBlocked,
  onPush,
  onNavigate,
  onMutate,
  onError,
  onUnread,
}: {
  repo: Repo;
  github: boolean | null;
  signedIn: boolean;
  pushBlocked: boolean;
  onPush: () => void;
  onNavigate: (tab: Tab) => void;
  onMutate: (op: string, data?: object) => Promise<unknown>;
  onError: (e: unknown) => void;
  onUnread: (count: number) => void;
}) {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  useEffect(() => {
    let active = true;
    api<{ commits: Commit[] }>("history", { repo: repo.path, page: 0 })
      .then((v) => active && setCommits(v.commits.slice(0, 5)))
      .catch(() => active && setCommits([]));
    api<{ points: unknown[] }>("recovery_list", { repo: repo.path })
      .then((v) => active && setRecovery(String(v.points.length)))
      .catch(() => active && setRecovery("—"));
    return () => {
      active = false;
    };
  }, [repo.path, repo.fingerprint]);
  useEffect(() => {
    if (!github) return;
    let active = true;
    api<{ items: PullRequest[] }>("gh_prs", { repo: repo.path, state: "open" })
      .then((v) => active && setPrs(v.items))
      .catch(() => active && setPrs([]));
    return () => {
      active = false;
    };
  }, [repo.path, github]);

  const [ahead, behind] = repo.counts.split(/\s+/);
  const tracked = !!repo.upstream && behind !== undefined;
  const staged = repo.files.filter((f) => f.staged).length;
  const partly = repo.files.filter((f) => f.staged && f.unstaged).length;
  const pr = github ? prs?.[0] : undefined;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="overview">
      <header className="overview-head">
        <h1>Overview</h1>
      </header>
      {/* One plain status line instead of metric tiles; each fact links to where you act on it. */}
      <ul className="status-line" aria-label="Repository status">
        <li>
          <button className="link-button" onClick={() => onNavigate("changes")}>
            {repo.files.length ? plural(repo.files.length, "changed file") : "No changes"}
          </button>
          {repo.files.length > 0 &&
            (partly
              ? ` · ${partly} partly staged`
              : staged
                ? ` · ${staged} staged`
                : " · nothing staged")}
        </li>
        <li aria-busy={github !== false && !prs}>
          {github === false ? (
            <button className="link-button" onClick={() => onNavigate("github")}>
              {signedIn ? "Not on GitHub yet" : "Connect GitHub"}
            </button>
          ) : prs ? (
            <button className="link-button" onClick={() => onNavigate("github")}>
              {plural(prs.length, "open pull request")}
            </button>
          ) : (
            <Skeleton width={120} />
          )}
        </li>
        <li aria-busy={recovery === null}>
          {recovery === null ? (
            <Skeleton width={110} />
          ) : (
            <button className="link-button" onClick={() => onNavigate("settings")}>
              {recovery === "—" ? "Recovery points unavailable" : plural(Number(recovery), "recovery point")}
            </button>
          )}
        </li>
      </ul>
      {signedIn ? (
        <ForYou repo={repo} onMutate={onMutate} onError={onError} onUnread={onUnread} />
      ) : (
      <div className="overview-columns">
        <section className="overview-section activity-section" aria-busy={!commits}>
          <div className="section-title">
            <h2>Activity</h2>
            <button className="link-button" onClick={() => onNavigate("history")}>
              See All
            </button>
          </div>
          <ol className="inset-list stagger">
            {commits
              ? commits.map((commit, i) => (
                  <li key={commit.id} className="inset-row" style={stagger(i)}>
                    <span className="inset-text">
                      <span>{commit.message}</span>
                      <small>
                        {commit.author} · {ago(commit.time)} ·{" "}
                        <code>{commit.id.slice(0, 7)}</code>
                      </small>
                    </span>
                  </li>
                ))
              : [0, 1, 2, 3].map((i) => (
                  <li key={i} className="inset-row" aria-hidden="true">
                    <span className="inset-text">
                      <Skeleton width="60%" />
                      <Skeleton width="35%" />
                    </span>
                  </li>
                ))}
            {commits?.length === 0 && (
              <li className="inset-row inset-empty">No commits yet.</li>
            )}
          </ol>
        </section>
        <section className="overview-section">
          <h2 className="section-title">
            {pr ? "Pull request #" + pr.number : "Current branch"}
          </h2>
          <div className="side-card">
            {pr ? (
              <>
                <strong>{pr.title}</strong>
                <small>
                  {[
                    pr.author?.login,
                    pr.headRefName && pr.headRefName + " → " + pr.baseRefName,
                    pr.isDraft
                      ? "Draft"
                      : pr.reviewDecision?.toLowerCase().replace(/_/g, " "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <button className="primary wide" onClick={() => onNavigate("github")}>
                  Review
                </button>
              </>
            ) : (
              <>
                <span className="branch-name">
                  <Icon name="branch" />
                  <strong>{repo.branch}</strong>
                </span>
                <small>
                  {repo.upstream
                    ? `Tracking ${repo.upstream}` +
                      (tracked ? ` · ${ahead} ahead, ${behind} behind` : "")
                    : "Not published yet"}
                </small>
                <button className="primary wide" disabled={pushBlocked} onClick={onPush}>
                  {!repo.remoteNames.length ? "Publish to GitHub" : repo.upstream ? "Push" : "Publish branch"}
                </button>
              </>
            )}
          </div>
        </section>
      </div>
      )}
    </div>
  );
}

type Need = {
  kind: "review" | "changes" | "issue" | "ci";
  number?: number;
  title: string;
  repository?: { nameWithOwner: string };
  url: string;
  updatedAt: string;
};
type Note = { id: string; unread: boolean; reason: string; title: string; type: string; repo: string; updatedAt: string; url: string };
const needLabel = { review: "Review requested", changes: "Changes requested on your PR", issue: "Assigned to you", ci: "Workflow run" };
const filters = [
  ["unread", "Unread"],
  ["mentions", "Mentions"],
  ["all", "All"],
] as const;

function NeedIcon({ kind }: { kind: Need["kind"] }) {
  return (
    <span className={"need-icon need-" + kind} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {kind === "issue" ? (
          <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18m0 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4" />
        ) : kind === "ci" ? (
          <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18m3 6-6 6m0-6 6 6" />
        ) : (
          <path d="M6 3.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M6 15.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5m12 0a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4" />
        )}
      </svg>
    </span>
  );
}

// "Waiting on you" and the GitHub notifications inbox, shown when GitHub is connected.
function ForYou({
  repo,
  onMutate,
  onError,
  onUnread,
}: {
  repo: Repo;
  onMutate: (op: string, data?: object) => Promise<unknown>;
  onError: (e: unknown) => void;
  onUnread: (count: number) => void;
}) {
  const [needs, setNeeds] = useState<Need[] | null>(null);
  const [inbox, setInbox] = useState<Note[] | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("unread");
  const [leaving, setLeaving] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    api<{ items: Need[] }>("gh_for_you", { repo: repo.path })
      .then((v) => active && setNeeds(v.items))
      .catch(() => active && setNeeds([]));
    return () => {
      active = false;
    };
  }, [repo.path, repo.fingerprint]);
  useEffect(() => {
    let active = true;
    api<{ items: Note[] }>("gh_inbox", { repo: repo.path, all: filter !== "unread" })
      .then((v) => active && setInbox(v.items))
      .catch(() => active && setInbox([]));
    return () => {
      active = false;
    };
  }, [repo.path, filter]);
  useEffect(() => {
    // Only the Unread list is a complete count; All and Mentions mix in read items.
    if (inbox && filter === "unread") onUnread(inbox.length);
  }, [inbox, filter, onUnread]);
  const open = (url: string) => void onMutate("open_in", { target: "url", url });
  // shortcut: an issue counts as "this repository" when its owner/name appears in the remotes; fine for GitHub remotes.
  const isHere = (n: Need) => !!n.repository && repo.remotes.toLowerCase().includes(n.repository.nameWithOwner.toLowerCase());
  const done = (note: Note) => {
    setLeaving((ids) => [...ids, note.id]);
    api("gh_inbox_done", { repo: repo.path, id: note.id })
      // The row collapses for 200 ms, then leaves the list.
      .then(() => setTimeout(() => setInbox((list) => list?.filter((n) => n.id !== note.id) ?? null), 200))
      .catch((e) => {
        setLeaving((ids) => ids.filter((id) => id !== note.id));
        onError(e);
      });
  };
  const shown = inbox?.filter((n) => filter !== "mentions" || n.reason === "mention" || n.reason === "team_mention");
  return (
    <div className="for-you">
      <section className="overview-section" aria-labelledby="waiting-title" aria-busy={!needs}>
        <h2 id="waiting-title" className="section-title">Waiting on you</h2>
        <ul className="inset-list need-list">
          {needs === null &&
            [0, 1, 2].map((i) => (
              <li key={i} className="inset-row" aria-hidden="true">
                <span className="inset-text">
                  <Skeleton width="60%" />
                  <Skeleton width="35%" />
                </span>
              </li>
            ))}
          {needs?.length === 0 && <li className="inset-row inset-empty">Nothing is waiting on you.</li>}
          {needs?.map((n) => (
            <li key={n.kind + n.url} className="inset-row">
              <NeedIcon kind={n.kind} />
              <span className="inset-text">
                <span>{n.title}</span>
                <small>
                  {[needLabel[n.kind], n.number && "#" + n.number, n.repository?.nameWithOwner, agoIso(n.updatedAt)].filter(Boolean).join(" · ")}
                </small>
              </span>
              {n.kind === "issue" && isHere(n) ? (
                <button onClick={() => void onMutate("gh_issue_develop", { number: n.number })}>Start work</button>
              ) : (
                <button className={n.kind === "review" ? "primary" : ""} onClick={() => open(n.url)}>
                  {n.kind === "review" ? "Review" : n.kind === "ci" ? "View logs" : "Open"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="overview-section" aria-labelledby="inbox-title" aria-busy={!inbox}>
        <div className="section-title">
          <h2 id="inbox-title">Inbox</h2>
          <Segmented
            label="Filter notifications"
            value={filter}
            options={filters}
            onChange={(key) => {
              setInbox(null);
              setFilter(key);
            }}
          />
        </div>
        <ul className="inset-list inbox-list">
          {!shown &&
            [0, 1, 2].map((i) => (
              <li key={i} className="inset-row" aria-hidden="true">
                <span className="inset-text">
                  <Skeleton width="55%" />
                  <Skeleton width="40%" />
                </span>
              </li>
            ))}
          {shown?.length === 0 && <li className="inset-row inset-empty">You&apos;re all caught up.</li>}
          {shown?.map((n) => (
            <li key={n.id} className={"reveal" + (leaving.includes(n.id) ? "" : " open")}>
              <div className="reveal-clip">
                <div className="inset-row">
                  <span className={"unread-dot" + (n.unread ? "" : " read")} role="img" aria-label={n.unread ? "Unread" : "Read"} />
                  <span className="inset-text">
                    <button className="link-button inbox-title" onClick={() => open(n.url)}>
                      {n.title}
                    </button>
                    <small>{[n.repo, n.type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(), agoIso(n.updatedAt)].join(" · ")}</small>
                  </span>
                  <button aria-label={"Mark done: " + n.title} disabled={leaving.includes(n.id)} onClick={() => done(n)}>
                    Done
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
