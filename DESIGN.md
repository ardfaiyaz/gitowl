# gitowl design guide

The rules every interface change follows. gitowl is a desktop tool for developers reviewing and changing
a repository, so frequent actions must stay legible, predictable and keyboard accessible. The look is
macOS/iOS: calm surfaces, capsule controls, inset grouped cards, and motion that explains rather than decorates.

- [Foundations](#foundations)
- [Components](#components)
- [Layouts](#layouts)
- [Motion](#motion)
- [Accessibility](#accessibility)
- [Content and copy](#content-and-copy)
- [Safety patterns](#safety-patterns)
- [Brand](#brand)

## Foundations

**Tokens.** Colours, radii, shadows and timings are CSS variables on `:root` in `frontend/src/App.css`,
redefined for dark mode (`data-theme` on the root, or the OS setting). Components use `var(--…)` only;
never hard-code a new colour.

**Colour.** iOS system colours, darkened where text needs 4.5:1 contrast:

| Role | Light | Notes |
|---|---|---|
| Filled accent (primary buttons) | `#0071E3` | hover `#0A7CF0`, pressed `#0062C4` |
| Accent text | `#005BBF` | links, secondary buttons |
| Success | `#1E7B34` | |
| Destructive | `#C00013` | red is reserved for destructive actions and things needing attention |
| Secondary label | `#5A5A5F` | dark mode `#A3ABBD` |
| Dark surfaces | `#11151F` / `#1B2333` | navy, not grey |

Status pills always include their text (open, merged, failed, draft…), never colour alone.

**Type.** The system font stack: SF Pro on Apple platforms, Segoe UI Variable then Inter elsewhere; nothing is
bundled, so the app stays offline. Body 14 px, secondary text at least 12 px, page titles 34 px bold with
−0.022em tracking. Monospace (`ui-monospace` / SF Mono) only for real code: paths, hashes, diffs, Git output.

**Shape.** Capsule buttons (36 px tall, 28–32 px small), 16 px radius cards, 20 px sheets, 0.5 px hairline
separators, white cards with a soft two-layer shadow and no border. Blur only on navigation chrome.

## Components

Reuse these; don't build look-alikes.

| Need | Use | Rules |
|---|---|---|
| Mutually exclusive choices | `<Segmented>` (`components/Segmented.tsx`) | Grey capsule track, 2 px inset, white sliding thumb, 13 px labels 500 → 600 when chosen. Never a row of loose buttons. |
| A question before acting | `<Dialog alert="destructive" \| "caution">` | 340 px, centred icon and title, one line of text, two equal buttons; the red one sits on the right and Cancel gets focus first. |
| A form | `<Sheet>` (`components/RepoDialogs.tsx`) | Cancel · title · action bar over inset grouped fields. Can't close while busy. No drag grabber on desktop. |
| Feedback after an action | `<Banner>` (`components/Dialog.tsx`) | Grows from zero height; success dismisses after 5 s (hover pauses), errors stay and show Git's output. May carry one action, e.g. Force push… after a rejected push. |
| Loading | `<Skeleton>` | Shimmer rows; screen readers hear one "Loading…". |
| Grouped settings | `.settings-group` / `.settings-row` | Label left, control right, hairline between rows. |
| Lists of records | `.grouped-list` | Inset hairlines that start where the text starts. |
| On/off | `input.switch` with `role="switch"` | |

Buttons: one filled (primary) action per area; the rest are tinted secondary capsules; destructive confirmations
use a red primary. Badges are neutral grey counts; red only when something needs attention.

## Layouts

- **Shell.** Sidebar (brand, search that opens the palette, Workspace pages with a grey sliding pill,
  Settings, recent projects, Light/Dark switch, identity) that collapses to a 76 px icon rail with
  <kbd>Ctrl</kbd> <kbd>B</kbd>. Toolbar with Fetch / Pull / Push. Status bar with branch and ahead/behind.
- **Page header.** The 34 px title, plus at most one page-level control on the right (`.header-slot`; GitHub
  places its section control there).
- **Overview.** Repository status as one line of linked facts, never metric tiles; review requests and the
  GitHub inbox when signed in.
- **Changes.** File list and commit form on the left, diff on the right. Diff toolbar: Hide whitespace, Wrap
  lines, Find, Unified / Side by side. While a server-side diff option is on, hunk staging pauses and says why.
  Images get Side by side / Swipe / Onion skin.
- **History.** Commit list with a drag grip (top or bottom quarter reorders, the middle squashes) and
  <kbd>Alt</kbd> <kbd>↑</kbd>/<kbd>↓</kbd>; both open the rebase plan pre-arranged. Filtered to one file, a Diff /
  Blame switch appears. The reflog sits under the diff.
- **GitHub.** Sections Pull requests / Issues / Actions / Releases / More. Pull requests and issues share one
  layout: header actions, tabs, and a 300 px details sidebar whose pickers save each choice immediately.
  Review threads sit under their diff line.
- **Settings.** A 240 px section list beside a pane of 17 px section titles over grouped cards. The danger zone
  is a red-ringed card.
- Lists and details stack below 760 px; settings below 900 px.

## Motion

Motion explains where something came from. Easing is the iOS curve `cubic-bezier(.32, .72, 0, 1)`.

| What | Timing |
|---|---|
| Sheets enter / exit | rise 24 px + scale .98 in 320 ms; exit 200 ms |
| Alerts | scale .94 → 1 in 260 ms |
| Notices | height grows from 0 in 320 ms so content slides down |
| Menus and popovers | open from their trigger in 150–180 ms |
| Segmented thumb, sidebar pill | slide 320 ms |
| Theme change | cross-fade 240 ms |
| Command palette | no animation: it's used dozens of times a day |

With `prefers-reduced-motion`, movement is removed and state changes are instant.

## Accessibility

- Every control is reachable by <kbd>Tab</kbd>, has an accessible name, and shows a 2 px focus ring
  (drawn inside scrolling lists).
- Dialogs are native `<dialog>`: focus is contained, <kbd>Escape</kbd> cancels, focus returns to the trigger.
- Text contrast is at least 4.5:1 in both themes; status never relies on colour alone.
- Shortcuts never fire while typing in a field or with a dialog open.
- Check every change in light and dark mode, at a narrow window width, and with the keyboard only.

## Content and copy

- Plain words over Git jargon where a plain word exists; say what will happen and whether it can be undone.
- Empty states say what to do ("Select a file or commit to see its changes").
- No marketing or reassurance copy in the work surface; no eyebrow labels above headings; no decorative icon tiles.
- Show each fact once (the repository path lives in the project switcher's tooltip, not under every heading).
- Identity shows name and email; no letter avatars.

## Safety patterns

- Anything that rewrites history or resets a branch saves a recovery point under `refs/gitowl/recovery/` first
  and says so.
- Irreversible remote actions (delete a repository, delete an issue, force push to the default branch) need the
  exact name or number typed.
- Force pushes always use `--force-with-lease` and list the remote commits that will be replaced.
- Destructive lists (Clean) show the exact files first; only ticked items are removed.
- Secret values are write-only: never displayed, logged or stored.

## Brand

The mark is the **Commit Eyes owl**: an owl whose eyes are commit nodes, framed by lighter facial-disc rings
(royal blue `#0071E3`, sky `#3D9BFF` / `#5AC8FA`, navy `#0A2A66`, white), drawn on a 256 grid and legible at 16 px.
The lockup sets "gitowl" in outlined Inter Display Bold, "git" black and "owl" blue, owl on the left.
Masters live in `assets/brand/`:

| File | Use |
|---|---|
| `gitowl-mark.svg` (+ `png/gitowl-16…1024.png`, `gitowl.ico`, `gitowl.icns`, `window-icon-64.rgba`) | App icon: window and taskbar (`src/desktop.rs`), executable (`build.rs`), installer, macOS app, Linux menu, favicon |
| `gitowl-lockup.svg` / `.png` | Welcome page, sidebar, README |
| `gitowl-lockup-on-dark.svg` / `.png` | The lockup on dark backgrounds |

Inter is used under the SIL Open Font License (`assets/brand/Inter-OFL.txt`); SF Pro's licence doesn't allow
logo use. `frontend/public/` holds copies of the mark (as `favicon.svg`) and lockups; update them with the masters.
