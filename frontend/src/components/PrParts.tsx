import { useState, type ReactNode } from "react";
import { api } from "../api";
import { ago } from "../ago";
import { outcome, running, type Check, type ReviewThread as Thread } from "../github";

type Perform = (op: string, data?: object) => Promise<boolean>;
type Login = { login: string };
// What the details sidebar shows; issues have no reviewers or base branch.
type SidebarMeta = {
  number: number;
  author: Login;
  baseRefName?: string;
  headRefName?: string;
  assignees: Login[];
  labels?: { name: string; color?: string }[];
  milestone?: { title: string } | null;
  reviewRequests?: { login?: string; name?: string; slug?: string }[];
  latestReviews?: { author: Login | null; state: string }[];
};
export type PrMeta = SidebarMeta & {
  state: string;
  isDraft?: boolean;
  statusCheckRollup: Check[];
  autoMergeRequest: object | null;
};
const agoIso = (iso: string) => ago(String(Date.parse(iso) / 1000));

export function Pill({ value }: { value: string }) {
  return <span className={"pill pill-" + value.toLowerCase().replace(/[^a-z]/g, "")}>{value.replace(/_/g, " ").toLowerCase()}</span>;
}
// Check/job outcome as a round icon plus its name in text, so colour is never the only cue.
export function Outcome({ value }: { value: string }) {
  const kind = /success|completed/.test(value)
    ? "success"
    : /fail|error|cancel|timed|action_required|startup/.test(value)
      ? "failure"
      : /skip|neutral|stale/.test(value)
        ? "neutral"
        : "pending";
  return (
    <span className={"outcome-icon outcome-" + kind} aria-hidden="true">
      {{ success: "✓", failure: "✕", neutral: "–", pending: "•" }[kind]}
    </span>
  );
}

const seconds = (from?: string, to?: string) => (from ? Math.max(0, ((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000) : 0);
const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} m ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const METHOD = { squash: "Squash and merge", merge: "Create a merge commit", rebase: "Rebase and merge" } as const;

// Checks, then what it takes to land the pull request: update branch, auto-merge and merge.
export function ChecksCard({
  pr,
  behindBy,
  busy,
  perform,
  method,
  setMethod,
  deleteBranch,
  setDeleteBranch,
  onMerge,
}: {
  pr: PrMeta;
  behindBy: number | null;
  busy: boolean;
  perform: Perform;
  method: string;
  setMethod: (m: string) => void;
  deleteBranch: boolean;
  setDeleteBranch: (v: boolean) => void;
  onMerge: () => void;
}) {
  const checks = pr.statusCheckRollup || [];
  const live = checks.filter(running).length;
  const failed = checks.filter((c) => !running(c) && /fail|error|cancel|timed/.test(outcome(c))).length;
  const open = pr.state === "OPEN";
  return (
    <section className="gh-card pr-checks" aria-label="Checks and merge">
      <h3>
        Checks · {!checks.length ? "none reported" : live ? `${live} running` : failed ? `${failed} failed` : "all passed"}
      </h3>
      {checks.map((c, i) => (
        <div key={i} className="pr-row">
          {running(c) ? <span className="pr-spin" aria-hidden="true" /> : <Outcome value={outcome(c)} />}
          <span className="pr-row-main">{c.name || c.context}</span>
          <small>
            {running(c)
              ? "running" + (c.startedAt ? " · " + duration(seconds(c.startedAt)).replace(/ \d+ s$/, "") : "")
              : c.startedAt && c.completedAt
                ? duration(seconds(c.startedAt, c.completedAt))
                : outcome(c).replace(/_/g, " ")}
          </small>
        </div>
      ))}
      {open && behindBy !== null && (
        <div className="pr-row">
          <span className="pr-row-main">
            This branch is {behindBy ? `${behindBy} commit${behindBy === 1 ? "" : "s"}` : ""} behind {pr.baseRefName}.
          </span>
          <button disabled={busy} onClick={() => void perform("gh_pr_update_branch", { number: pr.number })}>
            Update branch
          </button>
        </div>
      )}
      {open && (
        <>
          <label className="pr-row switch-row">
            <span className="pr-row-main">
              <strong>Merge automatically</strong>
              <small>{METHOD[method as keyof typeof METHOD]} once checks pass and it's approved</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              disabled={busy || pr.isDraft}
              checked={!!pr.autoMergeRequest}
              onChange={(e) => void perform("gh_pr_auto", { number: pr.number, enable: e.target.checked, method })}
            />
          </label>
          <div className="pr-row pr-merge">
            <label className="capsule-select">
              Method
              <select aria-label="Merge method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {Object.entries(METHOD).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="confirmation-check inline">
              <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
              Delete branch after merge
            </label>
            <button className="primary" disabled={busy || pr.isDraft} onClick={onMerge}>
              Merge…
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type Options = { labels: { name: string; color: string }[]; people: string[]; milestones: string[] };
type Field = "reviewers" | "assignees" | "labels" | "milestone";

// Reviewers, assignees, labels and milestone; every pick saves straight away with gh pr edit.
export function PrSidebar({ repo, pr, busy, perform, kind = "pr" }: { repo: string; pr: SidebarMeta; busy: boolean; perform: Perform; kind?: "pr" | "issue" }) {
  const [editing, setEditing] = useState<Field | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<Field | null>(null);
  const [filter, setFilter] = useState("");
  function open(field: Field) {
    setFilter("");
    setEditing(editing === field ? null : field);
    if (!options)
      api<Options>("gh_pr_options", { repo })
        .then(setOptions)
        .catch((e) => setError(String(e)));
  }
  async function save(field: Field, data: object) {
    setSaving(field);
    await perform(kind === "pr" ? "gh_pr_edit" : "gh_issue_edit", { number: pr.number, ...data });
    setSaving(null);
  }
  const requested = (pr.reviewRequests ?? []).map((r) => r.login || r.slug || r.name || "").filter(Boolean);
  const reviewed = (pr.latestReviews ?? []).filter((r) => r.author && r.author.login !== pr.author.login);
  const picker = (field: Field, choices: string[], selected: string[], toggle: (value: string, on: boolean) => object, single = false) =>
    editing === field && (
      <div className="pr-picker" role="group" aria-label={"Choose " + field}>
        {error && <p className="inline-warning">{error}</p>}
        {!options && !error && <p className="hint">Loading…</p>}
        {options && choices.length > 8 && (
          <input type="search" aria-label={"Filter " + field} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        )}
        {options && !choices.length && <p className="hint">Nothing to choose from in this repository.</p>}
        <ul>
          {choices
            .filter((c) => c.toLowerCase().includes(filter.trim().toLowerCase()))
            .map((choice) => {
              const on = selected.includes(choice);
              const color = field === "labels" ? options?.labels.find((l) => l.name === choice)?.color : undefined;
              return (
                <li key={choice}>
                  <label>
                    <input
                      type={single ? "radio" : "checkbox"}
                      name={"pr-" + field}
                      checked={on}
                      disabled={busy || saving !== null}
                      onClick={() => single && on && void save(field, toggle(choice, false))}
                      onChange={() => void save(field, toggle(choice, !on))}
                    />
                    {color && <span className="label-dot" style={{ background: "#" + color }} aria-hidden="true" />}
                    {choice}
                  </label>
                </li>
              );
            })}
        </ul>
      </div>
    );
  const row = (field: Field, title: string, action: string, value: ReactNode) => (
    <>
      <dt>
        {title}
        {saving === field && <span className="pr-spin" role="status" aria-label="Saving" />}
      </dt>
      <dd>
        {value}
        <button className="small" aria-expanded={editing === field} disabled={busy && editing !== field} onClick={() => open(field)}>
          {editing === field ? "Done" : action}
        </button>
      </dd>
    </>
  );
  return (
    <aside className="gh-card pr-side" aria-label={kind === "pr" ? "Pull request details" : "Issue details"}>
      <dl>
        {kind === "pr" && row(
          "reviewers",
          "Reviewers",
          "Request…",
          <>
            {reviewed.map((r) => (
              <span key={r.author!.login} className="pr-person">
                {r.author!.login} <Pill value={r.state} />
              </span>
            ))}
            {requested
              .filter((login) => !reviewed.some((r) => r.author!.login === login))
              .map((login) => (
                <span key={login} className="pr-person">
                  {login} <Pill value="pending" />
                </span>
              ))}
            {!reviewed.length && !requested.length && <span className="hint">None yet</span>}
          </>,
        )}
        {kind === "pr" && picker(
          "reviewers",
          (options?.people || []).filter((p) => p !== pr.author.login),
          requested,
          (login, on) => (on ? { addReviewers: login } : { removeReviewers: login }),
        )}
        {row("assignees", "Assignees", "Edit", pr.assignees.length ? pr.assignees.map((a) => a.login).join(", ") : <span className="hint">No one</span>)}
        {picker(
          "assignees",
          options?.people || [],
          pr.assignees.map((a) => a.login),
          (login, on) => (on ? { addAssignees: login } : { removeAssignees: login }),
        )}
        {row(
          "labels",
          "Labels",
          "Edit",
          pr.labels?.length ? (
            pr.labels.map((l) => (
              <span key={l.name} className="label-chip">
                {l.color && <span className="label-dot" style={{ background: "#" + l.color }} aria-hidden="true" />}
                {l.name}
              </span>
            ))
          ) : (
            <span className="hint">None</span>
          ),
        )}
        {picker(
          "labels",
          (options?.labels || []).map((l) => l.name),
          (pr.labels || []).map((l) => l.name),
          (name, on) => (on ? { addLabels: name } : { removeLabels: name }),
        )}
        {row("milestone", "Milestone", "Change", pr.milestone?.title || <span className="hint">None</span>)}
        {picker(
          "milestone",
          options?.milestones || [],
          pr.milestone ? [pr.milestone.title] : [],
          (title, on) => (on ? { milestone: title } : { removeMilestone: true }),
          true,
        )}
        {kind === "pr" && (
          <>
            <dt>Base</dt>
            <dd>
              <code>
                {pr.baseRefName} ← {pr.headRefName}
              </code>
            </dd>
          </>
        )}
      </dl>
      <p className="hint">Edits save as soon as you pick them.</p>
    </aside>
  );
}

const SUGGESTION = /```suggestion[^\n]*\n([\s\S]*?)```/;

// One review conversation under its diff line: messages, suggested changes, resolve and reply.
export function ReviewThread({
  thread,
  original,
  busy,
  perform,
  onApply,
}: {
  thread: Thread;
  original?: string;
  busy: boolean;
  perform: Perform;
  onApply: (commentId: string) => void;
}) {
  const [reply, setReply] = useState("");
  const comments = thread.comments.nodes;
  // Apply the newest suggestion; GitHub only applies ones on current, unresolved lines.
  const applicable = [...comments].reverse().find((c) => SUGGESTION.test(c.body));
  const canApply = !!applicable && !thread.isOutdated && !thread.isResolved && thread.diffSide === "RIGHT";
  const body = (
    <>
      {comments.map((c) => {
        const m = SUGGESTION.exec(c.body);
        const before = m ? c.body.slice(0, m.index).trim() : c.body.trim();
        const after = m ? c.body.slice(m.index + m[0].length).trim() : "";
        const suggested = m?.[1].replace(/\r/g, "").replace(/\n$/, "");
        return (
          <div key={c.id} className="pr-msg">
            <p className="pr-msg-meta">
              <strong>{c.author?.login || "ghost"}</strong> · {agoIso(c.createdAt)}
            </p>
            {before && <p className="pr-msg-text">{before}</p>}
            {suggested !== undefined && (
              <div className="pr-sug">
                <p>Suggested change</p>
                {original !== undefined && thread.startLine === null && (
                  <div className="diff-line removed">
                    <code>-{original}</code>
                  </div>
                )}
                {(suggested ? suggested.split("\n") : []).map((line, i) => (
                  <div key={i} className="diff-line added">
                    <code>+{line}</code>
                  </div>
                ))}
              </div>
            )}
            {after && <p className="pr-msg-text">{after}</p>}
          </div>
        );
      })}
      <div className="pr-thread-actions">
        {canApply && (
          <button className="primary" disabled={busy} onClick={() => onApply(applicable.id)}>
            Apply suggestion
          </button>
        )}
        <button disabled={busy} onClick={() => void perform("gh_pr_thread_resolve", { thread: thread.id, resolve: !thread.isResolved })}>
          {thread.isResolved ? "Unresolve" : "Resolve"}
        </button>
      </div>
      <form
        className="pr-reply"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await perform("gh_pr_thread_reply", { thread: thread.id, body: reply })) setReply("");
        }}
      >
        <input aria-label="Reply" placeholder="Reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
        {original !== undefined && thread.diffSide === "RIGHT" && (
          <button type="button" disabled={busy} onClick={() => setReply((b) => b + (b ? "\n" : "") + "```suggestion\n" + original + "\n```")}>
            Suggest change
          </button>
        )}
        {reply.trim() && (
          <button className="primary" disabled={busy}>
            Reply
          </button>
        )}
      </form>
    </>
  );
  return thread.isResolved ? (
    <details className="pr-thread resolved">
      <summary>
        Resolved conversation · {thread.path}
        {thread.line ? ":" + thread.line : ""}
      </summary>
      {body}
    </details>
  ) : (
    <div className="pr-thread">
      {thread.isOutdated && (
        <p className="pr-msg-meta">
          <code>{thread.path}</code> · outdated
        </p>
      )}
      {body}
    </div>
  );
}
