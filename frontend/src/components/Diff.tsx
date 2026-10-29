import { Fragment, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Segmented } from "./Segmented";
import { summarizeDiff } from "../diffSummary";

// Renders `name` spans in summary sentences as code.
const Inline = ({ text }: { text: string }) =>
  text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));

function Explain({ text }: { text: string }) {
  const { overview, files } = summarizeDiff(text);
  const explained = files.filter((f) => f.notes.length);
  if (!overview.length) return null;
  return (
    <details className="diff-summary" open>
      <summary>Explain changes</summary>
      <ul>
        {overview.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {explained.map((f) => (
        <section key={f.path}>
          {f.path && (
            <h4>
              <code>{f.path}</code>
              <span className="added-text">+{f.add}</span> <span className="removed-text">−{f.del}</span>
            </h4>
          )}
          <ul>
            {f.notes.map((note) => (
              <li key={note}>
                <Inline text={note} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </details>
  );
}

type Row = {
  kind: "meta" | "hunk" | "context" | "added" | "removed";
  text: string;
  oldNo?: number;
  newNo?: number;
  hunk?: number;
  // Position among the hunk's body lines; line staging sends these to the server.
  line?: number;
  // Changed span [start, end) within text, set on paired removed/added lines.
  mark?: [number, number];
  // Repository path of the file this row belongs to (multi-file diffs).
  file?: string;
  // Hunk headers: unchanged old-file lines skipped since the previous hunk.
  hidden?: number;
};
// Where a review comment attaches: GitHub counts new-side lines as RIGHT, removed lines as LEFT.
export type LinePos = { file: string; line: number; side: "LEFT" | "RIGHT"; text: string };
// Display options the server applies (git diff -w / full context); hunks then no longer match the file.
export type DiffOptions = {
  hideWhitespace: boolean;
  fullContext: boolean;
  set: (next: { hideWhitespace?: boolean; fullContext?: boolean }) => void;
};
const LIMIT = 5000;

// Marks the changed middle of each removed line and the added line paired with it,
// after their common prefix and suffix.
function markChanges(rows: Row[]) {
  for (let i = 0; i < rows.length; ) {
    const start = i;
    while (rows[i]?.kind === "removed") i++;
    const mid = i;
    while (rows[i]?.kind === "added") i++;
    if (i === start) {
      i++;
      continue;
    }
    for (let j = 0; j < Math.min(mid - start, i - mid); j++) {
      const a = rows[start + j].text;
      const b = rows[mid + j].text;
      let p = 1; // skip the +/- marker
      while (p < a.length && p < b.length && a[p] === b[p]) p++;
      let s = 0;
      while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
      // Lines with nothing in common read better without a highlight.
      if (p === 1 && s === 0) continue;
      rows[start + j].mark = [p, a.length - s];
      rows[mid + j].mark = [p, b.length - s];
    }
  }
  return rows;
}

function Code({ row, query }: { row: Row; query?: string }) {
  const lower = row.text.toLowerCase();
  if (query && lower.includes(query)) {
    const parts: ReactNode[] = [];
    let at = 0;
    for (let i = lower.indexOf(query); i !== -1; i = lower.indexOf(query, at)) {
      parts.push(row.text.slice(at, i), <mark key={i} className="find-hit">{row.text.slice(i, i + query.length)}</mark>);
      at = i + query.length;
    }
    parts.push(row.text.slice(at));
    return <code>{parts}</code>;
  }
  if (!row.mark) return <code>{row.text || " "}</code>;
  const [from, to] = row.mark;
  return (
    <code>
      {row.text.slice(0, from)}
      {to > from && <mark>{row.text.slice(from, to)}</mark>}
      {row.text.slice(to)}
    </code>
  );
}

// Maps unified-diff rows to their real old/new source line numbers.
function parseDiff(text: string): Row[] {
  const rows: Row[] = [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  // Untracked-file previews are plain "+" lines with no hunk header.
  const plain = !text.includes("\n@@") && !text.startsWith("@@");
  let oldNo = 0;
  let newNo = plain ? 1 : 0;
  let inHunk = plain;
  let hunk = -1;
  let body = 0;
  let file = "";
  let nextOld = 1; // first old-file line after the previous hunk
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      inHunk = true;
      body = 0;
      rows.push({ kind: "hunk", text: line, hunk: ++hunk, hidden: oldNo - nextOld });
      nextOld = oldNo + Number(header[2] ?? 1);
    } else if (line.startsWith("diff --git")) {
      inHunk = false;
      nextOld = 1;
      file = / b\/(.+)$/.exec(line)?.[1] ?? "";
      rows.push({ kind: "meta", text: line });
    } else if (!inHunk) {
      rows.push({ kind: "meta", text: line });
    } else if (line.startsWith("\\")) {
      body++;
      rows.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "added", text: line, newNo: newNo++, hunk, line: body++, file });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "removed", text: line, oldNo: oldNo++, hunk, line: body++, file });
    } else {
      rows.push({ kind: "context", text: line, oldNo: oldNo++, newNo: newNo++, hunk, line: body++, file });
    }
  }
  return rows;
}

const posOf = (row: Row): LinePos =>
  row.kind === "removed"
    ? { file: row.file ?? "", line: row.oldNo!, side: "LEFT", text: row.text.slice(1) }
    : { file: row.file ?? "", line: row.newNo!, side: "RIGHT", text: row.text.slice(1) };

type Pair = { left?: Row; right?: Row; full?: Row };
// Pairs each run of removals with the following run of additions for the side-by-side view.
function pairRows(rows: Row[]): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < rows.length; ) {
    const row = rows[i];
    if (row.kind === "removed" || row.kind === "added") {
      const removed: Row[] = [];
      const added: Row[] = [];
      while (rows[i]?.kind === "removed") removed.push(rows[i++]);
      while (rows[i]?.kind === "added") added.push(rows[i++]);
      for (let j = 0; j < Math.max(removed.length, added.length); j++)
        pairs.push({ left: removed[j], right: added[j] });
    } else {
      pairs.push(
        row.kind === "context" ? { left: row, right: row } : { full: row },
      );
      i++;
    }
  }
  return pairs;
}

export function Diff({
  text,
  hunkAction,
  onHunk,
  comment,
  options,
}: {
  text: string;
  hunkAction?: string;
  onHunk?: (index: number, lines?: number[]) => void;
  // Review comments: line numbers become buttons, and render() draws under the picked line.
  comment?: { onPick: (pos: LinePos) => void; render: (pos: LinePos) => ReactNode };
  options?: DiffOptions;
}) {
  const [split, setSplit] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [find, setFind] = useState<string | null>(null);
  const [hit, setHit] = useState(-1);
  const diffRef = useRef<HTMLDivElement>(null);
  const query = find?.trim().toLowerCase() || undefined;
  // Selected lines belong to one hunk of one diff text; a new diff clears them.
  const [picked, setPicked] = useState<{ text: string; hunk: number; lines: number[] } | null>(null);
  const selection = picked?.text === text ? picked : null;
  const toggle = (row: Row) =>
    setPicked(() => {
      const same = selection?.hunk === row.hunk ? selection!.lines : [];
      const lines = same.includes(row.line!) ? same.filter((l) => l !== row.line) : [...same, row.line!];
      return lines.length ? { text, hunk: row.hunk!, lines } : null;
    });
  if (!text)
    return (
      <div className="empty">
        <Icon name="changes" />
        <h3>Nothing selected</h3>
        <p>Select a file or commit to see its changes.</p>
      </div>
    );
  const all = parseDiff(text);
  const rows = markChanges(all.slice(0, LIMIT));
  const hunkRow = (row: Row, key: number) => {
    const lines = selection?.hunk === row.hunk ? selection!.lines : null;
    const linesLabel =
      lines &&
      `${hunkAction?.replace(" hunk", "")} ${lines.length} selected line${lines.length === 1 ? "" : "s"}`;
    const act = (label: string, picks?: number[], primary = false) => (
      <button
        className={"hunk-action" + (primary ? " primary" : "")}
        onClick={() => {
          onHunk!(row.hunk!, picks);
          setPicked(null);
        }}
        aria-label={`${label}: ${row.text}`}
      >
        {label}
      </button>
    );
    return (
      <Fragment key={key}>
        {options && !options.fullContext && row.hidden! > 0 && (
          <button className="diff-expand" onClick={() => options.set({ fullContext: true })}>
            ↕ Show {row.hidden} hidden line{row.hidden === 1 ? "" : "s"}
          </button>
        )}
        <div className="diff-line hunk">
          <span className="line-no" />
          <span className="line-no" />
          <code>{row.text}</code>
          {onHunk && hunkAction && (
            <span className="hunk-actions">
              {linesLabel && act(linesLabel, lines!, true)}
              {act(hunkAction)}
            </span>
          )}
        </div>
      </Fragment>
    );
  };
  const cell = (row: Row | undefined, side: "old" | "new") => (
    <div className={"diff-line " + (row && row.kind !== "context" ? row.kind : "")}>
      <span className="line-no">{side === "old" ? row?.oldNo : row?.newNo}</span>
      {row ? <Code row={row} query={query} /> : <code> </code>}
    </div>
  );
  const matches = query
    ? rows.reduce((n, r) => (r.kind === "hunk" || r.kind === "meta" ? n : n + r.text.toLowerCase().split(query).length - 1), 0)
    : 0;
  // Enter / Shift+Enter step through the highlighted matches and scroll the current one into view.
  const step = (by: number) => {
    const marks = diffRef.current?.querySelectorAll("mark.find-hit");
    if (!marks?.length) return;
    const next = (hit + by + marks.length) % marks.length;
    marks.forEach((m, i) => m.classList.toggle("current", i === next));
    marks[next].scrollIntoView({ block: "center" });
    setHit(next);
  };
  const paused = options && (options.hideWhitespace || options.fullContext) && onHunk;
  return (
    <>
      <Explain text={text} />
      <div className="diff-options">
        {options && (
          <label className="confirmation-check inline">
            <input type="checkbox" checked={options.hideWhitespace} onChange={(e) => options.set({ hideWhitespace: e.target.checked })} />
            Hide whitespace
          </label>
        )}
        <label className="confirmation-check inline">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          Wrap lines
        </label>
        {options?.fullContext && <button onClick={() => options.set({ fullContext: false })}>Hide unchanged lines</button>}
        <button aria-expanded={find !== null} onClick={() => setFind(find === null ? "" : null)}>
          <Icon name="search" />
          Find
        </button>
        <Segmented
          className="diff-mode"
          label="Diff layout"
          value={split ? "split" : "unified"}
          options={[
            ["unified", "Unified"],
            ["split", "Side by Side"],
          ]}
          onChange={(v) => setSplit(v === "split")}
        />
      </div>
      {find !== null && (
        <div className="diff-find">
          <input
            type="search"
            autoFocus
            aria-label="Find in diff"
            placeholder="Find in diff…"
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              setHit(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setFind(null);
              }
            }}
          />
          <span className="hint" aria-live="polite">
            {!query ? "" : !matches ? "No matches" : hit < 0 ? `${matches} match${matches === 1 ? "" : "es"} · Enter for next` : `${hit + 1} of ${matches}`}
          </span>
        </div>
      )}
      {paused && (
        <p className="hint diff-paused">
          Hunk staging is paused: with whitespace hidden or every line shown, the hunks no longer match the file on disk.
        </p>
      )}
      <div ref={diffRef} className={"diff" + (wrap ? " wrap" : "")} aria-label="File differences">
        {split
          ? pairRows(rows).map((pair, i) =>
              pair.full ? (
                pair.full.kind === "hunk" ? (
                  hunkRow(pair.full, i)
                ) : (
                  <div key={i} className="diff-line meta">
                    <code>{pair.full.text || " "}</code>
                  </div>
                )
              ) : (
                <div key={i} className="split-row">
                  {cell(pair.left, "old")}
                  {cell(pair.right, "new")}
                </div>
              ),
            )
          : rows.map((row, i) =>
              row.kind === "hunk" ? (
                hunkRow(row, i)
              ) : (
                <Fragment key={i}>
                <div
                  className={
                    "diff-line " +
                    row.kind +
                    (selection?.hunk === row.hunk && selection?.lines.includes(row.line!) ? " picked" : "")
                  }
                >
                  {onHunk && hunkAction && (
                    <span className="line-pick">
                      {(row.kind === "added" || row.kind === "removed") && (
                        <input
                          type="checkbox"
                          aria-label={"Select line " + row.text}
                          checked={!!selection && selection.hunk === row.hunk && selection.lines.includes(row.line!)}
                          onChange={() => toggle(row)}
                        />
                      )}
                    </span>
                  )}
                  {comment && row.kind !== "meta" ? (
                    <>
                      <button className="line-no line-comment" aria-label={`Comment on ${row.file} line ${row.newNo ?? row.oldNo}`} onClick={() => comment.onPick(posOf(row))}>
                        {row.oldNo}
                      </button>
                      <button className="line-no line-comment" tabIndex={-1} aria-hidden="true" onClick={() => comment.onPick(posOf(row))}>
                        {row.newNo}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="line-no" aria-label="Old line">
                        {row.oldNo}
                      </span>
                      <span className="line-no" aria-label="New line">
                        {row.newNo}
                      </span>
                    </>
                  )}
                  <Code row={row} query={query} />
                </div>
                {comment && row.kind !== "meta" && comment.render(posOf(row))}
                </Fragment>
              ),
            )}
        {all.length > LIMIT && (
          <p className="diff-limit">
            Showing the first {LIMIT.toLocaleString()} of{" "}
            {all.length.toLocaleString()} diff rows.
          </p>
        )}
      </div>
    </>
  );
}
