import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { Skeleton } from "./Dialog";
import { Segmented } from "./Segmented";

type Perform = (op: string, data?: object) => Promise<boolean>;
type Alert = { severity: string; package: string; summary: string; url: string };
type Security = { dependabot: Alert[] | null; code: Alert[] | null };
type Org = { login: string; repos: number | null };

type Ctx = { open: (url: string) => void; repo: string };
type ImageSource = { path: string; owner?: string; name?: string; ref?: string };

// Where a README image lives. Only this repository's files and github.com-hosted files can be shown:
// the app's CSP blocks remote images, so the backend fetches them through the GitHub API.
function imageSource(src: string): ImageSource | null {
  const raw = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/([^/]+)\/([^?#]+)/.exec(src);
  if (raw) return { owner: raw[1], name: raw[2], ref: raw[3], path: decodeURIComponent(raw[4]) };
  const hosted = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:raw|blob)\/([^/]+)\/([^?#]+)/.exec(src);
  if (hosted) return { owner: hosted[1], name: hosted[2], ref: hosted[3], path: decodeURIComponent(hosted[4]) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("#")) return null;
  return { path: decodeURIComponent(src.split(/[?#]/)[0]) };
}

function ReadmeImage({ src, alt, repo }: { src: string; alt: string; repo: string }) {
  const source = imageSource(src);
  const key = repo + "\n" + src;
  const [loaded, setLoaded] = useState<{ key: string; url?: string } | null>(null);
  useEffect(() => {
    if (!source) return;
    let active = true;
    api<{ url: string }>("gh_readme_image", { repo, ...source })
      .then((v) => active && setLoaded({ key, url: v.url }))
      .catch(() => active && setLoaded({ key }));
    return () => {
      active = false;
    };
    // source is derived from src, which key already covers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const url = loaded?.key === key ? loaded.url : undefined;
  if (url) return <img className="md-img" src={url} alt={alt} />;
  return (
    <span className="md-img-missing" title={src}>
      {source && loaded?.key !== key ? "Loading image…" : `[image${alt ? ": " + alt : ""}]`}
    </span>
  );
}

function link(href: string, children: ReactNode, key: number, ctx: Ctx) {
  return href.startsWith("https://github.com/") ? (
    <button key={key} type="button" className="md-link" onClick={() => ctx.open(href)}>
      {children}
    </button>
  ) : (
    <span key={key} className="md-link-text" title={href}>
      {children}
    </span>
  );
}

// Inline markdown: linked images, images, links, `code`, **bold**, ~~strike~~, *italic* / _italic_.
function inline(text: string, ctx: Ctx): ReactNode[] {
  const token =
    /(\[!\[[^\]]*\]\([^)\s]+\)\]\([^)\s]+\)|!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|(?<![A-Za-z0-9_])_[^_\s][^_]*_(?![A-Za-z0-9_]))/;
  return text.split(token).map((part, i) => {
    if (!part) return null;
    const linked = /^\[!\[([^\]]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)$/.exec(part);
    if (linked) return link(linked[3], <ReadmeImage src={linked[2]} alt={linked[1]} repo={ctx.repo} />, i, ctx);
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
    if (image) return <ReadmeImage key={i} src={image[2]} alt={image[1]} repo={ctx.repo} />;
    const anchor = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (anchor) return link(anchor[2], inline(anchor[1], ctx), i, ctx);
    if (/^`[^`]+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{inline(part.slice(2, -2), ctx)}</strong>;
    if (/^~~[^~]+~~$/.test(part)) return <s key={i}>{part.slice(2, -2)}</s>;
    if (/^(\*[^*]+\*|_[^_]+_)$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isDivider = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

// A safe Markdown subset for READMEs: React elements only, never innerHTML. From raw HTML only <img> is kept.
export function Markdown({ text, open, repo }: { text: string; open: (url: string) => void; repo: string }) {
  const ctx = { open, repo };
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(" "), ctx)}</p>);
    if (list) {
      const items = list.items.map((item, i) => {
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
        return task ? (
          <li key={i} className="md-task">
            <input type="checkbox" checked={task[1] !== " "} disabled aria-label={task[2]} />
            {inline(task[2], ctx)}
          </li>
        ) : (
          <li key={i}>{inline(item, ctx)}</li>
        );
      });
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    para = [];
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      blocks.push(<pre key={blocks.length}>{code.join("\n")}</pre>);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      i--;
      blocks.push(
        <div key={blocks.length} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, k) => (
                  <th key={k}>{inline(c, ctx)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>
                  {head.map((_, n) => (
                    <td key={n}>{inline(r[n] ?? "", ctx)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={blocks.length} />);
    } else if (line.startsWith(">")) {
      flush();
      blocks.push(<blockquote key={blocks.length}>{inline(line.replace(/^>\s?/, ""), ctx)}</blockquote>);
    } else if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6);
      const Tag = `h${level}` as "h3";
      blocks.push(<Tag key={blocks.length}>{inline(heading[2].replace(/\s+#+\s*$/, ""), ctx)}</Tag>);
    } else if (item) {
      if (para.length) flush();
      const ordered = !!item[2];
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[3]);
    } else if (!line.trim()) {
      flush();
    } else if (/^\s*<\/?[a-z]/i.test(line)) {
      // Raw HTML is never rendered; only the images in it are kept, by src and alt.
      const images = [...line.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)];
      if (images.length) {
        flush();
        blocks.push(
          <p key={blocks.length} className="md-images">
            {images.map((m, k) => (
              <ReadmeImage key={k} src={m[1]} alt={/\balt=["']([^"']*)["']/i.exec(m[0])?.[1] ?? ""} repo={repo} />
            ))}
          </p>,
        );
      }
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}

const severityClass = (s: string) => (/critical|high|error/i.test(s) ? "high" : /medium|moderate|warning/i.test(s) ? "medium" : "low");

// The board's "Issues, security, gists & more": focused cards for this repository and for your account.
export function GitHubMore({ repo, busy, perform }: { repo: string; busy: boolean; perform: Perform }) {
  const [tab, setTab] = useState<"repo" | "you">("repo");
  const [security, setSecurity] = useState<Security | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [error, setError] = useState("");
  const open = (url: string) => void perform("open_in", { target: "url", url });
  useEffect(() => {
    let active = true;
    const show = (e: unknown) => active && setError(e instanceof Error ? e.message : String(e));
    if (tab === "repo") {
      api<Security>("gh_security", { repo }).then((v) => active && setSecurity(v)).catch(show);
      api<{ text: string }>("gh_readme", { repo }).then((v) => active && setReadme(v.text)).catch(show);
    } else {
      api<{ orgs: Org[] }>("gh_orgs", { repo }).then((v) => active && setOrgs(v.orgs)).catch(show);
    }
    return () => {
      active = false;
    };
  }, [repo, tab]);
  const alerts = security && [...(security.dependabot ?? []), ...(security.code ?? [])];
  return (
    <div className="github-more">
      <Segmented
        label="Scope"
        value={tab}
        options={[
          ["repo", "This repository"],
          ["you", "You & your orgs"],
        ]}
        onChange={setTab}
      />
      {error && <pre className="inline-warning">{error}</pre>}
      {tab === "repo" ? (
        <div className="more-grid" key="repo">
          <section className="gh-card more-card">
            <h2>Security{alerts ? ` · ${alerts.length} open` : ""}</h2>
            {!security ? (
              <Skeleton rows={2} label="Loading alerts…" />
            ) : !alerts?.length ? (
              <p className="hint">
                {security.dependabot === null && security.code === null
                  ? "Alerts need Dependabot or code scanning turned on, and the security_events scope for the GitHub CLI."
                  : "No open alerts."}
              </p>
            ) : (
              <ul className="more-list">
                {alerts.map((a, i) => (
                  <li key={i}>
                    <span className={"sev sev-" + severityClass(a.severity)}>{a.severity}</span>
                    <span className="more-main">
                      {a.package} · {a.summary}
                    </span>
                    <button className="small" disabled={busy} onClick={() => open(a.url)}>
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="gh-card more-card readme-card">
            <h2>README</h2>
            {readme === null ? <Skeleton rows={3} label="Loading README…" /> : readme ? <Markdown text={readme} open={open} repo={repo} /> : <p className="hint">This repository has no README.</p>}
            <p className="hint">Rendered safely: no scripts and no raw HTML.</p>
          </section>
        </div>
      ) : (
        <div className="more-grid" key="you">
          <section className="gh-card more-card">
            <h2>Organizations</h2>
            {!orgs ? (
              <Skeleton rows={2} label="Loading organizations…" />
            ) : !orgs.length ? (
              <p className="hint">You aren't a member of any organization, or the GitHub CLI lacks the read:org scope.</p>
            ) : (
              <ul className="more-list">
                {orgs.map((o) => (
                  <li key={o.login}>
                    <span className="more-main">{o.login}</span>
                    <span className="hint">{o.repos == null ? "" : `${o.repos} repositories`}</span>
                    <button className="small" disabled={busy} onClick={() => open(`https://github.com/orgs/${o.login}/repositories`)}>
                      Browse
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <p className="hint">Each card is a small, focused view of one area. Delete and Transfer for issues live on the issue itself.</p>
    </div>
  );
}
