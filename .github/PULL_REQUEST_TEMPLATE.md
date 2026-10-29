## What and why

<!-- What does this change, and why? Link the issue: "Closes #123". -->

## How it was tested

<!-- Commands you ran and what you checked by hand (OS, light/dark mode, narrow window). -->

## Screenshots

<!-- Before / after, for any visible change. -->

## Checklist

- [ ] `npm --prefix frontend run lint` and `npm --prefix frontend run build` pass
- [ ] `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings` and `cargo test --locked` pass
- [ ] `node scripts/smoke.mjs` passes against a fresh `cargo build`
- [ ] New logic has a test; user input is validated at the server boundary
- [ ] UI changes follow [DESIGN.md](../DESIGN.md) and were checked in light and dark mode
- [ ] User-facing changes are noted under **Unreleased** in [CHANGELOG.md](../CHANGELOG.md)
