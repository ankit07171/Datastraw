import { weekday } from '../engine';
import { useStore } from '../store';
import { CODE_LABEL, STATUS_LABEL, STATUS_SHORT } from './shared';

// Employee-wise view: one person's month, including relief duty, holidays and leave.
export function EmployeeCalendar({ employeeId }: { employeeId: string }) {
  const { ctx, roster, validation, toggleCell } = useStore();
  if (!ctx || !roster || !validation) return null;
  const e = ctx.emp.get(employeeId);
  if (!e) return null;
  const row = roster.cells[employeeId] ?? {};
  const lead = (weekday(ctx.days[0]) + 6) % 7;                         // blanks before the 1st (Monday-first)
  const count = (s: string) => ctx.days.filter(d => row[d] === s).length;
  const reliefOn = (d: string) => roster.reliefs.filter(r => r.employeeId === employeeId && r.date === d);
  const pinned = new Set(roster.pinned);
  const label = (pid: string) => `${ctx.brandName.get(ctx.proc.get(pid)!.brandId)} › ${ctx.proc.get(pid)!.name}`;
  const prim = ctx.primaryProcsOf.get(employeeId) ?? [], back = ctx.backupProcsOf.get(employeeId) ?? [];
  const mine = validation.issues.filter(i => i.employeeId === employeeId);
  const reliefDays = roster.reliefs.filter(r => r.employeeId === employeeId).length;

  return (
    <div className="row2" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(260px,1fr)' }}>
      <div className="panel">
        <h2>{e.name}</h2>
        <p className="muted small">{ctx.cfg.pods.find(p => p.id === e.podId)?.name} · {e.weeklyOffs} weekly off · max {e.maxConsecutiveWorkDays} days in a row</p>
        <div className="kv">
          <div><b>{count('W')}</b>working days</div><div><b>{count('WO')}</b>weekly offs</div>
          <div><b>{count('L') + count('CO')}</b>leave / comp-off</div><div><b>{count('PH') + count('CL')}</b>holidays / closed</div>
          <div><b>{reliefDays}</b>relief days</div>
        </div>
        <div className="cal">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="dow">{d}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="day blank" />)}
          {ctx.days.map(d => {
            const s = row[d];
            const rl = reliefOn(d);
            const hol = ctx.cfg.holidays.find(h => h.date === d);
            const editable = s === 'W' || s === 'WO';
            return (
              <button key={d} className={`day s-${s ?? 'none'}`} disabled={!editable}
                onClick={() => toggleCell(employeeId, d)} style={{ opacity: 1 }}
                title={editable ? 'Click to swap working / weekly off' : 'Set by calendar or approved absence'}>
                <b>{Number(d.slice(8))}</b>
                <span>{s ? (s === 'W' ? 'Working' : STATUS_LABEL[s]) : '—'}{hol ? ` · ${hol.name}` : ''}</span>
                {rl.length > 0 && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Relief: {rl.map(r => ctx.proc.get(r.processId)!.name).join(', ')}</span>}
                {pinned.has(`${employeeId}|${d}`) && <span>pinned</span>}
              </button>
            );
          })}
        </div>
        <p className="small muted">Status key: {Object.entries(STATUS_SHORT).map(([k, v]) => `${v} = ${STATUS_LABEL[k as keyof typeof STATUS_LABEL]}`).join(', ')}</p>
      </div>
      <div>
        <div className="panel">
          <h3>Assignments</h3>
          {prim.length === 0 && back.length === 0 && <p className="muted">Not assigned to any process.</p>}
          {prim.map(p => <div key={p}>{label(p)} <span className="tag">owner</span></div>)}
          {back.map(p => <div key={p}>{label(p)} <span className="tag">backup</span></div>)}
        </div>
        <div className="panel">
          <h3>Issues for {e.name.split(' ')[0]} ({mine.length})</h3>
          {mine.length === 0 && <p className="muted">Nothing to resolve.</p>}
          {mine.slice(0, 12).map(i => (
            <div className="issue" key={i.id}>
              <i className={`dot ${i.severity}`} />
              <div className="grow"><div className="small muted">{CODE_LABEL[i.code]}</div>{i.message}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
