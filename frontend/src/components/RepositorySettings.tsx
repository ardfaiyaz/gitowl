import { Fragment, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Skeleton } from "./Dialog";
import { RepoPane, SecretsPane } from "./SettingsParts";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
type Snapshot = { repository: ObjectValue; values: ObjectValue; errors: Record<string, string> };
type Section = "general" | "access" | "branches" | "actions" | "environments" | "secrets" | "security" | "webhooks" | "keys" | "pages" | "more";
type Action = (op: string, data?: object) => Promise<boolean>;
type SectionInfo = { id: Section; label: string; path: string; search: string };
const groups: { label: string; sections: SectionInfo[] }[] = [
  { label: "Repository", sections: [
    { id: "general", label: "General", path: "", search: "description topics visibility merge features issues wiki discussions default branch danger archive delete" },
    { id: "access", label: "Collaborators & teams", path: "access", search: "people permissions roles access" },
    { id: "branches", label: "Branches & rules", path: "branches", search: "protection rulesets policies" },
  ] },
  { label: "Code & automation", sections: [
    { id: "actions", label: "Actions", path: "actions", search: "workflows permissions runners ci" },
    { id: "environments", label: "Environments", path: "environments", search: "deployment reviewers protection" },
    { id: "secrets", label: "Secrets & variables", path: "secrets/actions", search: "actions credentials configuration" },
    { id: "pages", label: "Pages", path: "pages", search: "website domain https publishing" },
  ] },
  { label: "Security & integrations", sections: [
    { id: "security", label: "Security", path: "security_analysis", search: "code scanning secret scanning dependabot vulnerability reporting" },
    { id: "webhooks", label: "Webhooks", path: "hooks", search: "events delivery integrations" },
    { id: "keys", label: "Deploy keys", path: "keys", search: "ssh read write access" },
    { id: "more", label: "More settings", path: "", search: "codespaces apps properties interaction moderation" },
  ] },
];
const sections = groups.flatMap((group) => group.sections);
const object = (value: Json | undefined): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const records = (value: Json | undefined): ObjectValue[] => Array.isArray(value) ? value.map(object) : [];
function field(value: ObjectValue, path: string): Json | undefined {
  return path.split(".").reduce<Json | undefined>((current, key) => object(current)[key], value);
}
function display(value: Json | undefined): string {
  if (value === undefined || value === null) return "Not available";
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (Array.isArray(value)) return value.length ? value.map(display).join(", ") : "None";
  if (typeof value === "object") return "Not available";
  return String(value).trim() || "Not set";
}
function Row({ label, value, children }: { label: ReactNode; value?: ReactNode; children?: ReactNode }) {
  return <div className="settings-row"><span>{label}</span>{children || <strong className="repository-setting-value">{value}</strong>}</div>;
}
function Group({ title, children, manage, onManage }: { title: string; children: ReactNode; manage?: string; onManage: (path: string) => void }) {
  return <section>
    <div className="repository-group-heading"><h2>{title}</h2>{manage !== undefined && <button className="small" onClick={() => onManage(manage)}>Manage on GitHub</button>}</div>
    <div className="settings-group">{children}</div>
  </section>;
}

export function RepositorySettings({ repo, connected, busy, action, onConnect, headerSlot }: {
  repo: string;
  connected: boolean | null;
  busy: boolean;
  action: Action;
  onConnect: () => void;
  headerSlot: HTMLDivElement | null;
}) {
  const [section, setSection] = useState<Section>("general");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; value?: Snapshot; error?: string } | null>(null);
  const key = repo + "\n" + section + "\n" + revision;
  useEffect(() => {
    if (!connected) return;
    let active = true;
    api<Snapshot>("gh_repository_settings", { repo, section })
      .then((value) => active && setLoaded({ key, value }))
      .catch((error: unknown) => active && setLoaded({ key, error: error instanceof Error ? error.message : String(error) }));
    return () => { active = false; };
  }, [repo, section, connected, key]);
  const snapshot = loaded?.key === key ? loaded.value : undefined;
  const error = loaded?.key === key ? loaded.error : undefined;
  const selected = sections.find((item) => item.id === section)!;
  const repository = snapshot?.repository || {};
  const values = snapshot?.values || {};
  const errors = snapshot?.errors || {};
  const loading = !snapshot && !error;
  const reload = () => setRevision((value) => value + 1);
  const open = (path: string) => {
    if (typeof repository.html_url === "string") void action("open_in", { target: "url", url: `${repository.html_url}/settings${path ? "/" + path : ""}` });
  };
  const change: Action = async (op, data) => {
    const ok = await action(op, data);
    if (ok && op !== "gh_browse_settings") reload();
    return ok;
  };
  const unavailable = (source: string) => <div className="repository-unavailable" role="status">
    <p>GitHub did not return these settings. They may be unavailable for this repository or your account.</p>
    <details><summary>Show details</summary><pre className="inline-warning">{errors[source]}</pre></details>
  </div>;
  const fields = (title: string, source: ObjectValue, items: [string, string][], manage?: string) => <Group title={title} manage={manage} onManage={open}>
    {items.map(([label, path]) => <Row key={path} label={label} value={display(field(source, path))} />)}
  </Group>;
  const list = (title: string, source: string, render: (item: ObjectValue) => ReactNode, empty: string, manage?: string) => <Group title={title} manage={manage} onManage={open}>
    {errors[source] ? unavailable(source) : records(values[source]).length ? records(values[source]).map((item, index) => <Fragment key={String(item.id ?? item.name ?? index)}>{render(item)}</Fragment>) : <p className="repository-empty">{empty}</p>}
  </Group>;
  const policy = (title: string, source: string, items: [string, string][], manage?: string) => errors[source]
    ? <Group title={title} manage={manage} onManage={open}>{unavailable(source)}</Group>
    : fields(title, object(values[source]), items, manage);
  const toolbar = <div className="button-row">
    <button disabled={busy || loading} onClick={reload}>Refresh</button>
    <button disabled={busy || !snapshot} onClick={() => open(selected.path)}>Manage on GitHub</button>
  </div>;
  if (connected === null) return <div className="repository-connect"><Skeleton rows={3} label="Checking GitHub connection…" /></div>;
  if (!connected) return <section className="repository-connect">
    <h2>Connect this repository to GitHub</h2>
    <p>Sign in with the GitHub CLI and connect a GitHub remote to view its settings.</p>
    <button className="primary" onClick={onConnect}>Go to GitHub</button>
  </section>;
  return <>
    {headerSlot ? createPortal(toolbar, headerSlot) : toolbar}
    <div className="settings-layout repository-settings">
      <nav className="settings-nav" aria-label="Repository settings sections">
        <select className="repository-section-picker" aria-label="Repository settings section" value={section} onChange={(event) => setSection(event.target.value as Section)}>
          {groups.map((group) => <optgroup key={group.label} label={group.label}>{group.sections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
        </select>
        <label className="visually-hidden repository-settings-search-label" htmlFor="repository-settings-search">Find a repository setting</label>
        <input id="repository-settings-search" type="search" placeholder="Find a setting…" value={search} onChange={(event) => setSearch(event.target.value)} />
        {groups.map((group) => {
          const matching = group.sections.filter((item) => `${item.label} ${item.search}`.toLowerCase().includes(search.toLowerCase().trim()));
          return matching.length ? <Fragment key={group.label}><p>{group.label}</p>{matching.map((item) => <button key={item.id} aria-current={section === item.id ? "true" : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}</Fragment> : null;
        })}
        {!sections.some((item) => `${item.label} ${item.search}`.toLowerCase().includes(search.toLowerCase().trim())) && <p role="status">No settings match.</p>}
      </nav>
      <div className="settings-pane" aria-label={selected.label} aria-busy={loading}>
        {loading ? <Skeleton rows={5} label="Loading repository settings…" /> : error ? <section role="alert"><h2>Couldn’t load repository settings</h2><pre className="inline-warning">{error}</pre><button disabled={busy} onClick={reload}>Try again</button></section> : <>
          <div className="repository-settings-summary"><strong>{display(repository.full_name)}</strong><span>{display(repository.visibility)} · {object(repository.permissions).admin === true ? "Admin access" : "Some settings may require admin access"}</span></div>
          {section === "general" && <>
            {fields("General", { ...repository, archiveStatus: repository.archived === true ? "Archived" : repository.archived === false ? "Active" : null }, [["Default branch", "default_branch"], ["Website", "homepage"], ["Visibility", "visibility"], ["Status", "archiveStatus"]])}
            {fields("Features", repository, [["Issues", "has_issues"], ["Discussions", "has_discussions"], ["Projects", "has_projects"], ["Wiki", "has_wiki"], ["Allow forking", "allow_forking"]])}
            {fields("Pull requests", repository, [["Merge commits", "allow_merge_commit"], ["Squash merging", "allow_squash_merge"], ["Rebase merging", "allow_rebase_merge"], ["Auto-merge", "allow_auto_merge"], ["Delete head branches after merge", "delete_branch_on_merge"], ["Suggest updating pull request branches", "allow_update_branch"], ["Require sign-off on web commits", "web_commit_signoff_required"]])}
            <RepoPane key={repo + revision} repo={repo} busy={busy} action={change} />
          </>}
          {section === "access" && <>
            {list("Collaborators", "collaborators", (item) => <Row label={display(item.login)} value={display(item.role_name)} />, "No collaborators.", "access")}
            {object(repository.owner).type === "Organization" && list("Teams", "teams", (item) => <Row label={display(item.name)} value={display(item.permission)} />, "No teams have access.", "access")}
          </>}
          {section === "branches" && <>
            {list("Branches", "branches", (item) => <Row label={<code>{display(item.name)}</code>} value={item.protected === true ? "Protected" : item.protected === false ? "Not protected" : "Not available"} />, "No branches yet.", "branches")}
            {list("Rulesets", "rulesets", (item) => <Row label={<>{display(item.name)}<small>{display(item.target)} · {display(item.source)}</small></>} value={display(item.enforcement)} />, "No rulesets.", "rules")}
          </>}
          {section === "actions" && <>
            {policy("Actions policy", "actions", [["GitHub Actions", "enabled"], ["Allowed actions", "allowed_actions"]], "actions")}
            {policy("Workflow permissions", "workflow", [["Default token permissions", "default_workflow_permissions"], ["Allow Actions to approve pull requests", "can_approve_pull_request_reviews"]], "actions")}
            {list("Self-hosted runners", "runners", (item) => <Row label={<>{display(item.name)}<small>{display(item.os)} · {item.busy === true ? "Busy" : item.busy === false ? "Idle" : "Busy status unavailable"}</small></>} value={display(item.status)} />, "No self-hosted runners.", "actions/runners")}
          </>}
          {section === "environments" && list("Environments", "environments", (item) => <Row label={display(item.name)} value={records(item.protection_rules).map((rule) => rule.type === "wait_timer" ? `${display(rule.wait_timer)} minute wait` : rule.type === "required_reviewers" ? "Required reviewers" : display(rule.type).replaceAll("_", " ")).join(" · ") || "No protection rules"} />, "No environments configured.", "environments")}
          {section === "secrets" && <SecretsPane key={repo + revision} repo={repo} busy={busy} action={change} />}
          {section === "security" && <>
            {fields("Code security & analysis", repository, [["Advanced Security", "security_and_analysis.advanced_security.status"], ["Code security", "security_and_analysis.code_security.status"], ["Secret scanning", "security_and_analysis.secret_scanning.status"], ["Secret scanning push protection", "security_and_analysis.secret_scanning_push_protection.status"], ["Non-provider secret patterns", "security_and_analysis.secret_scanning_non_provider_patterns.status"]], "security_analysis")}
            {policy("Vulnerability reporting", "reporting", [["Private vulnerability reporting", "enabled"]], "security_analysis")}
            <p className="hint settings-caption">GitHub may hide security settings unless you have admin or security-manager access.</p>
          </>}
          {section === "webhooks" && list("Webhooks", "webhooks", (item) => <Row label={<>{display(item.name)}<small>#{display(item.id)} · {display(item.events)}</small></>} value={item.active === true ? "Active" : item.active === false ? "Inactive" : "Not available"} />, "No webhooks configured.", "hooks")}
          {section === "keys" && list("Deploy keys", "keys", (item) => <Row label={display(item.title)} value={item.read_only === true ? "Read only" : item.read_only === false ? "Read and write" : "Not available"} />, "No deploy keys configured.", "keys")}
          {section === "pages" && <>
            {policy("GitHub Pages", "pages", [["Website", "html_url"], ["Status", "status"], ["Build type", "build_type"], ["Custom domain", "cname"], ["Source branch", "source.branch"], ["Source folder", "source.path"], ["Enforce HTTPS", "https_enforced"]], "pages")}
          </>}
          {section === "more" && <Group title="More settings on GitHub" onManage={open}>
            {[["Codespaces", "codespaces"], ["GitHub Apps", "installations"], ["Custom properties", "custom-properties"], ["Interaction limits", "interaction_limits"]].map(([label, path]) => <Row key={path} label={label}><button className="small" disabled={busy} onClick={() => open(path)}>Open on GitHub</button></Row>)}
            <p className="repository-empty">Available settings depend on the repository owner, your permissions, and your GitHub plan.</p>
          </Group>}
        </>}
      </div>
    </div>
  </>;
}
