import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../api";
import { Dialog, Skeleton } from "./Dialog";
import { Segmented } from "./Segmented";
import { Sheet } from "./RepoDialogs";

type Action = (op: string, data?: object) => Promise<boolean>;
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Co-authors become "Co-authored-by: Name <email>" trailers on the commit.
export function CoAuthors({ value, onChange, busy }: { value: string[]; onChange: (next: string[]) => void; busy: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const valid = !!draft && /^[^<>\n]+ <[^<>\s]+@[^<>\s]+>$/.test(draft.trim());
  const add = () => {
    if (!valid) return;
    onChange([...new Set([...value, draft!.trim()])]);
    setDraft(null);
  };
  return (
    <div className="co-authors">
      <span className="hint">Co-authors</span>
      {value.map((person) => (
        <button key={person} type="button" className="chip" disabled={busy} aria-label={"Remove co-author " + person} title={person} onClick={() => onChange(value.filter((p) => p !== person))}>
          {person.replace(/ <.*$/, "")}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      ))}
      {draft === null ? (
        <button type="button" className="small" disabled={busy} onClick={() => setDraft("")}>
          + Add
        </button>
      ) : (
        <span className="co-author-add">
          <input
            autoFocus
            aria-label="Co-author as Name <email>"
            placeholder="Mia Santos <mia@example.com>"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(null);
              }
            }}
          />
          <button type="button" className="small" disabled={!valid} onClick={add}>
            Add
          </button>
        </span>
      )}
    </div>
  );
}

// Clean shows the exact untracked paths first; only the ticked ones are removed.
export function CleanDialog({ repo, busy, action, onClose }: { repo: string; busy: boolean; action: Action; onClose: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ files: string[] }>("clean_preview", { repo })
      .then((v) => {
        if (!active) return;
        setFiles(v.files);
        setPicked(v.files);
      })
      .catch((e) => active && setError(fail(e)));
    return () => {
      active = false;
    };
  }, [repo]);
  return (
    <Dialog alert="destructive" title="Remove untracked files?" busy={busy} onClose={onClose}>
      <p>These files aren't in Git, so removing them can't be undone. Ignored files are never touched.</p>
      {error && <pre className="modal-error">{error}</pre>}
      {!files && !error && <Skeleton rows={2} label="Listing untracked files…" />}
      {files && (
        <ul className="grouped-list alert-list">
          {files.map((f) => (
            <li key={f}>
              <label>
                <input type="checkbox" checked={picked.includes(f)} onChange={(e) => setPicked(e.target.checked ? [...picked, f] : picked.filter((p) => p !== f))} />
                <code>{f}</code>
              </label>
            </li>
          ))}
          {!files.length && <li>Nothing to remove.</li>}
        </ul>
      )}
      <div className="modal-footer">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="primary destructive" disabled={busy || !picked.length} onClick={async () => (await action("clean", { files: picked })) && onClose()}>
          Remove {picked.length || ""}
        </button>
      </div>
    </Dialog>
  );
}

type ForcePreview = { upstream: string; branch: string; lost: { id: string; message: string }[]; isDefault: boolean };
// Offered only after a rejected push; --force-with-lease stops if anyone pushed since the last fetch.
export function ForcePushDialog({ repo, busy, action, onClose }: { repo: string; busy: boolean; action: Action; onClose: () => void }) {
  const [preview, setPreview] = useState<ForcePreview | null>(null);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  useEffect(() => {
    let active = true;
    api<ForcePreview>("force_push_preview", { repo })
      .then((v) => active && setPreview(v))
      .catch((e) => active && setError(fail(e)));
    return () => {
      active = false;
    };
  }, [repo]);
  const n = preview?.lost.length ?? 0;
  return (
    <Dialog
      alert="destructive"
      title={preview ? `Replace ${n} commit${n === 1 ? "" : "s"} on ${preview.upstream}?` : "Force push"}
      busy={busy}
      onClose={onClose}
    >
      {error && <pre className="modal-error">{error}</pre>}
      {!preview && !error && <Skeleton rows={2} label="Checking the remote branch…" />}
      {preview && (
        <>
          <p>{n ? "You rewrote history. These remote commits will be replaced:" : "The remote has no commits you'd lose; your rewritten history replaces it."}</p>
          {!!n && (
            <ul className="grouped-list alert-list">
              {preview.lost.map((c) => (
                <li key={c.id}>
                  <code>{c.id}</code> {c.message}
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            Uses <code>--force-with-lease</code>: if anyone pushed since your last fetch, it stops instead of deleting their work.
          </p>
          {preview.isDefault && (
            <label className="alert-confirm">
              Type <strong>{preview.branch}</strong> to confirm
              <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={"Type " + preview.branch + " to confirm"} />
            </label>
          )}
        </>
      )}
      <div className="modal-footer">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary destructive"
          disabled={busy || !preview || (preview.isDefault && typed !== preview.branch)}
          onClick={async () => (await action("force_push", { confirm: typed })) && onClose()}
        >
          Force push
        </button>
      </div>
    </Dialog>
  );
}

type Side = { url: string; bytes: number } | null;
const kb = (bytes: number) => (bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB");

// Before / after for images: side by side, a swipe divider, or onion skin (board: Changes).
export function ImageDiff({ repo, file, mode, busy, action }: { repo: string; file: string; mode: string; busy: boolean; action: Action }) {
  const [pair, setPair] = useState<{ key: string; old: Side; new: Side; error?: string } | null>(null);
  const [view, setView] = useState<"side" | "swipe" | "onion">("side");
  const [amount, setAmount] = useState(50);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const key = [repo, file, mode].join("\n");
  useEffect(() => {
    let active = true;
    api<{ old: Side; new: Side }>("image_pair", { repo, file, mode })
      .then((v) => active && setPair({ key, ...v }))
      .catch((e) => active && setPair({ key, old: null, new: null, error: fail(e) }));
    return () => {
      active = false;
    };
  }, [repo, file, mode, key]);
  const shot = (side: "old" | "new", style?: CSSProperties) => {
    const s = pair?.[side];
    return s ? (
      <img
        className={"image-shot " + side}
        src={s.url}
        alt={(side === "old" ? "Before: " : "After: ") + file}
        style={style}
        onLoad={(e) => {
          // Read now: React clears currentTarget before a deferred updater runs.
          const size = `${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`;
          setSizes((v) => ({ ...v, [side]: size }));
        }}
      />
    ) : (
      <div className={"image-shot missing " + side}>{side === "old" ? "No earlier version" : "Deleted"}</div>
    );
  };
  const caption = (side: "old" | "new") =>
    [side === "old" ? "Before" : "After", sizes[side], pair?.[side] && kb(pair[side]!.bytes)].filter(Boolean).join(" · ");
  return (
    <div className="image-diff">
      <div className="diff-options">
        <Segmented
          label="Image comparison"
          value={view}
          options={[
            ["side", "Side by side"],
            ["swipe", "Swipe"],
            ["onion", "Onion skin"],
          ]}
          onChange={setView}
        />
        <button disabled={busy} onClick={() => void action("difftool", { file, mode })}>
          Open in diff tool
        </button>
      </div>
      {pair?.key !== key ? (
        <Skeleton rows={3} label="Loading images…" />
      ) : pair.error ? (
        <pre className="inline-warning">{pair.error}</pre>
      ) : (
        <div className="gh-card image-card">
          {view === "side" ? (
            <div className="image-pair">
              <figure>
                <div className="image-stage">{shot("old")}</div>
                <figcaption>{caption("old")}</figcaption>
              </figure>
              <figure>
                <div className="image-stage">{shot("new")}</div>
                <figcaption>{caption("new")}</figcaption>
              </figure>
            </div>
          ) : (
            <figure>
              <div className="image-stage layered">
                {shot("old")}
                {shot("new", view === "swipe" ? { clipPath: `inset(0 0 0 ${amount}%)` } : { opacity: amount / 100 })}
                {view === "swipe" && <span className="swipe-line" style={{ left: amount + "%" }} aria-hidden="true" />}
              </div>
              <label className="image-slider">
                {view === "swipe" ? "Divider" : "After opacity"}
                <input type="range" min={0} max={100} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                <span>{amount}%</span>
              </label>
            </figure>
          )}
        </div>
      )}
    </div>
  );
}

// Moving work off a protected branch: new branch from here, uncommitted changes come along.
export function NewBranchSheet({ busy, action, onClose }: { busy: boolean; action: Action; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <Sheet title="Create Branch" action="Create" busy={busy} disabled={!name.trim()} onClose={onClose} onSubmit={() => void action("create_branch", { branch: name.trim() }).then((ok) => ok && onClose())}>
      <ul className="grouped-list form-rows">
        <li>
          <label htmlFor="nb-name">Name</label>
          <input id="nb-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/my-change" />
        </li>
      </ul>
      <p className="sheet-note">Switches to the new branch from the current commit. Your uncommitted changes come with you.</p>
    </Sheet>
  );
}
