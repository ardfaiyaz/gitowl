import { useEffect, useState } from "react";
import { api } from "../api";
import { Sheet } from "./RepoDialogs";

type Workflow = { id: number; name: string; path: string; state: string };
type Input = { name: string; description: string; required: boolean; default: string; type: string; options: string[] };

// Starts a workflow by hand; the form comes from the workflow's declared workflow_dispatch inputs.
export function RunWorkflowDialog({
  repoPath,
  branch,
  busy,
  onClose,
  onRun,
}: {
  repoPath: string;
  branch: string;
  busy: boolean;
  onClose: () => void;
  onRun: (form: { number: number; ref: string; inputs: Record<string, string> }) => void;
}) {
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [id, setId] = useState(0);
  const [ref, setRef] = useState(branch);
  const [spec, setSpec] = useState<{ dispatchable: boolean; inputs: Input[] } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    api<{ items: Workflow[] }>("gh_workflows", { repo: repoPath })
      .then((v) => {
        setWorkflows(v.items);
        setId(v.items.find((w) => w.state === "active")?.id ?? 0);
      })
      .catch(() => setWorkflows([]));
  }, [repoPath]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<{ dispatchable: boolean; inputs: Input[] }>("gh_workflow_inputs", { repo: repoPath, number: id })
      .then((v) => {
        if (!active) return;
        setSpec(v);
        // A select shows its first option, so that is the value when no default is declared.
        const first = (i: Input) => i.options[0] ?? (i.type === "boolean" ? "true" : "");
        setValues(Object.fromEntries(v.inputs.map((i) => [i.name, i.default || first(i)])));
      })
      .catch(() => active && setSpec({ dispatchable: false, inputs: [] }));
    return () => {
      active = false;
    };
  }, [id, repoPath]);
  const missing = spec?.inputs.some((i) => i.required && !values[i.name]?.trim());
  const workflow = workflows?.find((w) => w.id === id);
  return (
    <Sheet
      title={workflow ? "Run " + workflow.name : "Run Workflow"}
      action="Run workflow"
      busy={busy}
      disabled={!spec?.dispatchable || !ref.trim() || !!missing}
      onClose={onClose}
      onSubmit={() => onRun({ number: id, ref: ref.trim(), inputs: values })}
    >
      <ul className="grouped-list form-rows">
        <li>
          <label htmlFor="wf-id">Workflow</label>
          <select id="wf-id" value={id} disabled={!workflows?.length} onChange={(e) => {
              setSpec(null);
              setId(Number(e.target.value));
            }}>
            {workflows === null && <option value={0}>Loading…</option>}
            {workflows?.length === 0 && <option value={0}>No workflows</option>}
            {workflows?.map((w) => (
              <option key={w.id} value={w.id} disabled={w.state !== "active"}>
                {w.name}
                {w.state !== "active" ? " (disabled)" : ""}
              </option>
            ))}
          </select>
        </li>
        <li>
          <label htmlFor="wf-ref">Branch</label>
          <input id="wf-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
        </li>
        {spec?.inputs.map((input) => (
          <li key={input.name}>
            <label htmlFor={"wf-" + input.name} title={input.description || undefined}>
              {input.name}
              {input.required && <span className="required"> required</span>}
            </label>
            {input.options.length || input.type === "boolean" ? (
              <select
                id={"wf-" + input.name}
                value={values[input.name] ?? ""}
                onChange={(e) => setValues({ ...values, [input.name]: e.target.value })}
              >
                {(input.options.length ? input.options : ["true", "false"]).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                id={"wf-" + input.name}
                value={values[input.name] ?? ""}
                placeholder={input.description || undefined}
                onChange={(e) => setValues({ ...values, [input.name]: e.target.value })}
              />
            )}
          </li>
        ))}
      </ul>
      <p className="sheet-note">
        {spec && !spec.dispatchable
          ? "This workflow can't be started by hand: it has no workflow_dispatch trigger."
          : "This form is built from the workflow's declared inputs."}
      </p>
    </Sheet>
  );
}

type Group = { step: string; lines: string[] };
const errorLine = /##\[error\]|\berror\b|FAILED|panicked/i;
// Terminal colour codes (ESC [ … m) would otherwise show as "^[[36;1m".
const ansi = new RegExp(String.fromCharCode(27) + "\\[[\\d;]*m", "g");

// gh prints "<job>\t<step>\t<timestamp> <text>". Steps come from that column, but GitHub's own
// "##[group]Title" markers win, since gh labels every line "UNKNOWN STEP" when it can't match them.
function groupLog(log: string): Group[] {
  const groups: Group[] = [];
  let marked = "";
  for (const raw of log.replace(/\n+$/, "").split("\n")) {
    const parts = raw.split("\t");
    const column = parts.length >= 3 ? parts[1] : "Log";
    const rest = parts.length >= 3 ? parts.slice(2).join("\t") : raw;
    const text = rest.replace(/^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").replace(ansi, "");
    if (text.startsWith("##[group]")) marked = text.slice(9).trim() || marked;
    if (text.startsWith("##[endgroup]")) continue;
    const step = column === "UNKNOWN STEP" ? marked || "Setup" : column;
    if (groups.at(-1)?.step !== step) groups.push({ step, lines: [] });
    if (!text.startsWith("##[group]")) groups.at(-1)!.lines.push(text);
  }
  return groups.filter((g) => g.lines.length);
}

export function JobLog({ repoPath, run, job }: { repoPath: string; run: number; job: number }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  // Failed steps start open; the rest start collapsed.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    api<{ log: string }>("gh_run_log", { repo: repoPath, number: run, job })
      .then((v) => {
        if (!active) return;
        const g = groupLog(v.log);
        setGroups(g);
        setOpen(Object.fromEntries(g.map((x) => [x.step, x.lines.some((l) => errorLine.test(l))])));
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [repoPath, run, job]);
  if (error) return <p className="hint">{error}</p>;
  if (!groups) return <p className="hint">Loading log…</p>;
  const q = query.trim().toLowerCase();
  const hits = q ? groups.reduce((n, g) => n + g.lines.filter((l) => l.toLowerCase().includes(q)).length, 0) : 0;
  return (
    <div className="job-log">
      <div className="job-log-search">
        <input aria-label="Search log" placeholder="Search log…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {q && <span className="hint">{hits} matching {hits === 1 ? "line" : "lines"}</span>}
      </div>
      <div className="log-view" role="log" aria-label="Job log">
        {groups.map((g, gi) => {
          const shown = q ? g.lines.filter((l) => l.toLowerCase().includes(q)) : g.lines;
          if (q && !shown.length) return null;
          const expanded = q ? true : open[g.step];
          return (
            <section key={gi}>
              <button className="log-group" aria-expanded={expanded} onClick={() => setOpen({ ...open, [g.step]: !open[g.step] })}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5l10 7-10 7z" fill="currentColor" />
                </svg>
                {g.step}
                <span>{g.lines.length} lines</span>
              </button>
              {expanded &&
                shown.map((line, i) => (
                  <div key={i} className={"log-line" + (errorLine.test(line) ? " err" : "")}>
                    <span className="log-no">{i + 1}</span>
                    {line}
                  </div>
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
