import { useEffect, useRef, useState, type ReactNode } from "react";

// Visual reference: desktop/desktop app/styles/ui/window/_toast-notification.scss.
export function Toast({ kind, text, onDismiss, action }: {
  kind: "error" | "success";
  text: string;
  onDismiss: () => void;
  action?: ReactNode;
}) {
  return text ? <ToastMessage key={text} kind={kind} text={text} onDismiss={onDismiss} action={action} /> : null;
}

function ToastMessage({ kind, text, onDismiss, action }: {
  kind: "error" | "success";
  text: string;
  onDismiss: () => void;
  action?: ReactNode;
}) {
  const [closing, setClosing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const remaining = useRef(3000);
  const lines = text.trim().split(/\r?\n/);
  const summary = lines[0].length > 220 ? lines[0].slice(0, 220) + "…" : lines[0];
  const hasDetails = lines.length > 1 || summary !== lines[0];

  useEffect(() => {
    if (kind === "error" || closing || hovered || focused || expanded) return;
    const started = performance.now();
    const timer = setTimeout(() => setClosing(true), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [kind, closing, hovered, focused, expanded]);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onDismiss, 250);
    return () => clearTimeout(timer);
  }, [closing, onDismiss]);

  return (
    <div
      className={"toast-notification" + (closing ? " toast-closing" : "")}
      role={kind === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setClosing(true);
        }
      }}
    >
      <div className="toast-content">
        <span>{summary}</span>
        {hasDetails && <details className="toast-details" onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>Details</summary>
          <pre>{text}</pre>
        </details>}
        {action && <div className="toast-actions">{action}</div>}
      </div>
      {kind === "error" && <button className="toast-close" onClick={() => setClosing(true)} aria-label="Dismiss error">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 0 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>}
    </div>
  );
}
