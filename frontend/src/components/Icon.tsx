import type { CSSProperties } from "react";
export type IconName =
  | "folder"
  | "branch"
  | "history"
  | "settings"
  | "changes"
  | "up"
  | "down"
  | "refresh"
  | "check"
  | "cloud"
  | "grid"
  | "search"
  | "sidebar"
  | "sun"
  | "moon";
const paths: Record<IconName, string> = {
  folder: "M3 7V5h6l2 2h10v13H3V7Z",
  branch:
    "M6 3v12m0-6c0 0 12 1 12-6M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0M15 3a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2",
  settings:
    "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z",
  changes: "M8 3H4v18h16V3h-4M9 3h6v4H9V3Zm-1 9h8m-8 4h5",
  up: "M12 20V4m-6 6 6-6 6 6",
  down: "M12 4v16m-6-6 6 6 6-6",
  refresh: "M20 7a9 9 0 1 0 1 9M20 2v6h-6",
  check: "m4 12 5 5L20 6",
  cloud: "M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18Z",
  grid: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14m9 16-4.5-4.5",
  sidebar: "M4 5h16v14H4V5Zm5 0v14",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10Z",
};
export function Icon({
  name,
  style,
}: {
  name: IconName;
  style?: CSSProperties;
}) {
  return (
    <svg
      className="icon"
      style={style}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
