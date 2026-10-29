import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api } from "../api";

type Activity = { days: Record<string, number>; shallow: boolean };
const dayMs = 86_400_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const dayFormatter = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateLabel = (date: string) => dayFormatter.format(new Date(date + "T00:00:00Z"));
const describe = (date: string, count: number) => `${count.toLocaleString()} ${count === 1 ? "commit" : "commits"} on ${dateLabel(date)}`;

export function RepositoryActivity({ repo, fingerprint }: { repo: string; fingerprint: string }) {
  const [today] = useState(() => { const now = new Date(); return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()); });
  const currentYear = new Date(today).getUTCFullYear();
  const [year, setYear] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ repo: string; key: string; data?: Activity; error?: string } | null>(null);
  const [inspected, setInspected] = useState("");
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const key = repo + "\n" + fingerprint + "\n" + revision;
  useEffect(() => {
    let active = true;
    api<Activity>("repository_activity", { repo })
      .then((data) => active && setLoaded({ repo, key, data }))
      .catch((error: unknown) => active && setLoaded({ repo, key, error: error instanceof Error ? error.message : String(error) }));
    return () => { active = false; };
  }, [repo, key]);
  const data = loaded?.repo === repo ? loaded.data : undefined;
  const error = loaded?.key === key ? loaded.error : undefined;
  const refreshing = loaded?.key !== key;
  const start = year === null ? today - 364 * dayMs : Date.UTC(year, 0, 1);
  const end = year === null ? today : Date.UTC(year, 11, 31);
  const firstWeek = start - new Date(start).getUTCDay() * dayMs;
  const weeks = Math.ceil((end - firstWeek + dayMs) / (7 * dayMs));
  const dates = Array.from({ length: Math.round((end - start) / dayMs) + 1 }, (_, i) => iso(start + i * dayMs));
  const counts = dates.map((date) => data?.days[date] || 0);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const busiest = Math.max(1, ...counts);
  const level = (count: number) => count ? Math.min(4, Math.ceil(count / busiest * 4)) : 0;
  const years = [...new Set([currentYear, ...Object.keys(data?.days || {}).map((date) => Number(date.slice(0, 4))).filter((value) => value <= currentYear)])].sort((a, b) => b - a);
  const focusedDate = dates.includes(inspected) ? inspected : dates[dates.length - 1];
  function move(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const index = dates.indexOf(date);
    const next = event.key === "ArrowLeft" ? index - 7 : event.key === "ArrowRight" ? index + 7 : event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? dates.length - 1 : undefined;
    if (next !== undefined) {
      event.preventDefault();
      cells.current.get(dates[Math.max(0, Math.min(dates.length - 1, next))])?.focus();
    }
  }
  return <section className="repository-activity" aria-labelledby="repository-activity-title" aria-busy={refreshing}>
    <div className="activity-heading">
      <div><h2 id="repository-activity-title">Repository activity</h2><p>All contributors · Local and fetched branches</p></div>
      <button className="small" disabled={refreshing} onClick={() => setRevision((value) => value + 1)}>Refresh</button>
    </div>
    {error ? <div className="activity-unavailable" role="alert"><p>Couldn’t load repository activity.</p><pre>{error}</pre><button onClick={() => setRevision((value) => value + 1)}>Try again</button></div> : !data ? <p className="activity-loading" role="status">Loading repository activity…</p> : <div className="activity-layout">
      <div className="activity-main">
        <p className="activity-total">{total.toLocaleString()} {total === 1 ? "commit" : "commits"} {year === null ? "in the last year" : `in ${year}`}</p>
        <div className="activity-card">
          <div className="activity-scroll" role="region" aria-label="Contribution calendar; scroll horizontally on small windows" tabIndex={0}>
            <table className="activity-calendar" aria-label={`${year ?? "Last year"} repository commit activity`}>
              <colgroup><col className="activity-label-column" />{Array.from({ length: weeks }, (_, week) => <col key={week} />)}</colgroup>
              <thead><tr><td /><>{Array.from({ length: weeks }, (_, week) => {
                const date = new Date(firstWeek + week * 7 * dayMs);
                const monthStart = Array.from({ length: 7 }, (_, day) => new Date(date.getTime() + day * dayMs)).find((day) => day.getTime() >= start && day.getTime() <= end && day.getUTCDate() === 1);
                const month = monthStart || (week === 0 ? new Date(start) : null);
                return <th key={week} scope="col"><span>{month && week < weeks - 1 ? month.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) : ""}</span></th>;
              })}</></tr></thead>
              <tbody>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, weekday) => <tr key={day}>
                <th scope="row"><span className={weekday % 2 ? "" : "visually-hidden"}>{day}</span></th>
                {Array.from({ length: weeks }, (_, week) => {
                  const time = firstWeek + (week * 7 + weekday) * dayMs;
                  const date = iso(time);
                  const count = data.days[date] || 0;
                  const label = describe(date, count);
                  return <td key={date}>{time >= start && time <= end && <button
                    ref={(node) => { if (node) cells.current.set(date, node); else cells.current.delete(date); }}
                    className="activity-day" style={{ "--activity-level": `var(--activity-${level(count)})` } as CSSProperties}
                    tabIndex={focusedDate === date ? 0 : -1} aria-label={label} title={label}
                    onFocus={() => setInspected(date)} onMouseEnter={() => setInspected(date)} onClick={() => setInspected(date)} onKeyDown={(event) => move(event, date)}
                  />}</td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
          <div className="activity-footer">
            <span aria-live="polite">{inspected && dates.includes(inspected) ? describe(inspected, data.days[inspected] || 0) : "Hover or focus a day to see its commits"}</span>
            <span className="activity-legend" aria-label="Commit activity from less to more; relative to the busiest day" title="Colors scale to the busiest day in this period">Less{[0, 1, 2, 3, 4].map((value) => <i key={value} style={{ background: `var(--activity-${value})` }} />)}More</span>
          </div>
        </div>
        <p className="activity-note">Commit author dates. Shared commits count once. {data.shallow ? "Shallow clone: only downloaded history is included." : "Unfetched commits and uncommitted changes aren’t included."}</p>
      </div>
      <nav className="activity-years" aria-label="Activity year">{years.map((value) => <button key={value} aria-pressed={value === (year ?? currentYear)} onClick={() => { setYear(value === currentYear ? null : value); setInspected(""); }}>{value}</button>)}</nav>
    </div>}
  </section>;
}
