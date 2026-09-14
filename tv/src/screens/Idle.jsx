import Icon from '../ui/Icon.jsx';
import { Loading } from '../ui/Chrome.jsx';
import { NEUTRAL_BRAND } from '../tokens.js';
import './Idle.css';

/**
 * The TV when nothing is being presented: pairing code + QR while unclaimed, the TV's name and
 * what's on it once claimed, and a clear "no content yet" state (with the reason) when the box
 * has nothing to show — e.g. against a backend that doesn't serve manifests yet.
 *
 * Branding is the client's, never ours: `status.org` ({name, logo_url}) comes from the heartbeat
 * once the box is claimed; an unclaimed box shows a neutral "Experience Center".
 */
export default function Idle({ status, connected }) {
  if (!status) return <div className="idle"><Loading label={connected ? 'Starting' : 'Connecting to the box'} /></div>;

  const projects = status.projects ?? [];
  const sync = status.sync ?? { state: 'idle', progress: 1, error: null };
  const syncing = sync.state === 'syncing';
  const address = status.lan_addresses?.[0];
  const code = status.pairing_code ? String(status.pairing_code) : null;
  const orgName = status.org?.name || null;
  const orgLogo = status.org?.logo_url || null;

  return (
    <div className="idle">
      <div className="idle-glow" />
      {projects[0]?.hero_image ? <img className="idle-bg" src={projects[0].hero_image} alt="" /> : null}

      <header className="idle-top">
        <div className="idle-brand">
          {orgLogo ? <img className="idle-logo" src={orgLogo} alt="" /> : null}
          {orgName ? <>{orgName} <span>Experience Center</span></> : NEUTRAL_BRAND}
        </div>
        <div className="idle-net">
          <span className={`dot ${status.online ? 'dot-good' : ''}`} />
          <span>{status.online ? 'ONLINE' : 'OFFLINE'}</span>
          {address ? <span className="idle-addr">{address}:{status.port}</span> : null}
        </div>
      </header>

      <main className="idle-main">
        <section className="idle-left">
          {status.claimed ? (
            <>
              <div className="kicker">This TV</div>
              <h1 className="idle-name">{status.name || 'Showroom TV'}</h1>
              <p className="idle-sub">
                {projects.length
                  ? 'Ready to present. Open a project on the tablet and tap Present.'
                  : 'Paired. Content will appear here once a project is assigned and downloaded.'}
              </p>
            </>
          ) : code ? (
            <>
              <div className="kicker">Pair this TV</div>
              <h1 className="idle-h1">Scan with the showroom tablet</h1>
              <p className="idle-sub">Or enter this code in <b>Devices → Pair a TV</b>.</p>
              <div className="idle-code">
                {code.split('').map((d, i) => <span key={i}>{d}</span>)}
              </div>
            </>
          ) : (
            <>
              <div className="kicker">Pair this TV</div>
              <h1 className="idle-h1">Waiting for the content service</h1>
              <p className="idle-sub">
                {status.online ? 'Fetching a pairing code…' : 'This TV is offline. It will show a pairing code when it can reach the internet.'}
              </p>
            </>
          )}
        </section>

        {!status.claimed && status.qr_data_uri ? (
          <section className="idle-qr">
            <img src={status.qr_data_uri} alt="Pairing QR" />
            {orgName ? <div className="idle-qr-caption">{orgName}</div> : null}
          </section>
        ) : null}
      </main>

      <footer className="idle-foot">
        {syncing ? (
          <div className="idle-state">
            <Icon name="download" size="2.2rem" color="var(--gold)" />
            <div className="idle-state-body">
              <div className="idle-state-title">Downloading content · {Math.round((sync.progress ?? 0) * 100)}%</div>
              <div className="idle-bar"><div style={{ width: `${Math.round((sync.progress ?? 0) * 100)}%` }} /></div>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="idle-state idle-state-empty">
            <Icon name="tv" size="2.2rem" color="var(--gold)" />
            <div className="idle-state-body">
              <div className="idle-state-title">No content on this TV yet</div>
              <div className="idle-state-text">{emptyReason(status)}</div>
            </div>
          </div>
        ) : (
          <div className="idle-projects">
            <div className="kicker idle-projects-kick">On this TV</div>
            {projects.slice(0, 4).map((p) => (
              <div key={p.slug} className="idle-project">
                {p.hero_image ? <img src={p.hero_image} alt="" /> : <div className="idle-project-ph" />}
                <div>
                  <div className="idle-project-name">{p.name}</div>
                  <div className="idle-project-meta">VERSION {p.version ?? '—'}</div>
                </div>
              </div>
            ))}
            {sync.state === 'error' && !status.content_unavailable ? (
              <div className="idle-warn">Last update failed — showing the last complete version.</div>
            ) : null}
          </div>
        )}
        <div className="idle-device">
          {status.device_id != null ? `DEVICE ${status.device_id}` : 'NOT REGISTERED'} · v{status.app_version}
        </div>
      </footer>
    </div>
  );
}

function emptyReason(status) {
  if (status.content_unavailable) return 'The content service isn’t available yet. This TV checks again automatically and will download projects as soon as it is.';
  if (status.sync?.state === 'error' && status.sync.error) return `The last download didn’t finish (${status.sync.error}). It will retry automatically.`;
  if (!status.online) return 'This TV is offline and has no downloaded projects.';
  if (!status.claimed) return 'Pair this TV, then assign a project to it in the CRM.';
  return 'Assign a project to this TV in the CRM. It will download here automatically.';
}
