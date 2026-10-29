import { useEffect, useState } from "react";
import { api } from "../api";
import { Dialog, Skeleton } from "./Dialog";

type Preview = {
  head: string;
  branch: string;
  target: string;
  clean: boolean;
  merges: boolean;
  commits: { id: string; message: string }[];
  blocked: string[];
};
type Step = { id: string; message: string; action: string };
export type Arrange = { move: string; onto: string; mode: "newer" | "older" | "squash" };
// Steps run oldest first, so "newer" lands after the target and a squash folds into the one before it.
function arrange(list: Step[], { move, onto, mode }: Arrange): Step[] {
  const item = list.find((s) => s.id === move);
  const rest = list.filter((s) => s.id !== move);
  const at = rest.findIndex((s) => s.id === onto);
  if (!item || at < 0) return list;
  rest.splice(mode === "older" ? at : at + 1, 0, { ...item, action: mode === "squash" ? "squash" : "pick" });
  return rest;
}
const actions: [string, string][] = [
  ["pick", "Keep"],
  ["squash", "Squash"],
  ["fixup", "Fixup"],
  ["drop", "Drop"],
];

// Guided interactive rebase: the plan is built here and Git runs it with a recovery point retained.
export function RebasePlanDialog({
  repo,
  commit,
  busy,
  run,
  onUpdated,
  onClose,
  initial,
}: {
  repo: string;
  commit: string;
  // From dragging in History: move one commit next to another (newer/older side) or squash into it.
  initial?: Arrange;
  busy: boolean;
  run: (work: () => Promise<void>) => Promise<boolean>;
  onUpdated: () => Promise<void>;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    let active = true;
    api<Preview>("rewrite_preview", { repo, target: commit })
      .then((value) => {
        if (!active) return;
        setPreview(value);
        const picked = value.commits.map((c) => ({ ...c, action: "pick" }));
        setSteps(initial ? arrange(picked, initial) : picked);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [repo, commit, initial]);
  const move = (index: number, by: number) =>
    setSteps((list) => {
      const next = [...list];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  const firstKept = steps.find((s) => s.action !== "drop");
  const invalid =
    !firstKept || firstKept.action === "squash" || firstKept.action === "fixup";
  const unchanged =
    !!preview &&
    steps.every((s, i) => s.action === "pick" && s.id === preview.commits[i].id);
  const blocked = [
    ...(preview?.blocked || []),
    ...(preview?.merges
      ? ["Merge commits are in this range. Use Edit commit for messages and authors here."]
      : []),
    ...(preview && !preview.clean
      ? ["Commit, stash or discard working changes before rebasing."]
      : []),
  ];
  const canApply =
    !busy && !invalid && !unchanged && acknowledged && !blocked.length;
  const apply = () =>
    void run(async () => {
      try {
        const value = await api<{ message: string; recovery: string }>(
          "rewrite_plan",
          {
            repo,
            head: preview!.head,
            branch: preview!.branch,
            target: preview!.target,
            steps: steps.map(({ id, action }) => ({ id, action })),
          },
        );
        setResult(value.message + " Recovery point: " + value.recovery);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        await onUpdated();
      }
    });
  const title = "Rewrite history from here";
  return (
    <Dialog
      title={title}
      wide
      busy={busy}
      onClose={onClose}
      header={
        <div className="sheet-bar">
          {result ? (
            <span />
          ) : (
            <button type="button" className="sheet-text-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
          <h2>{title}</h2>
          {result ? (
            <button className="primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <button className="primary" disabled={!preview || !canApply} onClick={apply}>
              {busy ? "Rebasing…" : "Apply plan"}
            </button>
          )}
        </div>
      }
    >
      {error && (
        <pre className="inline-warning" role="alert">
          {error}
        </pre>
      )}
      {!preview && !error && <Skeleton rows={4} label="Loading commits…" />}
      {result ? (
        <div className="commit-edit-result">
          <p role="status">{result}</p>
        </div>
      ) : (
        preview && (
          <>
            {blocked.length > 0 && (
              <div className="inline-warning" role="status">
                <strong>Rewriting is currently unavailable</strong>
                <ul>
                  {blocked.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            <h3 className="group-label">
              Plan · oldest first ·{" "}
              {preview.branch.replace("refs/heads/", "")}
            </h3>
            <ol className="rebase-plan grouped stagger">
              {steps.map((step, i) => (
                <li key={step.id} className={"plan-" + step.action}>
                  <svg className="drag-glyph" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24">
                    <rect x="3" y="6" width="18" height="2.4" rx="1.2" />
                    <rect x="3" y="11" width="18" height="2.4" rx="1.2" />
                    <rect x="3" y="16" width="18" height="2.4" rx="1.2" />
                  </svg>
                  <span className="plan-message">
                    <span>{step.message}</span>
                    <code>{step.id.slice(0, 8)}</code>
                  </span>
                  <select
                    className="plan-action"
                    aria-label={"Action for " + step.message}
                    value={step.action}
                    disabled={busy || blocked.length > 0}
                    onChange={(e) =>
                      setSteps((list) =>
                        list.map((s, j) =>
                          j === i ? { ...s, action: e.target.value } : s,
                        ),
                      )
                    }
                  >
                    {actions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="plan-move">
                    <button
                      aria-label={"Move " + step.message + " earlier"}
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={"Move " + step.message + " later"}
                      disabled={busy || i === steps.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <p className="group-footnote">
              Use the arrows to reorder. Squash combines a commit into the
              previous one with both messages; Fixup keeps only the previous
              message. To reword a message, use Edit commit instead.
            </p>
            {invalid && (
              <p className="hint" role="status">
                Keep at least one commit, and the first kept commit must be
                “Keep”.
              </p>
            )}
            <div className="warning-card">
              <span className="warning-icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7" />
                </svg>
              </span>
              <p>
                {steps.length} commits get new hashes.{" "}
                <span>
                  Reordering can cause conflicts. If Git stops, resolve files
                  in Changes and use Continue rebase, or Abort to return. The
                  original history is saved as a recovery point first.
                </span>
              </p>
            </div>
            <label className="switch-row">
              <span>
                I understand this rewrites {steps.length} commits and changes
                their hashes.
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={acknowledged}
                disabled={busy || blocked.length > 0}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
            </label>
          </>
        )
      )}
    </Dialog>
  );
}
