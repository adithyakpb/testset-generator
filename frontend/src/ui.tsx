import { type ReactNode } from "react";

export function Badge({ tone, children }: { tone?: "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  const cls = tone ? `badge badge-${tone}` : "badge";
  return <span className={cls}>{children}</span>;
}

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button className={`btn btn-${variant}`} onClick={onClick} disabled={disabled} type={type} title={title}>
      {children}
    </button>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress-wrap">
      <div className="progress-bar" style={{ width: `${pct}%` }} />
      <span className="progress-label">
        {done}/{total} ({pct}%)
      </span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Highlight noisy/code-mixed tokens in a user utterance. */
const HINGLISH = /\b(arre|yaar|bhai|kya|karo|karna|kar|sakta|sakti|hoon|hai|hain|nahi|kab|milega|wapas|paisa|kahan|plz|mujhe|dena|lega|padega|ho|gay[ei]|purana|dikkat|problm|jis|se|mein|ko)\b/gi;
export function NoisyText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(HINGLISH)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark key={idx} className="hl">
        {m[0]}
      </mark>,
    );
    last = idx + m[0].length;
  }
  parts.push(text.slice(last));
  return <span>{parts}</span>;
}
