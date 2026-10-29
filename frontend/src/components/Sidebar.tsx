import type { CSSProperties, ReactNode } from "react";
import type { Repo } from "../types";
import { Icon, type IconName } from "./Icon";

export type Tab =
  | "overview"
  | "changes"
  | "history"
  | "branches"
  | "github"
  | "settings";
export type Theme = "system" | "light" | "dark";

const items: [Tab, IconName, string][] = [
  ["overview", "grid", "Overview"],
  ["changes", "changes", "Changes"],
  ["history", "history", "History"],
  ["branches", "branch", "Branches & tags"],
  ["github", "cloud", "GitHub"],
];
const dots = ["#34c759", "#2f6bff", "#ff9f0a", "#af52de", "#ff375f"];
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;


export function Sidebar({
  repo,
  tab,
  busy,
  github,
  recent,
  unread,
  theme,
  dark,
  onTab,
  onSearch,
  onOpenRecent,
  onSwitchProject,
  onTheme,
  rail,
  onRail,
}: {
  repo: Repo;
  tab: Tab;
  busy: boolean;
  github: boolean | null;
  recent: string[];
  unread: number;
  theme: Theme;
  dark: boolean;
  onTab: (tab: Tab) => void;
  onSearch: () => void;
  onOpenRecent: (path: string) => void;
  onSwitchProject: () => void;
  onTheme: (theme: Theme) => void;
  // Icon-rail mode; App owns it so Settings and Ctrl B change the same value.
  rail: boolean;
  onRail: (rail: boolean) => void;
}) {
  const active = items.findIndex(([key]) => key === tab);
  const projects = recent.filter((p) => p !== repo.path).slice(0, 3);
  const nav = (key: Tab, icon: IconName, label: string, extra?: ReactNode) => (
    <button
      key={key}
      className={"nav " + (tab === key ? "active" : "")}
      aria-current={tab === key ? "page" : undefined}
      aria-label={rail ? label : undefined}
      data-tip={label}
      onClick={() => onTab(key)}
    >
      <Icon name={icon} />
      <span className="nav-label">{label}</span>
      {extra}
    </button>
  );
  return (
    <aside className="sidebar" aria-label="Workspace">
      <div className="brand">
        <img className="brand-lockup" src={dark ? "/gitowl-lockup-on-dark.svg" : "/gitowl-lockup.svg"} alt="gitowl" width="112" height="41" />
        <img className="brand-mark" src="/favicon.svg" alt="gitowl" width="34" height="34" />
        <button
          className="rail-toggle"
          onClick={() => onRail(!rail)}
          aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!rail}
          title={(rail ? "Expand" : "Collapse") + " sidebar (Ctrl B)"}
        >
          <Icon name="sidebar" />
        </button>
      </div>
      <button className="side-search" onClick={onSearch} aria-label="Search or run a command" data-tip="Search (Ctrl K)">
        <Icon name="search" />
        <span className="nav-label">Search…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button
        className="project-switcher"
        disabled={busy}
        onClick={onSwitchProject}
        aria-label={`Switch project (current: ${repo.name}, ${repo.branch})`}
        title={`${repo.path}\nOpen another folder`}
      >
        <span className="project-dot" style={{ background: dots[0] }} aria-hidden="true" />
        <span className="project-text">
          <strong>{repo.name}</strong>
          <small>{repo.branch}</small>
        </span>
        <svg className="icon chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7 10 5-5 5 5M7 14l5 5 5-5" />
        </svg>
      </button>
      <div className="side-label">Workspace</div>
      <div className="nav-group" style={{ "--active": active } as CSSProperties}>
        {active >= 0 && <span className="nav-pill" aria-hidden="true" />}
        {items.map(([key, icon, label]) =>
          nav(
            key,
            icon,
            label,
            // Grey counts are information; red means unread notifications waiting on you.
            key === "changes" && repo.files.length > 0 ? (
              <b>{repo.files.length}</b>
            ) : key === "overview" && unread > 0 ? (
              // GitHub returns at most 50 notifications per page, so 50 means "50 or more".
              <b className="alert" aria-label={(unread >= 50 ? "50 or more" : unread) + " unread notifications"}>
                {unread >= 50 ? "50+" : unread}
              </b>
            ) : null,
          ),
        )}
      </div>
      <div className="side-sep" />
      {nav("settings", "settings", "Settings")}
      {projects.length > 0 && (
        <>
          <div className="side-label">Projects</div>
          {projects.map((path, i) => (
            <button
              key={path}
              className="side-project"
              disabled={busy}
              onClick={() => onOpenRecent(path)}
              title={path}
              aria-label={"Open " + baseName(path)}
              data-tip={baseName(path)}
            >
              <span className="project-dot" style={{ background: dots[(i + 1) % dots.length] }} aria-hidden="true" />
              <span className="nav-label">{baseName(path)}</span>
              <svg className="icon chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          ))}
        </>
      )}
      <div className="side-bottom">
        <div className="theme-switch" role="group" aria-label={`Appearance (${theme === "system" ? "following system" : theme})`}>
          <span className="theme-thumb" aria-hidden="true" />
          <button aria-pressed={!dark} onClick={() => onTheme("light")} aria-label="Light appearance">
            <Icon name="sun" />
            <span>Light</span>
          </button>
          <button aria-pressed={dark} onClick={() => onTheme("dark")} aria-label="Dark appearance">
            <Icon name="moon" />
            <span>Dark</span>
          </button>
        </div>
        <div className="identity" title={github ? "Signed in to GitHub" : github === false ? "Not signed in to GitHub" : "Checking GitHub…"}>
          <i className={github ? "online" : "online offline"} aria-hidden="true" />
          <span>
            <strong>{repo.identity.name || "No identity set"}</strong>
            <small>
              {github === null
                ? "Checking GitHub…"
                : github
                  ? repo.identity.email || "Signed in to GitHub"
                  : "Not signed in to GitHub"}
            </small>
          </span>
        </div>
      </div>
    </aside>
  );
}
