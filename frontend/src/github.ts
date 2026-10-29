// Shared GitHub view helpers for GitHubPanel and the pull request review parts.
export type Check = {
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  startedAt?: string;
  completedAt?: string;
};
export type ReviewThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  comments: { nodes: { id: string; body: string; createdAt: string; author: { login: string } | null }[] };
};

export const when = (value?: string) => (value ? new Date(value).toLocaleString() : "");
export const outcome = (c: { conclusion?: string; status?: string; state?: string }) =>
  (c.conclusion || c.state || c.status || "pending").toLowerCase();
// Check runs report status until COMPLETED; legacy status contexts report state PENDING/EXPECTED.
export const running = (c: Check) => (c.status ? c.status !== "COMPLETED" : /pending|expected/i.test(c.state || ""));
