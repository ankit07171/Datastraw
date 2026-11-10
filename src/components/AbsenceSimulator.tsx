import { useMemo, useState } from 'react';
import { useStore, type AbsenceResult } from '../store';
import { shortDate } from './shared';

export function AbsenceSimulator() {
  const { ctx, roster, month, simulateAbsence, select, setTab } = useStore();
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState<'L' | 'CO'>('L');
  const [result, setResult] = useState<AbsenceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const emp = (id: string) => ctx?.emp.get(id)?.name ?? id;

  // Demo shortcut: the only person on Bloom Organics' Abandoned Cart process, on a day they are working.
  const demo = useMemo(() => {
    if (!ctx || !roster) return null;
    const owner = ctx.primariesOf.get('bloom-ACC')?.[0];
    const day = owner && ctx.days.find(d => d > `${month}-16` && roster.cells[owner]?.[d] === 'W' && !ctx.holidays.has(d));
    return owner && day ? { owner, day } : null;
  }, [ctx, roster, month]);

  if (!ctx || !roster) return <div className="panel empty"><h3>No roster yet</h3><p>Generate a roster before simulating changes.</p></div>;
  const ready = employeeId && date;
  const run = async (apply: boolean) => {
    setBusy(true);
    const r = await simulateAbsence({ employeeId, date, type, apply });
    setBusy(false);
    setResult(apply ? null : r);
    if (apply && r) setTab('issues');
  };

  return (
    <div className="row2" style={{ gridTemplateColumns: 'minmax(280px,1fr) minmax(0,2fr)' }}>
      <div className="panel">
        <h2>New leave or comp-off</h2>
        <p className="muted small">Pick who is unavailable and when. You’ll see the effect before anything changes.</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <label className="field">Employee
            <select value={employeeId} onChange={e => { setEmployeeId(e.target.value); setResult(null); }}>
              <option value="">Choose…</option>
              {ctx.cfg.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></label>
          <label className="field">Date
            <input type="date" value={date} min={ctx.days[0]} max={ctx.days[ctx.days.length - 1]}
              onChange={e => { setDate(e.target.value); setResult(null); }} /></label>
          <label className="field">Type
            <select value={type} onChange={e => setType(e.target.value as 'L' | 'CO')}>
              <option value="L">Leave</option><option value="CO">Comp-off</option></select></label>
          <button className="btn primary" disabled={!ready || busy} onClick={() => run(false)}>Preview impact</button>
        </div>
      </div>

      <div>
        {!result ? (
          <div className="panel empty"><h3>No preview yet</h3><p>Choose an employee and date, then preview the impact on coverage.</p></div>
        ) : (
          <>
            <div className="panel">
              <h2>What this leave does</h2>
              <div className="kv">
                <div><b>{result.beforeRepair.errors}</b>issues if nothing else changes</div>
                <div><b>{result.afterRepair.errors}</b>issues after automatic repair</div>
                <div><b>{result.afterRepair.coveragePct}%</b>coverage after repair</div>
                <div><b>{result.changes.length}</b>cells moved</div>
              </div>
              {result.gapsCausedByChange.length === 0
                ? <p>No coverage gap is created by this absence.</p>
                : <>
                  <h3>Gaps it creates</h3>
                  {result.gapsCausedByChange.map(g => <div className="issue" key={g.id}><i className="dot error" /><div className="grow">{g.message}</div></div>)}
                </>}
            </div>
            <div className="panel">
              <h3>What the automatic repair changes</h3>
              {result.changes.length === 0 ? <p className="muted">Nothing needs to move.</p>
                : result.changes.map((c, i) => <div key={i}>{emp(c.employeeId)}: {shortDate(c.date)} {c.from} → {c.to}</div>)}
              <p className="muted small">Only this person’s week is replanned. Everyone else stays as published, and cells you pinned by hand are never moved. Relief bookings are recalculated.</p>
            </div>
            {result.remainingGaps.length > 0 && (
              <div className="panel">
                <h3>Still needs your decision ({result.remainingGaps.length})</h3>
                {result.remainingGaps.map(({ issue, suggestions }) => (
                  <div className="issue" key={issue.id}><i className="dot error" />
                    <div className="grow">{issue.message}
                      <div className="muted small">{suggestions[0] ? `Best option: ${suggestions[0].title}` : 'No automatic option found.'}</div></div></div>
                ))}
                <p className="muted small">Approve the leave, then use “See fixes” on each gap.</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn primary" disabled={busy} onClick={() => run(true)}>Approve leave and apply repair</button>
              <button className="btn" onClick={() => setResult(null)}>Discard preview</button>
              {result.remainingGaps[0]?.issue.processId && <button className="btn" onClick={() => { setTab('roster'); select({ processId: result.remainingGaps[0].issue.processId!, date: result.remainingGaps[0].issue.date! }); }}>Open first gap</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
