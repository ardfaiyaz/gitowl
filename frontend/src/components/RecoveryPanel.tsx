import { useEffect, useState } from "react";
import { api } from "../api";
import { Dialog, Skeleton } from "./Dialog";

type Point = { ref: string; id: string; time: string; message: string };
type Action = (op: string, data?: object) => Promise<boolean>;

// Lists commits gitowl kept before rewriting history, and recovers them as branches.
export function RecoveryPanel({
  repo,
  busy,
  action,
}: {
  repo: string;
  busy: boolean;
  action: Action;
}) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [branchFor, setBranchFor] = useState<Point | null>(null);
  const [branch, setBranch] = useState("");
  const [deleting, setDeleting] = useState<Point | null>(null);
  useEffect(() => {
    let active = true;
    api<{ points: Point[] }>("recovery_list", { repo })
      .then((v) => active && setPoints(v.points))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [repo, revision]);
  async function perform(op: string, data: object) {
    const ok = await action(op, data);
    if (ok) setRevision((v) => v + 1);
    return ok;
  }
  return (
    <section className="settings-card">
      <h2>Recovery points</h2>
      <p>
        gitowl keeps the previous commit before every history edit or rebase
        plan. Recover one as a branch at any time.
      </p>
      {error && (
        <pre className="inline-warning" role="alert">
          {error}
        </pre>
      )}
      {!points && !error && <Skeleton rows={2} label="Loading recovery points…" />}
      {points && !points.length && <p className="hint">No recovery points yet.</p>}
      <ul className="recovery-list stagger">
        {points?.map((p) => (
          <li key={p.ref}>
            <div>
              <strong>{p.message}</strong>
              <small>
                <code>{p.id.slice(0, 8)}</code> ·{" "}
                {new Date(Number(p.time) * 1000).toLocaleString()}
              </small>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setBranch("recovered/" + p.id.slice(0, 8));
                setBranchFor(p);
              }}
            >
              Create branch…
            </button>
            <button disabled={busy} onClick={() => setDeleting(p)}>
              Delete…
            </button>
          </li>
        ))}
      </ul>
      {branchFor && (
        <Dialog title="Recover as branch" busy={busy} onClose={() => setBranchFor(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await perform("recovery_branch", { reference: branchFor.ref, branch }))
                setBranchFor(null);
            }}
          >
            <p>
              Creates a branch at <code>{branchFor.id.slice(0, 12)}</code>. Your
              current branch and files are unchanged.
            </p>
            <label htmlFor="recovery-branch">Branch name</label>
            <input
              id="recovery-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              required
            />
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
      {deleting && (
        <Dialog alert="destructive" title="Delete recovery point" busy={busy} onClose={() => setDeleting(null)}>
          <p>
            Delete the recovery point for <strong>{deleting.message}</strong>?
            If no branch contains this commit, Git may eventually remove it.
          </p>
          <div className="modal-footer">
            <button onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={async () => {
                if (await perform("recovery_delete", { reference: deleting.ref }))
                  setDeleting(null);
              }}
            >
              Delete recovery point
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
