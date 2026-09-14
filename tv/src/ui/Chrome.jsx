import { pad2 } from '../tokens.js';
import Icon from './Icon.jsx';

/** Shared kiosk chrome, display-only: kickers, counters, pills, the chapter header, empty states. */

export function Kicker({ children, color, className = '' }) {
  return <div className={`kicker ${className}`} style={color ? { color } : undefined}>{String(children ?? '').toUpperCase()}</div>;
}

export function Counter({ current, total, className = '' }) {
  return <div className={`pill counter ${className}`}>{pad2(current)} / {pad2(total)}</div>;
}

export function Pill({ children, on = false, icon, className = '', style }) {
  return (
    <div className={`pill ${on ? 'pill-on' : ''} ${className}`} style={style}>
      {icon ? <Icon name={icon} /> : null}
      <span>{String(children ?? '').toUpperCase()}</span>
    </div>
  );
}

/** Top-left: project wordmark and "02 · Inventory", so a viewer across the room knows where they are. */
export function ChapterHead({ data, meta, children }) {
  return (
    <div className="chapter-head">
      {data?.org?.logo_url ? <img className="chapter-logo" src={data.org.logo_url} alt="" /> : null}
      <div className="chapter-brand">{data?.name}</div>
      {meta ? (
        <div className="chapter-crumb">
          <span className="chapter-no">{meta.no}</span>
          <span className="chapter-name">{meta.name.toUpperCase()}</span>
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Empty({ title, children, icon = 'tv' }) {
  return (
    <div className="empty">
      <div className="empty-card">
        <Icon name={icon} size="3rem" color="var(--gold)" strokeWidth={1.4} />
        {title ? <div className="empty-title">{title}</div> : null}
        {children ? <div className="empty-text">{children}</div> : null}
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="empty">
      <div className="spinner" />
      <div className="loading-label">{String(label).toUpperCase()}…</div>
    </div>
  );
}
