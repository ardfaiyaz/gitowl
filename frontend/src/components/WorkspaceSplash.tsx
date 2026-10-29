export function WorkspaceSplash({ dark }: { dark: boolean }) {
  return (
    <main className="workspace-splash" aria-busy="true" aria-label="Opening your workspace">
      <div className="splash-art" role="status">
        <img
          src={dark ? "/gitowl-lockup-on-dark.svg" : "/gitowl-lockup.svg"}
          alt="gitowl"
          width="360"
          height="132"
        />
        <span className="splash-light" aria-hidden="true" />
        <span className="visually-hidden">Opening your workspace…</span>
      </div>
    </main>
  );
}
