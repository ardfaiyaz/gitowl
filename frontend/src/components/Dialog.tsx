import { useEffect, useRef, type ReactNode } from "react";
import "../styles/screens.css";

// Placeholder rows while a list loads; screen readers hear one "Loading…" status instead.
export function Skeleton({ rows = 3, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-list" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton-row" aria-hidden="true" />
      ))}
    </div>
  );
}

// React removes a dialog the moment its owner closes it, however that happens, so an inert
// copy plays the exit instead: faster than the entrance, and never focusable or clickable.
function playExit(dialog: HTMLDialogElement) {
  const ghost = dialog.cloneNode(true) as HTMLDialogElement;
  const scrim = document.createElement("div");
  ghost.classList.add("dialog-exit");
  scrim.className = "dialog-exit-scrim";
  ghost.inert = true;
  ghost.setAttribute("aria-hidden", "true");
  // Clones keep attributes, not what was typed, so copy the live field values across.
  const fields = dialog.querySelectorAll<HTMLInputElement>("input, textarea, select");
  ghost.querySelectorAll<HTMLInputElement>("input, textarea, select").forEach((field, i) => {
    field.value = fields[i].value;
    field.checked = fields[i].checked;
  });
  document.body.append(scrim, ghost);
  ghost.scrollTop = dialog.scrollTop;
  const timing = { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" as const };
  scrim.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  ghost
    .animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px) scale(0.98)" }], timing)
    .finished.finally(() => {
      ghost.remove();
      scrim.remove();
    });
}

export function Dialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
  header,
  alert,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  // Replaces the default title + Close row, e.g. an iOS Cancel / title / Apply bar.
  header?: ReactNode;
  // A one-question alert (board: Popups & Modals): 340 px, centred icon and title, two equal buttons.
  alert?: "destructive" | "caution";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const opened = performance.now();
    dialog.showModal();
    return () => {
      // StrictMode's instant remount in development is not a real close.
      if (performance.now() - opened > 100 && !matchMedia("(prefers-reduced-motion: reduce)").matches) playExit(dialog);
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal native-dialog " + (alert ? "alert" : "sheet") + (wide ? " conflict-modal" : "")}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {alert ? (
        <>
          <span className={"alert-icon " + alert} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d={alert === "destructive" ? "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" : "M12 8v5M12 16.5h.01"} />
            </svg>
          </span>
          <h2>{title}</h2>
        </>
      ) : header ?? (
        <div className="section-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="close-dialog"
            aria-label="Close dialog"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      )}
      {children}
    </dialog>
  );
}
