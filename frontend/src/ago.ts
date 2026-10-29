// Relative time ("3 hours ago") for unix-seconds timestamps.
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
export function ago(unixSeconds: string) {
  const diff = Number(unixSeconds) - Date.now() / 1000;
  for (const [unit, size] of units)
    if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit);
  return "just now";
}
