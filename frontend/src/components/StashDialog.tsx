import { useEffect, useState } from "react";
import { api } from "../api";
import { Dialog, Skeleton } from "./Dialog";

type Stash = { index: number; ref: string; message: string; date: string };
type Action = (op: string, data?: object) => Promise<boolean>;

export function StashDialog({
  repo,
  busy,
  action,
  operationError,
  onClose,
}: {
  repo: string;
  busy: boolean;
  action: Action;
  operationError: string;
  onClose: () => void;
}) {
  const [stashes, setStashes] = useState<Stash[] | null>(null);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<{ stashes: Stash[] }>("stash_list", { repo })
      .then((value) => {
        if (active) {
          setStashes(value.stashes);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [repo, revision]);
  return (
    <Dialog title="Stashes" busy={busy} onClose={onClose}>
      <p>
        Save uncommitted changes without committing, then restore them when you
        are ready. Stashes stay in this repository.
      </p>
      <form
        className="stash-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await action("stash_save", {
              message: message.trim(),
              includeUntracked,
            })
          ) {
            setMessage("");
            setIncludeUntracked(false);
            setRevision((value) => value + 1);
          }
        }}
      >
        <label htmlFor="stash-message">Stash message</label>
        <input
          id="stash-message"
          placeholder="What are you setting aside?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <label className="confirmation-check stash-toggle">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
          />
          Include untracked files
        </label>
        <button className="primary" disabled={busy}>
          Stash current changes
        </button>
      </form>
      <h3>Saved stashes</h3>
      {(operationError || error) && (
        <pre className="modal-error" role="alert">
          {operationError || error}
        </pre>
      )}
      {stashes === null ? (
        <Skeleton rows={2} label="Loading stashes…" />
      ) : !stashes.length ? (
        <p>No stashes saved in this repository.</p>
      ) : (
        <ul className="stash-list">
          {stashes.map((stash) => (
            <li key={stash.ref}>
              <div>
                <strong>{stash.message}</strong>
                <p>
                  <code>{stash.ref}</code> · {stash.date}
                </p>
              </div>
              <button
                disabled={busy}
                onClick={async () => {
                  if (await action("stash_pop", { index: stash.index }))
                    setRevision((value) => value + 1);
                }}
              >
                Restore &amp; remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        Restoring can produce conflicts. Resolve them in Changes before
        continuing.
      </p>
    </Dialog>
  );
}
