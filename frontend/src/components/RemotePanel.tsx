import { useState } from "react";
import type { Repo } from "../types";
import { Dialog } from "./Dialog";

type Remote = { name: string; fetchUrl: string; pushUrl: string };
type Action = (op: string, data?: object) => Promise<boolean>;

function parseRemotes(raw: string): Remote[] {
  const remotes = new Map<string, Remote>();
  for (const line of raw.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const name = line.slice(0, tab);
    const match = line
      .slice(tab + 1)
      .match(/^(.*) \((fetch|push)\)$/);
    if (!match) continue;
    const remote = remotes.get(name) ?? {
      name,
      fetchUrl: "",
      pushUrl: "",
    };
    if (match[2] === "fetch") remote.fetchUrl = match[1];
    else remote.pushUrl = match[1];
    remotes.set(name, remote);
  }
  return [...remotes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function RemotePanel({
  repo,
  busy,
  action,
  operationError,
}: {
  repo: Repo;
  busy: boolean;
  action: Action;
  operationError: string;
}) {
  const remotes = parseRemotes(repo.remotes);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Remote | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [removing, setRemoving] = useState<Remote | null>(null);
  const [dialogError, setDialogError] = useState("");
  return (
    <>
      <h2>Remote connections</h2>
      <p>
        Remotes are named destinations for fetch, pull, push and tags. Changes
        here affect only this repository.
      </p>
      {remotes.length ? (
        <ul className="remote-list">
          {remotes.map((remote) => (
            <li key={remote.name}>
              <div>
                <strong>{remote.name}</strong>
                <code>{remote.fetchUrl}</code>
                {remote.pushUrl && remote.pushUrl !== remote.fetchUrl && (
                  <code>push: {remote.pushUrl}</code>
                )}
              </div>
              <div className="remote-actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditing(remote);
                    setEditUrl(remote.pushUrl || remote.fetchUrl);
                    setDialogError("");
                  }}
                >
                  Change URL…
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setRemoving(remote);
                    setDialogError("");
                  }}
                >
                  Remove…
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>No remote configured. Local Git features still work.</p>
      )}
      <form
        className="inline-form remote-add"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (
            await action("remote_add", {
              name: name.trim(),
              url: url.trim(),
            })
          ) {
            setName("");
            setUrl("");
          } else {
            setError("The remote could not be added. Review the Git message.");
          }
        }}
      >
        <input
          aria-label="Remote name"
          placeholder="origin"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="Remote URL"
          placeholder="https://host/owner/repository.git"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="primary"
          disabled={busy || !name.trim() || !url.trim()}
        >
          Add remote
        </button>
      </form>
      {(operationError || error) && (
        <p className="inline-warning" role="alert">
          {operationError || error}
        </p>
      )}
      <p className="hint">
        Pull uses the strategy you choose each time. Diverged branches can be
        merged or rebased explicitly.
      </p>
      {editing && (
        <Dialog
          title={"Change URL for " + editing.name}
          busy={busy}
          onClose={() => setEditing(null)}
        >
          <p>
            Update the destination used for {editing.name}. Existing commits and
            branches are unchanged.
          </p>
          <label htmlFor="remote-edit-url">Remote URL</label>
          <input
            id="remote-edit-url"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
          />
          {dialogError && (
            <pre className="modal-error" role="alert">
              {dialogError}
            </pre>
          )}
          <div className="modal-footer">
            <button onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !editUrl.trim()}
              onClick={async () => {
                if (
                  await action("remote_set_url", {
                    name: editing.name,
                    url: editUrl.trim(),
                  })
                )
                  setEditing(null);
                else
                  setDialogError(
                    "The URL was not saved. Review the Git message and retry.",
                  );
              }}
            >
              Save URL
            </button>
          </div>
        </Dialog>
      )}
      {removing && (
        <Dialog
          alert="destructive"
          title={"Remove remote " + removing.name}
          busy={busy}
          onClose={() => setRemoving(null)}
        >
          <p>
            Remove <strong>{removing.name}</strong> from this repository? Its
            remote-tracking branches disappear. Local branches and their commits
            are unchanged.
          </p>
          <div className="destination-preview">
            <span>Destination</span>
            <pre>{removing.fetchUrl}</pre>
          </div>
          {dialogError && (
            <pre className="modal-error" role="alert">
              {dialogError}
            </pre>
          )}
          <div className="modal-footer">
            <button onClick={() => setRemoving(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await action("remote_remove", { name: removing.name })
                )
                  setRemoving(null);
                else
                  setDialogError(
                    "The remote was not removed. Review the Git message and retry.",
                  );
              }}
            >
              Remove remote
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
