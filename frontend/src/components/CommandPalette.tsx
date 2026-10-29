import { useEffect, useRef, useState } from "react";
import { Segmented } from "./Segmented";

export type Command = { id: string; group: string; label: string; hint?: string; keys?: string; run: () => void };
type Hit = { number?: number; title?: string; path?: string; state?: string; url: string; repository?: { nameWithOwner?: string; fullName?: string } };
export type SearchResult = { scope: string; results: { prs: Hit[]; issues: Hit[]; code: Hit[] } };

// Opened many times a day, so it appears and closes instantly: no animation by design.
export function CommandPalette({
  commands,
  onClose,
  search,
  onOpenUrl,
}: {
  commands: Command[];
  onClose: () => void;
  // Search GitHub scope (board: Command palette): pull requests, issues and code, this repository first.
  search?: (query: string) => Promise<SearchResult>;
  onOpenUrl?: (url: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [scope, setScope] = useState<"commands" | "github">("commands");
  const [found, setFound] = useState<{ query: string; hits: Command[]; scope: string; error?: string } | null>(null);
  const term = query.trim();
  useEffect(() => {
    if (scope !== "github" || !search || term.length < 2) return;
    let active = true;
    // Wait for a pause in typing; each search is several GitHub API calls.
    const timer = setTimeout(() => {
      search(term)
        .then((r) => {
          if (!active) return;
          const name = (h: Hit) => h.repository?.nameWithOwner || h.repository?.fullName || "";
          const group = (label: string, list: Hit[]) => `${label} · ${list.length}`;
          const hits: Command[] = [
            ...r.results.prs.map((h) => ({ id: "pr" + h.url, group: group("Pull requests", r.results.prs), label: h.title ?? "", hint: `#${h.number} · ${name(h)} · ${(h.state ?? "").toLowerCase()}`, run: () => onOpenUrl?.(h.url) })),
            ...r.results.issues.map((h) => ({ id: "is" + h.url, group: group("Issues", r.results.issues), label: h.title ?? "", hint: `#${h.number} · ${name(h)} · ${(h.state ?? "").toLowerCase()}`, run: () => onOpenUrl?.(h.url) })),
            ...r.results.code.map((h) => ({ id: "cd" + h.url, group: group("Code", r.results.code), label: h.path ?? "", hint: name(h), run: () => onOpenUrl?.(h.url) })),
          ];
          setFound({ query: term, hits, scope: r.scope });
        })
        .catch((e) => active && setFound({ query: term, hits: [], scope: "", error: e instanceof Error ? e.message : String(e) }));
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scope, term, search, onOpenUrl]);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const github = scope === "github";
  const fresh = found?.query === term ? found : null;
  const matches = github ? (fresh?.hits ?? []) : commands.filter((c) => words.every((w) => (c.group + " " + c.label + " " + (c.hint ?? "")).toLowerCase().includes(w)));
  const current = Math.min(index, Math.max(matches.length - 1, 0));
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="palette-query">
        <svg className="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14m9 16-4.5-4.5" />
        </svg>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={matches[current] ? "cmd-" + matches[current].id : undefined}
          aria-label={github ? "Search GitHub" : "Search or run a command"}
          placeholder={github ? "Search pull requests, issues and code…" : "Search or run a command…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIndex((current + 1) % Math.max(matches.length, 1));
            else if (e.key === "ArrowUp") setIndex((current - 1 + matches.length) % Math.max(matches.length, 1));
            else if (e.key === "Enter") run(matches[current]);
            else if (e.key === "Tab" && search) {
              setScope(github ? "commands" : "github");
              setIndex(0);
            } else return;
            e.preventDefault();
          }}
        />
        <kbd>Esc</kbd>
      </div>
      {search && (
        <div className="palette-scope">
          <Segmented
            label="Scope"
            value={scope}
            options={[
              ["commands", "Commands"],
              ["github", "Search GitHub"],
            ]}
            onChange={(v) => {
              setScope(v);
              setIndex(0);
            }}
          />
          {github && fresh && !fresh.error && <small>{fresh.scope === "github" ? "Nothing in this repository; showing all of GitHub" : "In " + fresh.scope}</small>}
        </div>
      )}
      <ul id="palette-list" role="listbox" aria-label={github ? "GitHub results" : "Commands"}>
        {matches.map((c, i) => (
          <li key={c.id}>
            {(i === 0 || matches[i - 1].group !== c.group) && <span className="palette-group" aria-hidden="true">{c.group}</span>}
            <div
              id={"cmd-" + c.id}
              role="option"
              aria-selected={i === current}
              className={"palette-item" + (i === current ? " active" : "")}
              onMouseMove={() => i !== current && setIndex(i)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              {c.hint && <small>{c.hint}</small>}
              {c.keys && <kbd>{c.keys}</kbd>}
            </div>
          </li>
        ))}
        {!matches.length && (
          <li className="palette-empty">
            {!github
              ? `No command matches “${query}”.`
              : term.length < 2
                ? "Type at least two characters to search GitHub."
                : !fresh
                  ? "Searching GitHub…"
                  : fresh.error || `Nothing on GitHub matches “${term}”.`}
          </li>
        )}
      </ul>
      <div className="palette-foot" aria-hidden="true">
        <span>↑↓ to move</span>
        <span>{github ? "Enter to open on GitHub" : "Enter to run"}</span>
        {search && <span>Tab to switch scope</span>}
        <span>Esc to close</span>
      </div>
    </dialog>
  );
}
