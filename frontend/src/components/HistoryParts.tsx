import { useEffect, useState } from "react";
import { api } from "../api";
import { Dialog, Skeleton } from "./Dialog";
import { Segmented } from "./Segmented";
import { ago } from "../ago";

type Action = (op: string, data?: object) => Promise<boolean>;
type BlameLine = { id: string; author: string; time: string; text: string };
type Entry = { id: string; message: string; time: string };
const LIMIT = 5000;

// Who last changed each line of a file; clicking a name opens that commit.
export function Blame({ repo, file, id, onOpen }: { repo: string; file: string; id: string; onOpen: (id: string) => void }) {
  const [result, setResult] = useState<{ key: string; lines?: BlameLine[]; error?: string } | null>(null);
  const key = [repo, file, id].join("\n");
  useEffect(() => {
    let active = true;
    api<{ lines: BlameLine[] }>("blame", { repo, file, id })
      .then((v) => active && setResult({ key, lines: v.lines }))
      .catch((e) => active && setResult({ key, error: String(e) }));
    return () => {
      active = false;
    };
  }, [repo, file, id, key]);
  if (result?.key !== key) return <Skeleton rows={6} label="Loading blame…" />;
  if (result.error)
    return (
      <pre className="inline-warning" role="alert">
        {result.error}
      </pre>
    );
  const lines = result.lines!;
  return (
    <div className="diff blame" aria-label={"Blame for " + file}>
      {lines.slice(0, LIMIT).map((l, i) => (
        <div key={i} className="blame-line">
          <button className="blame-who" title={`${l.author} · ${l.id.slice(0, 8)}`} onClick={() => onOpen(l.id)}>
            {l.author} · {ago(l.time)}
          </button>
          <span className="line-no">{i + 1}</span>
          <code>{l.text || " "}</code>
        </div>
      ))}
      {lines.length > LIMIT && (
        <p className="diff-limit">
          Showing the first {LIMIT.toLocaleString()} of {lines.length.toLocaleString()} lines.
        </p>
      )}
    </div>
  );
}

// Every place HEAD has been, so a commit lost in a reset or rebase can be recovered as a branch.
export function Reflog({ repo, busy, action }: { repo: string; busy: boolean; action: Action }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [branchFor, setBranchFor] = useState<Entry | null>(null);
  const [branch, setBranch] = useState("");
  useEffect(() => {
    let active = true;
    api<{ entries: Entry[] }>("reflog", { repo })
      .then((v) => active && setEntries(v.entries))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [repo]);
  return (
    <section className="reflog">
      <h2>Lost something? Reflog</h2>
      {error && (
        <pre className="inline-warning" role="alert">
          {error}
        </pre>
      )}
      {!entries && !error && <Skeleton rows={2} label="Loading reflog…" />}
      {entries && !entries.length && <p className="hint">HEAD hasn't moved yet.</p>}
      {!!entries?.length && (
        <ul className="grouped-list">
          {entries.map((e, i) => (
            <li key={i}>
              <div>
                <strong>{e.message}</strong>
                <small>
                  {ago(e.time)} · <code>{e.id.slice(0, 7)}</code>
                </small>
              </div>
              <button
                disabled={busy}
                onClick={() => {
                  setBranch("recovered/" + e.id.slice(0, 8));
                  setBranchFor(e);
                }}
              >
                Recover as branch
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Every place HEAD has been, beyond recovery points. Read-only until you recover something.</p>
      {branchFor && (
        <Dialog title="Recover as branch" busy={busy} onClose={() => setBranchFor(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await action("branch_at", { id: branchFor.id, branch })) setBranchFor(null);
            }}
          >
            <p>
              Creates a branch at <code>{branchFor.id.slice(0, 12)}</code>. Your current branch and files are unchanged.
            </p>
            <label htmlFor="reflog-branch">Branch name</label>
            <input id="reflog-branch" value={branch} onChange={(e) => setBranch(e.target.value)} required />
            <div className="modal-footer">
              <button type="button" onClick={() => setBranchFor(null)} disabled={busy}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !branch.trim()}>
                Create branch
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Command palette", "Ctrl K"],
  ["Commit staged changes", "Ctrl Enter"],
  ["Fetch", "Ctrl ⇧ F"],
  ["Switch page", "Ctrl 1–7"],
  ["Toggle sidebar", "Ctrl B"],
  ["Next / previous file", "J / K"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" busy={false} onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([label, keys]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>
                <kbd>{keys}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Shortcuts never fire while you are typing in a field, except Ctrl K and Ctrl Enter.</p>
    </Dialog>
  );
}

const RESET = {
  soft: "Moves the branch here. Changes from the later commits stay staged, ready to commit again.",
  mixed: "Moves the branch here. Changes from the later commits stay in your files, unstaged.",
  hard: "Moves the branch here and discards later changes to tracked files. Untracked files are kept.",
} as const;

// Reset to here: three modes in plain words; a recovery point is always saved, and hard reads as destructive.
export function ResetDialog({ commit, branch, busy, action, onClose }: { commit: string; branch: string; busy: boolean; action: (op: string, data?: object) => Promise<boolean>; onClose: () => void }) {
  const [mode, setMode] = useState<keyof typeof RESET>("mixed");
  return (
    <Dialog alert={mode === "hard" ? "destructive" : "caution"} title={`Reset ${branch} to ${commit.slice(0, 8)}?`} busy={busy} onClose={onClose}>
      <div className="alert-segment">
        <Segmented
          label="Reset mode"
          value={mode}
          options={[
            ["soft", "Soft"],
            ["mixed", "Mixed"],
            ["hard", "Hard"],
          ]}
          onChange={setMode}
        />
      </div>
      <p>{RESET[mode]} A recovery point is saved first.</p>
      <div className="modal-footer">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={"primary" + (mode === "hard" ? " destructive" : "")} disabled={busy} onClick={async () => (await action("reset", { id: commit, mode })) && onClose()}>
          {mode === "hard" ? "Reset and discard" : "Reset"}
        </button>
      </div>
    </Dialog>
  );
}
