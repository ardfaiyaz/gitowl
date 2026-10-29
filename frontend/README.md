# gitowl frontend

The React 19 + TypeScript interface of gitowl, built with Vite. The Rust app embeds the
production build (`frontend/dist`) into the `gitowl` executable, so **build this first**,
then run `cargo run` from the repository root.

```sh
npm ci             # install exact dependency versions from package-lock.json
npm run build      # type-check (tsc -b) and build into dist/
npm run lint       # ESLint, including the React Compiler hook rules
```

`npm run dev` starts the Vite dev server for styling work only: Git and GitHub operations
need the authenticated Rust server, so use `cargo run` for anything end to end.

## Where things live

| Path | Purpose |
|---|---|
| `src/App.tsx` | Shell, pages (Overview, Changes, History, Branches, GitHub, Settings) and app state |
| `src/api.ts` | The single `api(op, data)` call to the local server, with the session token |
| `src/components/` | Screens and shared parts: `Segmented`, `Dialog` (sheets and alerts), `Diff`, `PrParts`, … |
| `src/styles/shell.css`, `src/styles/screens.css`, `src/App.css` | Design tokens and component styles |

Design rules (tokens, the segmented control, alerts vs. sheets, motion) are in
[`../DESIGN.md`](../DESIGN.md). See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) before opening a pull request.
