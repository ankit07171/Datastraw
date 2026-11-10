import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { Issue } from '../engine';

export function Header() {
  const { month, rosterList, loadRoster, generate, publish, busy, meta, validation, roster, stale } = useStore();
  const [blocked, setBlocked] = useState<{ count: number; issues: Issue[] } | null>(null);
  const [reason, setReason] = useState('');
  const months = [...new Set([...rosterList.map(r => r.month), month])].sort();
  const s = validation?.stats;

  const doPublish = async (override = false) => {
    const r = await publish(override, reason);
    if (r.blocked) setBlocked(r.blocked); else if (r.ok) { setBlocked(null); setReason(''); }
  };

  return (
    <>
      <div className="topbar">
        <span className="brand">Roster Desk</span>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          Month
          <input type="month" value={month} aria-label="Month" onChange={e => e.target.value && loadRoster(e.target.value)} list="months" />
          <datalist id="months">{months.map(m => <option key={m} value={m} />)}</datalist>
        </label>
        {meta && <span className={`pill ${meta.status}`}>{meta.status === 'published' ? `Published v${meta.version}` : `Draft v${meta.version}`}</span>}
        {stale && <span className="pill stale">Data changed</span>}
        <span className="spacer" />
        {s && (
          <div className="stats" aria-label="Roster health">
            <span className={`chip ${s.coveragePct >= 100 ? 'ok' : ''}`}><b>{s.coveragePct}%</b> coverage</span>
            <span className={`chip ${s.errors ? 'bad' : 'ok'}`}><b>{s.errors}</b> must fix</span>
            <span className="chip"><b>{s.warnings}</b> warnings</span>
          </div>
        )}
        <button className={`btn ${stale ? 'nudge' : ''}`} disabled={busy} onClick={generate}>{roster ? 'Regenerate' : 'Generate roster'}</button>
        {roster && <a className="btn" href={api.url(`/rosters/${month}/export.csv`)}>Export CSV</a>}
        {roster && <button className="btn primary" disabled={busy || meta?.status === 'published'} onClick={() => doPublish(false)}>Publish</button>}
      </div>

      {blocked && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Cannot publish">
          <div className="modal">
            <h2>{blocked.count} mandatory issue{blocked.count === 1 ? '' : 's'} left</h2>
            <p>The server re-checked this roster. Fix these first, or publish anyway with a written reason that is stored with the roster.</p>
            <ul className="small">{blocked.issues.slice(0, 5).map(i => <li key={i.id}>{i.message}</li>)}</ul>
            {blocked.count > 5 && <p className="muted small">…and {blocked.count - 5} more in the Issues tab.</p>}
            <label className="field">Reason for publishing anyway
              <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Client agreed to reduced weekend coverage this month" /></label>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setBlocked(null)}>Go back and fix</button>
              <button className="btn danger" disabled={!reason.trim()} onClick={() => doPublish(true)}>Publish anyway</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
