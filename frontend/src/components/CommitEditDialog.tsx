import { useEffect, useState } from "react";
import { api } from "../api";
import { Dialog, Skeleton } from "./Dialog";

type Preview = {
  head: string;
  branch: string;
  target?: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  blocked: string[];
  staged?: string[];
  fingerprint?: string;
  commits?: { id: string; message: string }[];
  otherBranches?: string[];
};
type Saved = {
  head: string;
  branch: string;
  recovery: string;
  message: string;
};
// Edits the latest commit (git commit --amend) or, with `commit`, rewrites an older commit on the branch.
export function CommitEditDialog({
  repo,
  commit,
  busy,
  run,
  onUpdated,
  onClose,
}: {
  repo: string;
  commit?: string;
  busy: boolean;
  run: (work: () => Promise<void>) => Promise<boolean>;
  onUpdated: () => Promise<void>;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [committerName, setCommitterName] = useState("");
  const [committerEmail, setCommitterEmail] = useState("");
  const [includeStaged, setIncludeStaged] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [restored, setRestored] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const request = commit
      ? api<Preview>("rewrite_preview", { repo, target: commit })
      : api<Preview>("commit_edit_preview", { repo, includeStaged });
    request
      .then((value) => {
        if (!active) return;
        setPreview(value);
        setMessage(value.message);
        setName(value.authorName);
        setEmail(value.authorEmail);
        setCommitterName(value.committerName);
        setCommitterEmail(value.committerEmail);
        setError("");
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [repo, commit, includeStaged, attempt]);
  async function submit() {
    setError("");
    await run(async () => {
      try {
        const value = commit
          ? await api<Saved>("rewrite_edit", {
              repo,
              head: preview?.head,
              branch: preview?.branch,
              target: preview?.target,
              message,
              authorName: name,
              authorEmail: email,
              committerName,
              committerEmail,
            })
          : await api<Saved>("commit_edit", {
              repo,
              head: preview?.head,
              branch: preview?.branch,
              message,
              authorName: name,
              authorEmail: email,
              includeStaged,
              fingerprint: preview?.fingerprint,
            });
        setSaved(value);
        await onUpdated();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }
  const changed =
    preview &&
    (includeStaged ||
      message !== preview.message ||
      name !== preview.authorName ||
      email !== preview.authorEmail ||
      (commit &&
        (committerName !== preview.committerName ||
          committerEmail !== preview.committerEmail)));
  const count = preview?.commits?.length || 1;
  const title = commit ? "Edit commit" : "Edit latest commit";
  return (
    <Dialog title={title} wide busy={busy} onClose={onClose}>
      {error && (
        <pre className="inline-warning" role="alert">
          {error}
        </pre>
      )}
      {!preview && !error && <Skeleton rows={4} label="Loading commit details…" />}
      {!preview && error && (
        <button
          disabled={busy}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry preview
        </button>
      )}
      {saved ? (
        <div className="commit-edit-result">
          <h3>
            {restored ? "Previous history restored" : "Commit details updated"}
          </h3>
          <p role="status">
            {restored
              ? "The branch points to the original commits again."
              : "Rewritten commits have new hashes. A recovery point keeps the original history available in Settings → Recovery points."}
          </p>
          <dl>
            <dt>Original branch tip</dt>
            <dd>
              <code>{preview?.head}</code>
            </dd>
            <dt>New branch tip</dt>
            <dd>
              <code>{saved.head}</code>
            </dd>
            <dt>Recovery point</dt>
            <dd>
              <code>{saved.recovery}</code>
            </dd>
          </dl>
          {!restored && !includeStaged && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  try {
                    await api(
                      commit ? "rewrite_restore" : "commit_edit_restore",
                      { repo, ...saved },
                    );
                    setRestored(true);
                    setError("");
                    await onUpdated();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                })
              }
            >
              Restore previous history
            </button>
          )}
          <div className="modal-footer">
            <button className="primary" onClick={onClose} disabled={busy}>
              Done
            </button>
          </div>
        </div>
      ) : (
        preview && (
          <>
            <div className="commit-edit-intro">
              <p>
                {commit ? "Rewrite a commit on " : "Update the latest commit on "}
                <strong>{preview.branch.replace("refs/heads/", "")}</strong>.{" "}
                {includeStaged
                  ? "Staged changes are added to the commit."
                  : "File content stays the same."}{" "}
                Git creates new commit hashes.
              </p>
              <code>{preview.target || preview.head}</code>
            </div>
            {!commit && (
              <label className="confirmation-check">
                <input
                  type="checkbox"
                  checked={includeStaged}
                  disabled={busy}
                  onChange={(e) => {
                    setIncludeStaged(e.target.checked);
                    setAcknowledged(false);
                  }}
                />
                Also add my staged changes to this commit (amend content)
              </label>
            )}
            {includeStaged && !!preview.staged?.length && (
              <p className="commit-edit-note">
                Staged files: {preview.staged.join(", ")}. Unstaged edits stay
                in your working tree.
              </p>
            )}
            {commit && count > 1 && (
              <details className="affected" open>
                <summary>
                  {count} commits get new hashes (this one and{" "}
                  {count - 1} newer)
                </summary>
                <ul>
                  {preview.commits!.map((c) => (
                    <li key={c.id}>
                      <code>{c.id.slice(0, 8)}</code> {c.message}
                    </li>
                  ))}
                </ul>
                <p className="commit-edit-note">
                  Newer commits keep their files, authors, committers and dates.
                </p>
              </details>
            )}
            {!!preview.otherBranches?.length && (
              <p className="commit-edit-note">
                Other local branches also contain this commit and will keep the
                old version: {preview.otherBranches.join(", ")}.
              </p>
            )}
            {preview.blocked.length > 0 && (
              <div className="inline-warning" role="status">
                <strong>Editing is currently unavailable</strong>
                <ul>
                  {preview.blocked.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <button
                  disabled={busy}
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Refresh preview
                </button>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <fieldset
                disabled={busy || preview.blocked.length > 0}
                className="commit-edit-fields"
              >
                <div>
                  <label htmlFor="edit-message">Commit message</label>
                  <textarea
                    id="edit-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={7}
                    required
                  />
                  <details>
                    <summary>Original message</summary>
                    <pre>{preview.message}</pre>
                  </details>
                </div>
                <div>
                  <h3>Author</h3>
                  <p>
                    The person credited with writing this change. This does not
                    change GitHub authentication.
                  </p>
                  <label htmlFor="edit-author-name">Author name</label>
                  <input
                    id="edit-author-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                  <label htmlFor="edit-author-email">Author email</label>
                  <input
                    id="edit-author-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    required
                  />
                  {commit ? (
                    <>
                      <h3>Committer</h3>
                      <p>
                        The person who applied the commit. Dates are kept.
                      </p>
                      <label htmlFor="edit-committer-name">
                        Committer name
                      </label>
                      <input
                        id="edit-committer-name"
                        value={committerName}
                        onChange={(e) => setCommitterName(e.target.value)}
                        required
                      />
                      <label htmlFor="edit-committer-email">
                        Committer email
                      </label>
                      <input
                        id="edit-committer-email"
                        value={committerEmail}
                        onChange={(e) => setCommitterEmail(e.target.value)}
                        type="email"
                        required
                      />
                      <p className="commit-edit-note">
                        Your commit-msg hook checks the new message and the
                        post-rewrite hook is told which commits changed, as
                        with git rebase. Commits are signed when
                        commit.gpgSign is enabled. Merge commits keep their
                        merges.
                      </p>
                    </>
                  ) : (
                    <p className="commit-edit-note">
                      Previous committer: {preview.committerName} &lt;
                      {preview.committerEmail}&gt;. Git records the current
                      committing identity and a new committer timestamp when
                      saving. Configured hooks and signing still run.
                    </p>
                  )}
                </div>
              </fieldset>
              <p className="commit-edit-note">
                Publication checks use fetched remote branches. Fetch first if
                another machine or person may have pushed this commit.
              </p>
              <label className="confirmation-check">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  disabled={busy || preview.blocked.length > 0}
                />
                I understand this replaces {count === 1 ? "this commit" : `${count} commits`}{" "}
                and changes {count === 1 ? "its hash" : "their hashes"}.
              </label>
              <div className="modal-footer">
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    busy ||
                    !changed ||
                    !acknowledged ||
                    preview.blocked.length > 0 ||
                    !message.trim() ||
                    !name.trim() ||
                    !email.trim()
                  }
                >
                  {busy ? "Saving…" : "Save commit details"}
                </button>
              </div>
            </form>
          </>
        )
      )}
    </Dialog>
  );
}
