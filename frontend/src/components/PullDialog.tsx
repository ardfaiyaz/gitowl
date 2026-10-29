import { useState } from "react";
import type { Repo } from "../types";
import { Dialog } from "./Dialog";

type Mode = "ff" | "merge" | "rebase";
type Action = (op: string, data?: object) => Promise<boolean>;

const strategies: { value: Mode; label: string; description: string }[] = [
  {
    value: "ff",
    label: "Fast-forward only",
    description:
      "Apply remote commits only when your branch can move forward without a merge or rebase.",
  },
  {
    value: "merge",
    label: "Create a merge commit",
    description:
      "Keep your local commits and merge the remote history into this branch.",
  },
  {
    value: "rebase",
    label: "Rebase local commits",
    description:
      "Replay your local commits on top of the remote branch for a linear history.",
  },
];

export function PullDialog({
  repo,
  busy,
  action,
  operationError,
  onClose,
}: {
  repo: Repo;
  busy: boolean;
  action: Action;
  operationError: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("ff");
  const [error, setError] = useState("");
  return (
    <Dialog title="Pull changes" busy={busy} onClose={onClose}>
      <p>
        Integrate <strong>{repo.upstream || "the upstream branch"}</strong> into{" "}
        <strong>{repo.branch}</strong>. Uncommitted changes stay in your working
        tree.
      </p>
      {!repo.upstream && (
        <p className="inline-warning">
          This branch has no upstream. Publish it or check out a remote branch
          first.
        </p>
      )}
      <fieldset className="choice-list">
        <legend>Integration strategy</legend>
        {strategies.map((strategy) => (
          <label className="choice" key={strategy.value}>
            <input
              type="radio"
              name="pull-mode"
              value={strategy.value}
              checked={mode === strategy.value}
              onChange={() => setMode(strategy.value)}
            />
            <span>
              <strong>{strategy.label}</strong>
              <small>{strategy.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {(operationError || error) && (
        <pre className="modal-error" role="alert">
          {operationError || error}
        </pre>
      )}
      <p className="hint">
        Conflicts pause the merge or rebase. Resolve them in Changes, then
        continue or abort from the operation banner.
      </p>
      <div className="modal-footer">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || !repo.upstream}
          onClick={async () => {
            if (await action("pull", { mode })) onClose();
            else
              setError(
                "Pull did not finish. Review the Git message, resolve any conflicts, then retry.",
              );
          }}
        >
          {busy ? "Pulling…" : "Pull"}
        </button>
      </div>
    </Dialog>
  );
}
