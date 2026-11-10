import { Fragment, useMemo } from 'react';
import { WEEKDAYS, weekday, type ISODate } from '../engine';
import { useStore } from '../store';
import { STATUS_LABEL, STATUS_SHORT } from './shared';

export interface Group { label?: string; ids: string[] }

// One grid for every view. The caller decides WHICH employees (rows) and WHICH processes
// (coverage rows) to show; the grid itself never knows what a "pod" or "brand" is.
export function RosterGrid({ groups, processIds, summary, subtitle }: {
  groups: Group[]; processIds: string[]; summary?: boolean; subtitle?: (empId: string) => string;
}) {
  const { ctx, roster, validation, toggleCell, select, selected } = useStore();
  const reliefs = useMemo(() => {
    const m = new Map<string, string[]>();
    roster?.reliefs.forEach(r => {
      const k = `${r.employeeId}|${r.date}`;
      m.set(k, [...(m.get(k) ?? []), r.processId]);
    });
    return m;
  }, [roster]);
  const pinned = useMemo(() => new Set(roster?.pinned ?? []), [roster]);
  if (!ctx || !roster || !validation) return null;
  const { days } = ctx;
  const procLabel = (pid: string) => `${ctx.brandName.get(ctx.proc.get(pid)!.brandId)} › ${ctx.proc.get(pid)!.name}`;
  const hol = (d: ISODate) => ctx.cfg.holidays.find(h => h.date === d)?.name;
  const colCls = (d: ISODate) => ([0, 6].includes(weekday(d)) ? ' we' : '');

  return (
    <div className="gridwrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="name">{summary ? 'Employee' : 'Coverage and employees'}</th>
            {days.map(d => (
              <th key={d} className={`day${colCls(d)}${hol(d) ? ' hol' : ''}`} title={hol(d) ?? d}>
                {Number(d.slice(8))}<small>{WEEKDAYS[weekday(d)][0]}</small>
              </th>
            ))}
            <th className="sum">Work</th><th className="sum">Off</th>
          </tr>
        </thead>
        <tbody>
          {summary && (
            <tr>
              <td className="name covlabel" title="Number of processes below their minimum staffing">Processes short</td>
              {days.map(d => {
                const n = ctx.cfg.processes.filter(p => { const c = validation.coverage[p.id]?.[d]; return c && c.required > 0 && !c.ok; }).length;
                return <td key={d} className={`cell cov ${n ? 'bad' : 'off'}${colCls(d)}`}>{n || '·'}</td>;
              })}
              <td colSpan={2} />
            </tr>
          )}
          {processIds.map(pid => (
            <tr key={pid}>
              <td className="name covlabel" title={procLabel(pid)}>{procLabel(pid)}</td>
              {days.map(d => {
                const c = validation.coverage[pid]?.[d];
                if (!c || c.required === 0) return <td key={d} className={`cell cov off${colCls(d)}`} title="Process closed">–</td>;
                const sel = selected?.processId === pid && selected.date === d;
                return (
                  <td key={d} className={`cell cov ${c.ok ? 'ok' : 'bad'}${sel ? ' sel' : ''}${colCls(d)}`}
                    title={`${procLabel(pid)} on ${d}: ${c.actual} of ${c.required} required`}>
                    {c.ok
                      ? <span>{c.actual}/{c.required}</span>
                      : <button className="cellbtn" onClick={() => select({ processId: pid, date: d })}
                          aria-label={`Coverage gap ${procLabel(pid)} ${d}. Show fixes`}>{c.actual}/{c.required}</button>}
                  </td>
                );
              })}
              <td colSpan={2} />
            </tr>
          ))}
          {groups.map((g, gi) => (
            <Fragment key={gi}>
              {g.label && <tr className="group"><td colSpan={days.length + 3}>{g.label}</td></tr>}
              {g.ids.map(id => {
                const e = ctx.emp.get(id);
                if (!e) return null;
                const row = roster.cells[id] ?? {};
                const vals = days.map(d => row[d]);
                return (
                  <tr key={id}>
                    <td className="name" title={e.name}>
                      {e.name}<span className="sub">{subtitle?.(id) ?? ctx.cfg.pods.find(p => p.id === e.podId)?.name ?? ''}</span>
                    </td>
                    {days.map((d, i) => {
                      const s = vals[i];
                      const editable = s === 'W' || s === 'WO';
                      const rl = reliefs.get(`${id}|${d}`);
                      return (
                        <td key={d} className={`cell s-${s ?? 'none'}${editable ? '' : ' locked'}${colCls(d)}`}>
                          <button className="cellbtn" onClick={() => toggleCell(id, d)}
                            title={`${e.name} · ${d}: ${s ? STATUS_LABEL[s] : 'Not planned. Regenerate the roster.'}${rl ? ` · relief for ${rl.map(procLabel).join(', ')}` : ''}${editable ? ' (click to toggle)' : ''}`}>
                            {s ? STATUS_SHORT[s] : ''}
                            {rl && <span className="rl">R</span>}
                            {pinned.has(`${id}|${d}`) && <span className="pin" />}
                          </button>
                        </td>
                      );
                    })}
                    <td className="sum">{vals.filter(v => v === 'W').length}</td>
                    <td className="sum">{vals.filter(v => v && v !== 'W').length}</td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
