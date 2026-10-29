import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { Dialog } from "./Dialog";

// Common templates; names are passed to `gh repo gitignore|license view`.
const gitignores = ["", "Node", "Python", "Rust", "Go", "Java", "VisualStudio"];
const licenses: [string, string][] = [
  ["", "None"],
  ["mit", "MIT"],
  ["apache-2.0", "Apache-2.0"],
  ["gpl-3.0", "GPL-3.0"],
];

// Cancel · title · action, like the other sheets.
export function Sheet({
  title,
  action,
  busy,
  disabled,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  action: string;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      busy={busy}
      onClose={onClose}
      header={
        <div className="sheet-bar">
          <button type="button" className="sheet-text-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <h2>{title}</h2>
          <button type="submit" form="repo-sheet" className="primary" disabled={busy || disabled}>
            {action}
          </button>
        </div>
      }
    >
      <form
        id="repo-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </Dialog>
  );
}

export function NewRepoDialog({
  home,
  busy,
  onClose,
  onCreate,
}: {
  home: string;
  busy: boolean;
  onClose: () => void;
  onCreate: (form: { name: string; location: string; gitignore: string; license: string; readme: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState(home);
  const [gitignore, setGitignore] = useState("");
  const [license, setLicense] = useState("");
  const [readme, setReadme] = useState(true);
  const sep = location.includes("\\") ? "\\" : "/";
  return (
    <Sheet
      title="New Repository"
      action="Create"
      busy={busy}
      disabled={!name.trim() || !location.trim()}
      onClose={onClose}
      onSubmit={() => onCreate({ name: name.trim(), location, gitignore, license, readme })}
    >
      <ul className="grouped-list form-rows">
        <li>
          <label htmlFor="nr-name">Name</label>
          <input id="nr-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="weather-cli" />
        </li>
        <li>
          <label htmlFor="nr-location">Location</label>
          <input id="nr-location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </li>
        <li>
          <label htmlFor="nr-ignore">.gitignore</label>
          <select id="nr-ignore" value={gitignore} onChange={(e) => setGitignore(e.target.value)}>
            {gitignores.map((g) => (
              <option key={g} value={g}>
                {g || "None"}
              </option>
            ))}
          </select>
        </li>
        <li>
          <label htmlFor="nr-license">License</label>
          <select id="nr-license" value={license} onChange={(e) => setLicense(e.target.value)}>
            {licenses.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </li>
        <li>
          <span className="form-label">README</span>
          <label className="form-check">
            <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} /> Add a README
          </label>
        </li>
      </ul>
      <p className="sheet-note">
        Creates <code>{name.trim() ? location.replace(/[\\/]$/, "") + sep + name.trim() : "the folder"}</code> with one
        first commit on <code>main</code>. It refuses to run inside an existing repository and never overwrites files.
      </p>
    </Sheet>
  );
}

export function PublishRepoDialog({
  repo,
  busy,
  onClose,
  onPublish,
}: {
  repo: { path: string; name: string };
  busy: boolean;
  onClose: () => void;
  onPublish: (form: { owner: string; name: string; description: string; public: boolean }) => void;
}) {
  const [owners, setOwners] = useState<string[] | null>(null);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState(repo.name);
  const [description, setDescription] = useState("");
  const [isPublic, setPublic] = useState(false);
  useEffect(() => {
    api<{ owners: string[] }>("gh_owners", { repo: repo.path })
      .then((v) => {
        setOwners(v.owners);
        setOwner(v.owners[0] ?? "");
      })
      .catch(() => setOwners([]));
  }, [repo.path]);
  return (
    <Sheet
      title="Publish to GitHub"
      action="Publish"
      busy={busy}
      disabled={!owner || !name.trim()}
      onClose={onClose}
      onSubmit={() => onPublish({ owner, name: name.trim(), description, public: isPublic })}
    >
      <ul className="grouped-list form-rows">
        <li>
          <label htmlFor="pr-owner">Owner</label>
          <select id="pr-owner" value={owner} disabled={!owners?.length} onChange={(e) => setOwner(e.target.value)}>
            {owners === null && <option value="">Loading…</option>}
            {owners?.length === 0 && <option value="">Sign in to GitHub first</option>}
            {owners?.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </li>
        <li>
          <label htmlFor="pr-name">Name</label>
          <input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} />
        </li>
        <li>
          <label htmlFor="pr-desc">Description</label>
          <input id="pr-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </li>
        <li role="radiogroup" aria-label="Visibility">
          <span className="form-label">Visibility</span>
          <label className="form-check">
            <input type="radio" name="visibility" checked={!isPublic} onChange={() => setPublic(false)} /> Private
          </label>
          <label className="form-check">
            <input type="radio" name="visibility" checked={isPublic} onChange={() => setPublic(true)} /> Public
          </label>
        </li>
      </ul>
      <p className="sheet-note">
        Private by default. Publishing creates the repository, adds it as <code>origin</code> and pushes your commits.
      </p>
    </Sheet>
  );
}
