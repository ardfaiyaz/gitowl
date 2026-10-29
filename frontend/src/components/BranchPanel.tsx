import { useEffect, useState } from "react";
import { api } from "../api";
import type { Repo } from "../types";
import { Dialog, Skeleton } from "./Dialog";
import { Diff } from "./Diff";

type Comparison = {
  base: string;
  target: string;
  ahead: number;
  behind: number;
  commits: { id: string; author: string; message: string }[];
  stat: string;
  text: string;
};

type BranchList = {
  local: { name: string; upstream: string; hash: string; subject: string }[];
  remote: {
    reference: string;
    name: string;
    localName: string;
    hash: string;
  }[];
  tags: string[];
};
type Action = (op: string, data?: object) => Promise<boolean>;
type Confirmation = {
  op: string;
  title: string;
  body: string;
  confirmLabel: string;
  data: object;
};

export function PublishDialog({
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
  const [remote, setRemote] = useState(
    repo.remoteNames.includes("origin") ? "origin" : repo.remoteNames[0] || "",
  );
  const [error, setError] = useState("");
  return (
    <Dialog title="Publish branch" busy={busy} onClose={onClose}>
      <p>
        This sends committed history from <strong>{repo.branch}</strong> to the
        selected remote and sets the destination for future pulls and pushes.
        Uncommitted changes stay here.
      </p>
      <label htmlFor="publish-remote">Remote</label>
      <select
        id="publish-remote"
        value={remote}
        onChange={(e) => setRemote(e.target.value)}
      >
        {repo.remoteNames.map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>
      {!remote && (
        <p className="inline-warning">
          No remote is configured. Add a remote in Settings before publishing.
        </p>
      )}
      <div className="destination-preview">
        <span>Destination</span>
        <strong>
          {remote || "No remote"} / {repo.branch}
        </strong>
        <pre>{repo.remotes || "Local repository only"}</pre>
      </div>
      {error && (
        <pre role="alert" className="inline-warning">
          {operationError || error}
        </pre>
      )}
      <div className="modal-footer">
        <button
          className="primary"
          disabled={busy || !remote || repo.branch === "Detached HEAD"}
          onClick={async () => {
            if (await action("publish", { remote, branch: repo.branch }))
              onClose();
            else
              setError(
                "Publishing did not finish. Check the operation error and your Git credentials, then retry.",
              );
          }}
        >
          {busy ? "Publishing…" : "Publish branch"}
        </button>
      </div>
    </Dialog>
  );
}

export function BranchPanel({
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
  const [list, setList] = useState<BranchList | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [base, setBase] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [tag, setTag] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [tagRemote, setTagRemote] = useState(
    repo.remoteNames.includes("origin") ? "origin" : repo.remoteNames[0] || "",
  );
  const [revision, setRevision] = useState(0);
  const [checkout, setCheckout] = useState<BranchList["remote"][number] | null>(
    null,
  );
  const [localName, setLocalName] = useState("");
  const [renaming, setRenaming] = useState<{ old: string; value: string } | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [dialogError, setDialogError] = useState("");
  const activeTagRemote = repo.remoteNames.includes(tagRemote)
    ? tagRemote
    : repo.remoteNames[0] || "";
  useEffect(() => {
    let active = true;
    api<BranchList>("branches", { repo: repo.path })
      .then((value) => {
        if (active) {
          setList(value);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [repo.path, repo.branch, repo.fingerprint, revision]);
  async function perform(op: string, data: object = {}) {
    const success = await action(op, data);
    if (success) setRevision((v) => v + 1);
    return success;
  }
  async function compare(target: string) {
    try {
      const value = await api<Comparison>("compare", {
        repo: repo.path,
        base: repo.branch,
        target,
      });
      setComparison({ ...value, base: repo.branch, target });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const matches = (name: string) =>
    name.toLowerCase().includes(query.toLowerCase());
  const local = list?.local.filter((b) => matches(b.name)) || [];
  const remote = list?.remote.filter((b) => matches(b.name)) || [];
  return (
    <section className="branch-workspace" aria-label="Branches and tags">
      <div className="branch-toolbar">
        <div>
          <label htmlFor="branch-search">Find a branch</label>
          <input
            id="branch-search"
            type="search"
            placeholder="Search local and remote branches"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button disabled={busy} onClick={() => void perform("fetch")}>
          Fetch remote branches
        </button>
      </div>
      {error && (
        <div className="inline-warning" role="alert">
          {error}
          <button onClick={() => setRevision((v) => v + 1)}>Retry</button>
        </div>
      )}
      <div className="branch-columns">
        <div className="branch-lists">
          <section className="branch-section">
            <h2>
              Local branches <span className="count">{local.length}</span>
            </h2>
            {!list ? (
              <Skeleton rows={3} label="Loading branches…" />
            ) : !local.length ? (
              <p>
                No matching local branches. A new repository needs its first
                commit before branches appear.
              </p>
            ) : (
              local.map((b) => (
                <div className="branch-item" key={b.name}>
                  <div className="branch-info">
                    <strong>{b.name}</strong>
                    <p>{b.upstream ? `Tracks ${b.upstream}` : "Local only"}</p>
                    <p className="branch-subject">
                      <code>{b.hash}</code> {b.subject}
                    </p>
                  </div>
                  <div className="branch-actions">
                    {b.name === repo.branch ? (
                      <>
                        <span className="badge">CURRENT</span>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setDialogError("");
                            setRenaming({ old: b.name, value: b.name });
                          }}
                        >
                          Rename…
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void perform("switch", { branch: b.name })
                          }
                        >
                          Switch
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void compare(b.name)}
                        >
                          Compare
                        </button>
                        <button
                          disabled={busy || repo.merging}
                          onClick={() => {
                            setDialogError("");
                            setConfirmation({
                              op: "merge",
                              title: "Merge branch",
                              body: `Merge ${b.name} into ${repo.branch}. Conflicting files will stay available for you to resolve.`,
                              confirmLabel: "Merge branches",
                              data: { branch: b.name },
                            });
                          }}
                        >
                          Merge
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setDialogError("");
                            setRenaming({ old: b.name, value: b.name });
                          }}
                        >
                          Rename…
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setDialogError("");
                            setConfirmation({
                              op: "branch_delete",
                              title: "Delete local branch",
                              body: `Delete ${b.name}? Git refuses to delete a branch that contains commits not merged elsewhere. Its remote-tracking branch is unchanged.`,
                              confirmLabel: "Delete branch",
                              data: { branch: b.name },
                            });
                          }}
                        >
                          Delete…
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
          <section className="branch-section">
            <h2>
              Remote branches <span className="count">{remote.length}</span>
            </h2>
            <p className="section-description">
              Fetched branches are a local snapshot. Fetch to get the latest
              list.
            </p>
            {list && !remote.length && (
              <p>
                No matching remote branches. Fetch from a configured remote to
                load them.
              </p>
            )}
            {remote.map((b) => (
              <div className="branch-item" key={b.reference}>
                <div className="branch-info">
                  <strong>{b.name}</strong>
                  <p>
                    <code>{b.hash}</code>
                  </p>
                </div>
                <button disabled={busy} onClick={() => void compare(b.name)}>
                  Compare
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setCheckout(b);
                    setLocalName(b.localName);
                    setDialogError("");
                  }}
                >
                  Check out…
                </button>
              </div>
            ))}
          </section>
        </div>
        <aside className="branch-tools">
          <section>
            <h2>Create branch</h2>
            <p>Start from the current commit, or another branch, tag or commit, and switch to it.</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await perform("create_branch", {
                    branch: newBranch.trim(),
                    base: base.trim(),
                  })
                ) {
                  setNewBranch("");
                  setBase("");
                }
              }}
            >
              <label htmlFor="new-branch">Branch name</label>
              <input
                id="new-branch"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="feature/my-change"
                required
              />
              <label htmlFor="new-branch-base">Start from (optional)</label>
              <input
                id="new-branch-base"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder={"Current commit on " + repo.branch}
                list="branch-bases"
              />
              <datalist id="branch-bases">
                {list?.local.map((b) => (
                  <option key={b.name} value={b.name} />
                ))}
                {list?.remote.map((b) => (
                  <option key={b.reference} value={b.name} />
                ))}
                {list?.tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <button className="primary" disabled={busy || !newBranch.trim()}>
                Create & switch
              </button>
            </form>
          </section>
          {repo.merging && (
            <section className="merge-state">
              <h2>Merge in progress</h2>
              <p>Resolve conflicts in Changes, then finish the merge commit.</p>
              <button
                disabled={busy}
                onClick={() => {
                  setDialogError("");
                  setConfirmation({
                    op: "merge_abort",
                    title: "Abort current merge",
                    body: "Return to the state before this merge. Any conflict-resolution edits made during this merge can be lost.",
                    confirmLabel: "Abort merge",
                    data: {},
                  });
                }}
              >
                Abort merge…
              </button>
            </section>
          )}
          <section>
            <h2>Version tags</h2>
            <p>
              Mark the current commit with a local tag and publish it when you
              are ready.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await perform("tag", {
                    tag: tag.trim(),
                    message: tagMessage.trim(),
                  })
                ) {
                  setTag("");
                  setTagMessage("");
                }
              }}
            >
              <label htmlFor="version-tag">Tag name</label>
              <input
                id="version-tag"
                placeholder="v0.1.0"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                required
              />
              <label htmlFor="tag-message">Annotation (optional)</label>
              <input
                id="tag-message"
                placeholder="Release notes"
                value={tagMessage}
                onChange={(e) => setTagMessage(e.target.value)}
              />
              <button disabled={busy || !tag.trim()}>Create tag</button>
            </form>
            {repo.remoteNames.length > 0 ? (
              <div className="tag-remote">
                <label htmlFor="tag-remote">Push tags to</label>
                <select
                  id="tag-remote"
                  value={activeTagRemote}
                  onChange={(e) => setTagRemote(e.target.value)}
                >
                  {repo.remoteNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="hint">
                Add a remote in Settings to push tags.
              </p>
            )}
            <ul className="tag-list">
              {list?.tags.map((t) => (
                <li key={t}>
                  <code>{t}</code>
                  <div className="tag-actions">
                    <button
                      disabled={busy || !activeTagRemote}
                      title={
                        activeTagRemote
                          ? `Push ${t} to ${activeTagRemote}`
                          : "Add a remote first"
                      }
                      onClick={() =>
                        void perform("tag_push", {
                          tag: t,
                          remote: activeTagRemote,
                        })
                      }
                    >
                      Push
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setDialogError("");
                        setConfirmation({
                          op: "tag_delete",
                          title: "Delete local tag",
                          body: `Delete ${t} from this repository? A tag already pushed to a remote is unchanged.`,
                          confirmLabel: "Delete tag",
                          data: { tag: t },
                        });
                      }}
                    >
                      Delete…
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {list && !list.tags.length && <p>No tags yet.</p>}
          </section>
        </aside>
      </div>
      {checkout && (
        <Dialog
          title="Check out remote branch"
          busy={busy}
          onClose={() => setCheckout(null)}
        >
          <p>
            Create a local branch tracking <strong>{checkout.name}</strong>. Git
            will preserve your edits or stop if switching would overwrite them.
          </p>
          <label htmlFor="checkout-name">New local branch name</label>
          <input
            id="checkout-name"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
          />
          {list?.local.some((b) => b.name === localName.trim()) && (
            <p className="inline-warning">
              That local name already exists. Choose another name, or close this
              dialog and switch to the existing branch.
            </p>
          )}
          {dialogError && (
            <p role="alert" className="inline-warning">
              {operationError || dialogError}
            </p>
          )}
          <div className="modal-footer">
            <button
              className="primary"
              disabled={
                busy ||
                !localName.trim() ||
                list?.local.some((b) => b.name === localName.trim())
              }
              onClick={async () => {
                if (
                  await perform("checkout_remote", {
                    reference: checkout.reference,
                    branch: localName.trim(),
                  })
                )
                  setCheckout(null);
                else
                  setDialogError(
                    "Checkout did not finish. Review the operation error, preserve any conflicting edits, and retry.",
                  );
              }}
            >
              Create tracking branch
            </button>
          </div>
        </Dialog>
      )}
      {renaming && (
        <Dialog
          title="Rename branch"
          busy={busy}
          onClose={() => setRenaming(null)}
        >
          <p>
            Rename <strong>{renaming.old}</strong>. Its commits, tracking
            configuration and remote branches are unchanged.
          </p>
          <label htmlFor="rename-branch">New branch name</label>
          <input
            id="rename-branch"
            value={renaming.value}
            onChange={(e) =>
              setRenaming({ ...renaming, value: e.target.value })
            }
          />
          {dialogError && (
            <p role="alert" className="inline-warning">
              {operationError || dialogError}
            </p>
          )}
          <div className="modal-footer">
            <button onClick={() => setRenaming(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !renaming.value.trim() ||
                renaming.value.trim() === renaming.old
              }
              onClick={async () => {
                if (
                  await perform("branch_rename", {
                    branch: renaming.old,
                    newName: renaming.value.trim(),
                  })
                )
                  setRenaming(null);
                else
                  setDialogError(
                    "The branch was not renamed. Review the Git message and retry.",
                  );
              }}
            >
              Rename branch
            </button>
          </div>
        </Dialog>
      )}
      {confirmation && (
        <Dialog
          alert="caution"
          title={confirmation.title}
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          <p>{confirmation.body}</p>
          {dialogError && (
            <p className="inline-warning" role="alert">
              {dialogError}
            </p>
          )}
          <div className="modal-footer">
            <button
              onClick={() => setConfirmation(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await perform(confirmation.op, confirmation.data)
                )
                  setConfirmation(null);
                else
                  setDialogError(
                    "The operation needs attention. Review the Git message and current repository state.",
                  );
              }}
            >
              {confirmation.confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
      {comparison && (
        <Dialog
          title={`Compare ${comparison.target} with ${comparison.base}`}
          wide
          onClose={() => setComparison(null)}
        >
          <p>
            <strong>{comparison.target}</strong> has {comparison.ahead} commit
            {comparison.ahead === 1 ? "" : "s"} not in {comparison.base}, and is{" "}
            {comparison.behind} behind it. The diff shows what merging would
            bring in.
          </p>
          <ul className="thread">
            {comparison.commits.map((c) => (
              <li key={c.id}>
                <code>{c.id.slice(0, 8)}</code> {c.message} <small>{c.author}</small>
              </li>
            ))}
          </ul>
          <pre className="hint">{comparison.stat}</pre>
          <div className="github-diff">
            <Diff text={comparison.text} />
          </div>
        </Dialog>
      )}
    </section>
  );
}
