import type { CSSProperties } from "react";

// iOS segmented control: a grey capsule track with a white thumb that slides to the chosen option.
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const sel = Math.max(0, options.findIndex(([key]) => key === value));
  return (
    <div className={"segmented " + className} role="group" aria-label={label} style={{ "--n": options.length, "--sel": sel } as CSSProperties}>
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={key === value} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}
