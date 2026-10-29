const hash = new URLSearchParams(location.hash.slice(1));
const token =
  hash.get("token") || sessionStorage.getItem("gitowl-token") || "";
if (hash.has("token")) {
  sessionStorage.setItem("gitowl-token", token);
  history.replaceState(null, "", location.pathname);
}
export async function api<T>(op: string, data: object = {}): Promise<T> {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-gitowl-token": token },
    body: JSON.stringify({ op, ...data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Operation failed");
  return result;
}
