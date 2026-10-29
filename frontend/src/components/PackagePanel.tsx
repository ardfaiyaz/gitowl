import { useEffect, useState } from "react";
import { api } from "../api";
import { Dialog, Skeleton } from "./Dialog";

type Package = {
  ecosystem: string;
  manifest: string;
  name: string;
  version: string;
  publishable: boolean;
};
type Run = (work: () => Promise<void>) => Promise<boolean>;

// Publishes the repository's npm or Cargo package with the developer's own registry login.
export function PackagePanel({ repo, busy, run }: { repo: string; busy: boolean; run: Run }) {
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState<Package | null>(null);
  const [confirm, setConfirm] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    api<{ packages: Package[] }>("packages", { repo })
      .then((v) => active && setPackages(v.packages))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [repo]);
  const call = (pkg: Package, dryRun: boolean) =>
    run(async () => {
      try {
        const value = await api<{ message: string; output: string }>("package_publish", {
          repo,
          ecosystem: pkg.ecosystem,
          dryRun,
          confirm,
        });
        setOutput(value.message + "\n\n" + value.output);
        setError("");
        if (dryRun) setChecked((list) => [...list, pkg.ecosystem]);
        else setPublishing(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  return (
    <section className="settings-card">
      <h2>Publish package</h2>
      <p>
        Uses <code>npm publish</code> or <code>cargo publish</code> with your
        existing registry login. Run a dry run first; a real publish asks you
        to type the exact name and version.
      </p>
      {packages && !packages.length && (
        <p className="hint">No package.json or Cargo.toml package at the repository root.</p>
      )}
      {!packages && !error && <Skeleton rows={1} label="Looking for packages…" />}
      <ul className="recovery-list stagger">
        {packages?.map((pkg) => (
          <li key={pkg.ecosystem}>
            <div>
              <strong>
                {pkg.name}@{pkg.version}
              </strong>
              <small>
                {pkg.ecosystem} · {pkg.manifest}
                {!pkg.publishable && " · marked private"}
              </small>
            </div>
            <button disabled={busy || !pkg.publishable} onClick={() => void call(pkg, true)}>
              Dry run
            </button>
            <button
              disabled={busy || !pkg.publishable || !checked.includes(pkg.ecosystem)}
              title={checked.includes(pkg.ecosystem) ? undefined : "Run a dry run first"}
              onClick={() => {
                setConfirm("");
                setError("");
                setPublishing(pkg);
              }}
            >
              Publish…
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <pre className="inline-warning" role="alert">
          {error}
        </pre>
      )}
      {output && <pre className="hint package-output">{output}</pre>}
      {publishing && (
        <Dialog title="Publish package" busy={busy} onClose={() => setPublishing(null)}>
          <p>
            Publish <strong>{publishing.name}@{publishing.version}</strong> to{" "}
            {publishing.ecosystem === "npm" ? "the npm registry" : "crates.io"}?
            Published versions cannot be replaced, and anyone can download them.
          </p>
          <label htmlFor="package-confirm">
            Type {publishing.name}@{publishing.version} to confirm
          </label>
          <input id="package-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && (
            <pre className="modal-error" role="alert">
              {error}
            </pre>
          )}
          <div className="modal-footer">
            <button onClick={() => setPublishing(null)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || confirm !== `${publishing.name}@${publishing.version}`}
              onClick={() => void call(publishing, false)}
            >
              {busy ? "Publishing…" : "Publish"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

type Update = { current: string; latest: string; url: string; newer: boolean };

// Contacts GitHub only when the developer presses the button.
export function UpdatePanel({ busy, run }: { busy: boolean; run: Run }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState("");
  return (
    <section className="settings-card">
      <h2>Updates</h2>
      <p>gitowl never checks in the background. Check the latest published release on demand.</p>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            try {
              setUpdate(await api<Update>("update_check"));
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
      >
        Check for updates
      </button>
      {update && (
        <p role="status">
          {update.newer
            ? `gitowl ${update.latest} is available (you have ${update.current}). Download it from ${update.url}.`
            : `You have the latest version (${update.current}).`}
        </p>
      )}
      {error && (
        <pre className="inline-warning" role="alert">
          {error}
        </pre>
      )}
    </section>
  );
}
