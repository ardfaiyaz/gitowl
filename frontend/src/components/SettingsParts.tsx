import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { ago } from "../ago";
import { Dialog, Skeleton } from "./Dialog";
import { Sheet } from "./RepoDialogs";

type Action = (op: string, data?: object) => Promise<boolean>;
const agoIso = (iso: string) => ago(String(Date.parse(iso) / 1000));
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Loads `op` once per key; `reload()` refetches after a change.
function useLoad<T>(op: string, data: object, key: string) {
  const [state, setState] = useState<{ key: string; value?: T; error?: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const full = key + "\n" + revision;
  useEffect(() => {
    let active = true;
    api<T>(op, data)
      .then((value) => active && setState({ key: full, value }))
      .catch((e) => active && setState({ key: full, error: fail(e) }));
    return () => {
      active = false;
    };
    // data is described by key; listing it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, full]);
  const ready = state?.key === full;
  return { value: ready ? state.value : undefined, error: ready ? state.error : undefined, loading: !ready, reload: () => setRevision((v) => v + 1) };
}

function Group({ title, children, danger = false }: { title: string; children: ReactNode; danger?: boolean }) {
  return (
    <section>
      <h2 className={danger ? "danger-title" : undefined}>{title}</h2>
      <div className={"settings-group" + (danger ? " danger" : "")}>{children}</div>
    </section>
  );
}
function Row({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="settings-row">
      <span>
        {label}
        {sub && <small>{sub}</small>}
      </span>
      {children}
    </div>
  );
}
const Loading = ({ error }: { error?: string }) =>
  error ? <pre className="inline-warning settings-error">{error}</pre> : <Skeleton rows={2} label="Loading…" />;

// General: sidebar rail, code editor and the diff/merge tools from Git config.
export function GeneralExtras({
  repo,
  rail,
  onRail,
  editor,
  onEditor,
}: {
  repo: string;
  rail: boolean;
  onRail: (v: boolean) => void;
  editor: string;
  onEditor: (v: string) => void;
}) {
  const tools = useLoad<{ diff: string; merge: string }>("tools", { repo }, repo);
  const custom = editor !== "code" && editor !== "zed";
  return (
    <>
      <Group title="Sidebar">
        <label className="settings-row">
          <span>
            Collapse sidebar to icons<small>Ctrl B</small>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={rail} onChange={(e) => onRail(e.target.checked)} />
        </label>
      </Group>
      <Group title="Editor & tools">
        <Row label={<label htmlFor="set-editor">Code editor</label>} sub={custom ? "Path or name of the program; it gets the repository folder." : undefined}>
          <select id="set-editor" value={custom ? "custom" : editor} onChange={(e) => onEditor(e.target.value === "custom" ? "" : e.target.value)}>
            <option value="code">Visual Studio Code</option>
            <option value="zed">Zed</option>
            <option value="custom">Custom command…</option>
          </select>
        </Row>
        {custom && (
          <Row label={<label htmlFor="set-editor-path">Program</label>}>
            <input id="set-editor-path" value={editor} placeholder="C:\Program Files\Sublime Text\subl.exe" onChange={(e) => onEditor(e.target.value)} />
          </Row>
        )}
        <Row label="Diff and merge tool" sub="From your Git config (diff.tool / merge.tool)">
          <code>{tools.value ? [tools.value.diff || "none", tools.value.merge].filter(Boolean).join(" / ") : "…"}</code>
        </Row>
      </Group>
    </>
  );
}

// Accounts & signing: the GitHub CLI account, commit signing and keys on GitHub.
export function AccountsPane({ repo, busy, action }: { repo: string; busy: boolean; action: Action }) {
  const status = useLoad<{ signedIn: boolean; detail: string }>("gh_status", { repo }, repo);
  const signing = useLoad<{ enabled: boolean; format: string; key: string; suggested: string | null }>("signing_status", { repo }, repo);
  const keys = useLoad<{ ssh: number | null; signing: number | null; gpg: number | null }>("gh_keys", { repo }, repo);
  const [signingOut, setSigningOut] = useState(false);
  const login = /Logged in to \S+ (?:account|as) ([\w-]+)/.exec(status.value?.detail || "")?.[1];
  const count = (n: number | null | undefined, label: string) => (n == null ? "Needs the matching gh scope" : `${n} ${label}`);
  const s = signing.value;
  return (
    <>
      <Group title="Account">
        {!status.value ? (
          <Loading error={status.error} />
        ) : status.value.signedIn ? (
          <Row label={<><strong>{login || "Signed in"}</strong> on github.com</>} sub="GitHub CLI account · token in the OS keychain">
            <span className="ok-pill">Active</span>
            <button className="small" disabled={busy} onClick={() => setSigningOut(true)}>
              Sign out
            </button>
          </Row>
        ) : (
          <Row label="Not signed in" sub="Sign in from the GitHub page to use pull requests, issues and Actions." />
        )}
      </Group>
      <Group title="Signing & keys">
        {!s ? (
          <Loading error={signing.error} />
        ) : (
          <label className="settings-row">
            <span>
              Sign commits
              <small>
                {s.key ? `${s.format === "ssh" ? "SSH key" : "Key"} ${s.key}` : s.suggested ? `Will use ${s.suggested}` : "No key yet: create one with ssh-keygen -t ed25519"} · applies to every repository
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              disabled={busy}
              checked={s.enabled}
              onChange={(e) => void action("signing_set", { enable: e.target.checked }).then(() => signing.reload())}
            />
          </label>
        )}
        <Row label="SSH keys on GitHub" sub={keys.value ? `${count(keys.value.ssh, "authentication")} · ${count(keys.value.signing, "signing")}` : "…"}>
          <button className="small" onClick={() => void action("open_in", { target: "url", url: "https://github.com/settings/keys" })}>
            Manage
          </button>
        </Row>
        <Row label="GPG keys on GitHub" sub={keys.value ? (keys.value.gpg == null ? count(null, "") : keys.value.gpg ? `${keys.value.gpg} key${keys.value.gpg === 1 ? "" : "s"}` : "None") : "…"}>
          <button className="small" onClick={() => void action("open_in", { target: "url", url: "https://github.com/settings/gpg/new" })}>
            Add
          </button>
        </Row>
      </Group>
      {signingOut && (
        <Dialog alert="destructive" title="Sign out of GitHub CLI?" busy={busy} onClose={() => setSigningOut(false)}>
          <p>This signs the GitHub CLI out on this computer, including in your terminal.</p>
          <div className="modal-footer">
            <button onClick={() => setSigningOut(false)} disabled={busy}>
              Cancel
            </button>
            <button className="primary destructive" disabled={busy} onClick={async () => (await action("gh_logout")) && (setSigningOut(false), status.reload())}>
              Sign out
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

type Named = { name: string; updatedAt?: string; value?: string };
// Secrets are write-only: values go to GitHub and are never shown, logged or stored here.
export function SecretsPane({ repo, busy, action }: { repo: string; busy: boolean; action: Action }) {
  const data = useLoad<{ secrets: Named[]; variables: Named[] }>("gh_secrets", { repo }, repo);
  const [editing, setEditing] = useState<{ kind: "secret" | "variable"; name: string; value: string; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "secret" | "variable"; name: string } | null>(null);
  if (!data.value) return <Loading error={data.error} />;
  const save = async () => {
    if (!editing) return;
    if (await action(editing.kind === "secret" ? "gh_secret_set" : "gh_variable_set", { name: editing.name, value: editing.value })) {
      setEditing(null);
      data.reload();
    }
  };
  return (
    <>
      <section>
        <h2>Secrets</h2>
        <div className="settings-group">
          {data.value.secrets.map((s) => (
            <Row key={s.name} label={<code>{s.name}</code>} sub={s.updatedAt ? "Updated " + agoIso(s.updatedAt) + " · repository" : "repository"}>
              <button className="small" disabled={busy} onClick={() => setEditing({ kind: "secret", name: s.name, value: "", isNew: false })}>
                Replace
              </button>
              <button className="small destructive-text" disabled={busy} onClick={() => setDeleting({ kind: "secret", name: s.name })}>
                Delete
              </button>
            </Row>
          ))}
          <Row label={data.value.secrets.length ? "" : <span className="hint">No secrets yet.</span>}>
            <button className="small" disabled={busy} onClick={() => setEditing({ kind: "secret", name: "", value: "", isNew: true })}>
              + New secret
            </button>
          </Row>
        </div>
        <p className="hint settings-caption">Secret values are write-only. gitowl never shows, logs or stores them; they go straight to GitHub.</p>
      </section>
      <Group title="Variables">
        {data.value.variables.map((v) => (
          <Row key={v.name} label={<code>{v.name}</code>}>
            <code className="settings-value">{v.value}</code>
            <button className="small" disabled={busy} onClick={() => setEditing({ kind: "variable", name: v.name, value: v.value ?? "", isNew: false })}>
              Edit
            </button>
            <button className="small destructive-text" disabled={busy} onClick={() => setDeleting({ kind: "variable", name: v.name })}>
              Delete
            </button>
          </Row>
        ))}
        <Row label={data.value.variables.length ? "" : <span className="hint">No variables yet.</span>}>
          <button className="small" disabled={busy} onClick={() => setEditing({ kind: "variable", name: "", value: "", isNew: true })}>
            + New variable
          </button>
        </Row>
      </Group>
      {editing && (
        <Sheet
          title={(editing.isNew ? "New " : editing.kind === "secret" ? "Replace " : "Edit ") + editing.kind}
          action="Save"
          busy={busy}
          disabled={!editing.name || (editing.kind === "secret" && !editing.value)}
          onClose={() => setEditing(null)}
          onSubmit={() => void save()}
        >
          <ul className="grouped-list form-rows">
            <li>
              <label htmlFor="sv-name">Name</label>
              <input id="sv-name" value={editing.name} disabled={!editing.isNew} onChange={(e) => setEditing({ ...editing, name: e.target.value.toUpperCase() })} placeholder="CARGO_REGISTRY_TOKEN" />
            </li>
            <li>
              <label htmlFor="sv-value">Value</label>
              <input
                id="sv-value"
                type={editing.kind === "secret" ? "password" : "text"}
                autoComplete="off"
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              />
            </li>
          </ul>
          <p className="sheet-note">
            {editing.kind === "secret" ? "The value is sent to GitHub through the GitHub CLI's standard input and can't be read back." : "Variables are visible to anyone who can read this repository's Actions."}
          </p>
        </Sheet>
      )}
      {deleting && (
        <Dialog alert="destructive" title={`Delete ${deleting.kind} ${deleting.name}?`} busy={busy} onClose={() => setDeleting(null)}>
          <p>Workflows that use it will fail until you add it again.</p>
          <div className="modal-footer">
            <button onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={async () => {
                if (await action(deleting.kind === "secret" ? "gh_secret_delete" : "gh_variable_delete", { name: deleting.name })) {
                  setDeleting(null);
                  data.reload();
                }
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

type RepoInfo = {
  info: {
    nameWithOwner: string;
    description: string;
    repositoryTopics: { name: string }[] | null;
    visibility: string;
    isArchived: boolean;
    isFork: boolean;
    parent: { owner?: { login: string }; name?: string } | null;
    viewerPermission: string;
  };
  rulesets: { name: string; enforcement: string; target?: string }[];
};
type Label = { name: string; color: string };
type Danger = "visibility" | "archive" | "delete";

// Repository & danger zone: description, topics, fork target, rulesets, labels; then the irreversible actions.
export function RepoPane({ repo, busy, action }: { repo: string; busy: boolean; action: Action }) {
  const data = useLoad<RepoInfo>("gh_repo_info", { repo }, repo);
  const [sheet, setSheet] = useState<"description" | "topics" | "labels" | null>(null);
  const [danger, setDanger] = useState<Danger | null>(null);
  const [text, setText] = useState("");
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [newLabel, setNewLabel] = useState({ name: "", color: "#0075ca" });
  const [typed, setTyped] = useState("");
  if (!data.value) return <Loading error={data.error} />;
  const { info, rulesets } = data.value;
  const topics = (info.repositoryTopics || []).map((t) => t.name);
  const admin = info.viewerPermission === "ADMIN";
  const run = async (op: string, payload: object = {}) => {
    const ok = await action(op, payload);
    if (ok) data.reload();
    return ok;
  };
  const openLabels = () => {
    setSheet("labels");
    api<{ labels: Label[] }>("gh_pr_options", { repo })
      .then((v) => setLabels(v.labels))
      .catch(() => setLabels([]));
  };
  const nextVisibility = info.visibility === "PUBLIC" ? "private" : "public";
  return (
    <>
      <Group title="Repository">
        <Row label="Description" sub={info.description || "None"}>
          <button className="small" disabled={busy || !admin} onClick={() => (setText(info.description || ""), setSheet("description"))}>
            Edit
          </button>
        </Row>
        <Row label="Topics" sub={topics.length ? topics.join(" · ") : "None"}>
          <button className="small" disabled={busy || !admin} onClick={() => (setText(""), setSheet("topics"))}>
            Edit
          </button>
        </Row>
        <Row label="Fork behavior" sub="Where new pull requests and issues go">
          <span className="hint">{info.isFork ? `Parent repository (${info.parent?.owner?.login}/${info.parent?.name})` : "This repository"}</span>
        </Row>
        <Row label="Rulesets" sub={rulesets.length ? rulesets.map((r) => `${r.name} (${r.enforcement})`).join(" · ") : "None"}>
          <button className="small" onClick={() => void action("gh_browse_settings")}>
            View
          </button>
        </Row>
        <Row label="Labels">
          <button className="small" disabled={busy} onClick={openLabels}>
            Manage
          </button>
        </Row>
      </Group>
      {admin && (
        <Group title="Danger zone" danger>
          <Row label="Change visibility" sub={`Currently ${info.visibility.toLowerCase()}`}>
            <button className="small" disabled={busy} onClick={() => setDanger("visibility")}>
              Make {nextVisibility}…
            </button>
          </Row>
          <Row label="Archive repository" sub={info.isArchived ? "Already archived" : "Read-only for everyone"}>
            <button className="small" disabled={busy || info.isArchived} onClick={() => setDanger("archive")}>
              Archive…
            </button>
          </Row>
          <Row label="Delete repository" sub={`Type ${info.nameWithOwner} to confirm. This can't be undone.`}>
            <button className="small primary destructive" disabled={busy} onClick={() => (setTyped(""), setDanger("delete"))}>
              Delete…
            </button>
          </Row>
        </Group>
      )}
      {!admin && <p className="hint settings-caption">Editing and the danger zone need admin access to {info.nameWithOwner}.</p>}
      {sheet === "description" && (
        <Sheet title="Description" action="Save" busy={busy} disabled={text === (info.description || "")} onClose={() => setSheet(null)} onSubmit={() => void run("gh_repo_edit", { description: text }).then((ok) => ok && setSheet(null))}>
          <ul className="grouped-list form-rows">
            <li>
              <label htmlFor="rp-desc">Description</label>
              <input id="rp-desc" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
            </li>
          </ul>
        </Sheet>
      )}
      {sheet === "topics" && (
        <Sheet title="Topics" action="Add" busy={busy} disabled={!text.trim()} onClose={() => setSheet(null)} onSubmit={() => void run("gh_repo_edit", { addTopic: text }).then((ok) => ok && setText(""))}>
          <div className="co-authors">
            {topics.map((t) => (
              <button key={t} type="button" className="chip" disabled={busy} aria-label={"Remove topic " + t} onClick={() => void run("gh_repo_edit", { removeTopic: t })}>
                {t}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            ))}
            {!topics.length && <span className="hint">No topics yet.</span>}
          </div>
          <ul className="grouped-list form-rows">
            <li>
              <label htmlFor="rp-topic">New topic</label>
              <input id="rp-topic" autoFocus value={text} onChange={(e) => setText(e.target.value.toLowerCase())} placeholder="rust" />
            </li>
          </ul>
          <p className="sheet-note">Lowercase letters, digits and hyphens. Click a topic to remove it.</p>
        </Sheet>
      )}
      {sheet === "labels" && (
        <Sheet
          title="Labels"
          action="Add"
          busy={busy}
          disabled={!newLabel.name.trim()}
          onClose={() => setSheet(null)}
          onSubmit={() =>
            void action("gh_label_create", newLabel).then((ok) => {
              if (ok) {
                setNewLabel({ name: "", color: newLabel.color });
                openLabels();
              }
            })
          }
        >
          {!labels ? (
            <Skeleton rows={3} label="Loading labels…" />
          ) : (
            <ul className="grouped-list label-list">
              {labels.map((l) => (
                <li key={l.name}>
                  <span className="label-dot" style={{ background: "#" + l.color }} aria-hidden="true" />
                  <span className="label-name">{l.name}</span>
                  <button type="button" className="small destructive-text" disabled={busy} onClick={() => void action("gh_label_delete", { name: l.name }).then((ok) => ok && openLabels())}>
                    Delete
                  </button>
                </li>
              ))}
              {!labels.length && <li className="hint">No labels.</li>}
            </ul>
          )}
          <ul className="grouped-list form-rows">
            <li>
              <label htmlFor="lb-name">New label</label>
              <input id="lb-name" value={newLabel.name} onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })} placeholder="needs-triage" />
              <input type="color" aria-label="Label colour" value={newLabel.color} onChange={(e) => setNewLabel({ ...newLabel, color: e.target.value })} />
            </li>
          </ul>
        </Sheet>
      )}
      {danger && (
        <Dialog
          alert="destructive"
          title={danger === "visibility" ? `Make ${info.nameWithOwner} ${nextVisibility}?` : danger === "archive" ? `Archive ${info.nameWithOwner}?` : `Delete ${info.nameWithOwner}?`}
          busy={busy}
          onClose={() => setDanger(null)}
        >
          <p>
            {danger === "visibility"
              ? nextVisibility === "public"
                ? "Everyone on the internet will be able to see its code, issues and history."
                : "Stars and watchers outside your organization are removed, and forks stay public."
              : danger === "archive"
                ? "Everyone, you included, can only read it. You can unarchive it on GitHub."
                : "Its issues, pull requests, wiki and settings are deleted on GitHub. Your local copy is unchanged."}
          </p>
          {danger === "delete" && (
            <label className="alert-confirm">
              Type <strong>{info.nameWithOwner}</strong> to confirm
              <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={"Type " + info.nameWithOwner + " to confirm"} />
            </label>
          )}
          <div className="modal-footer">
            <button onClick={() => setDanger(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary destructive"
              disabled={busy || (danger === "delete" && typed !== info.nameWithOwner)}
              onClick={async () => {
                const ok =
                  danger === "visibility"
                    ? await run("gh_repo_visibility", { visibility: nextVisibility })
                    : danger === "archive"
                      ? await run("gh_repo_archive")
                      : await action("gh_repo_delete", { confirm: typed });
                if (ok) setDanger(null);
              }}
            >
              {danger === "visibility" ? `Make ${nextVisibility}` : danger === "archive" ? "Archive" : "Delete"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
