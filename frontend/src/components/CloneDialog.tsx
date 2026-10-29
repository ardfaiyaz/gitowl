import { useEffect, useState } from "react";
import { api } from "../api";
import { Dialog, Skeleton } from "./Dialog";

type GhRepo = {
  nameWithOwner: string;
  description: string;
  isPrivate: boolean;
  updatedAt: string;
  primaryLanguage: { name: string } | null;
};

// Lists the signed-in account's GitHub repositories (not the local disk) and clones one.
export function CloneDialog({
  home,
  busy,
  run,
  onClose,
  onCloned,
}: {
  home: string;
  busy: boolean;
  run: (work: () => Promise<void>) => Promise<boolean>;
  onClose: () => void;
  onCloned: (path: string) => Promise<void>;
}) {
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState("");
  const [parent, setParent] = useState(home);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ repos: GhRepo[] }>("gh_repos")
      .then((v) => active && setRepos(v.repos))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, []);
  const shown = (repos || []).filter((r) =>
    (r.nameWithOwner + " " + (r.description || "")).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog title="Clone from GitHub" wide busy={busy} onClose={onClose}>
      <p>
        Your GitHub repositories, from the GitHub CLI sign-in. gitowl does not
        scan this computer.
      </p>
      {error && (
        <pre className="modal-error" role="alert">
          {error}
        </pre>
      )}
      {!repos && !error && <Skeleton rows={4} label="Loading repositories…" />}
      {repos && (
        <>
          <input
            type="search"
            aria-label="Search your repositories"
            placeholder="Search your repositories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="directory-list repo-picker" role="listbox" aria-label="Repositories">
            {shown.map((r) => (
              <button
                key={r.nameWithOwner}
                role="option"
                aria-selected={chosen === r.nameWithOwner}
                className={chosen === r.nameWithOwner ? "selected" : ""}
                onClick={() => setChosen(r.nameWithOwner)}
              >
                <strong>{r.nameWithOwner}</strong>
                <small>
                  {r.isPrivate ? "Private" : "Public"}
                  {r.primaryLanguage && " · " + r.primaryLanguage.name}
                  {r.description && " · " + r.description}
                </small>
              </button>
            ))}
          </div>
        </>
      )}
      <label htmlFor="clone-parent">Clone into folder</label>
      <input
        id="clone-parent"
        value={parent}
        onChange={(e) => setParent(e.target.value)}
      />
      <div className="modal-footer">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || !chosen || !parent.trim()}
          onClick={() =>
            void run(async () => {
              try {
                const value = await api<{ path: string }>("gh_clone", {
                  name: chosen,
                  parent,
                });
                await onCloned(value.path);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })
          }
        >
          {busy ? "Cloning…" : "Clone and open"}
        </button>
      </div>
    </Dialog>
  );
}
