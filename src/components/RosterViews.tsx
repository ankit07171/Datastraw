import { useMemo } from 'react';
import { useStore, type View } from '../store';
import { RosterGrid, type Group } from './RosterGrid';
import { EmployeeCalendar } from './EmployeeCalendar';
import { Legend } from './shared';

const VIEWS: { id: View; label: string }[] = [
  { id: 'company', label: 'Company' }, { id: 'pod', label: 'Pod' }, { id: 'brand', label: 'Brand' },
  { id: 'process', label: 'Process' }, { id: 'employee', label: 'Employee' },
];

// Every view is the same roster data seen through a different filter.
export function RosterViews() {
  const { ctx, roster, view, filterId, setView, generate, busy } = useStore();
  const cfg = ctx?.cfg;

  const options = useMemo(() => {
    if (!cfg || !ctx) return [] as { id: string; label: string }[];
    if (view === 'pod') return cfg.pods.map(p => ({ id: p.id, label: p.name }));
    if (view === 'brand') return cfg.brands.map(b => ({ id: b.id, label: b.name }));
    if (view === 'process') return cfg.processes.map(p => ({ id: p.id, label: `${ctx.brandName.get(p.brandId)} › ${p.name}` }));
    if (view === 'employee') return cfg.employees.map(e => ({ id: e.id, label: e.name }));
    return [];
  }, [cfg, ctx, view]);

  const id = view === 'company' ? '' : options.some(o => o.id === filterId) ? filterId : options[0]?.id ?? '';

  const content = useMemo(() => {
    if (!ctx || !cfg) return null;
    const empsOfProcess = (pid: string) => [...(ctx.primariesOf.get(pid) ?? []), ...(ctx.backupsOf.get(pid) ?? [])];
    if (view === 'company') {
      const groups: Group[] = cfg.pods.map(p => ({
        label: `${p.name} · lead ${ctx.emp.get(p.leadId)?.name ?? 'unassigned'}`,
        ids: cfg.employees.filter(e => e.podId === p.id).map(e => e.id),
      }));
      const orphans = cfg.employees.filter(e => !cfg.pods.some(p => p.id === e.podId)).map(e => e.id);
      if (orphans.length) groups.push({ label: 'No pod', ids: orphans });
      return { groups, processIds: [] as string[], summary: true };
    }
    if (view === 'pod') {
      const ids = cfg.employees.filter(e => e.podId === id).map(e => e.id);
      const processIds = [...new Set(ids.flatMap(e => ctx.primaryProcsOf.get(e) ?? []))];
      return { groups: [{ ids }], processIds };
    }
    if (view === 'brand') {
      const processIds = cfg.processes.filter(p => p.brandId === id).map(p => p.id);
      const ids = [...new Set(processIds.flatMap(empsOfProcess))];
      return { groups: [{ ids }], processIds };
    }
    if (view === 'process') return { groups: [{ ids: [...new Set(empsOfProcess(id))] }], processIds: id ? [id] : [] };
    return null;
  }, [ctx, cfg, view, id]);

  if (!ctx || !cfg) return null;

  const subtitle = (empId: string) => {
    const mine = ctx.primaryProcsOf.get(empId) ?? [], backs = ctx.backupProcsOf.get(empId) ?? [];
    const scope = view === 'process' ? [id] : view === 'brand' ? cfg.processes.filter(p => p.brandId === id).map(p => p.id) : null;
    if (!scope) return ctx.cfg.pods.find(p => p.id === ctx.emp.get(empId)?.podId)?.name ?? '';
    const own = mine.filter(p => scope.includes(p)).map(p => ctx.proc.get(p)!.name);
    return own.length ? `Owns ${own.join(', ')}` : `Backup for ${backs.filter(p => scope.includes(p)).map(p => ctx.proc.get(p)!.name).join(', ')}`;
  };

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map(v => <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>)}
        </div>
        {view !== 'company' && (
          <select value={id} onChange={e => setView(view, e.target.value)} aria-label={`Choose ${view}`}>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        <span className="muted small">Click a working or off cell to swap it. Click a red coverage cell to see fixes.</span>
      </div>
      <Legend />
      <div style={{ height: 10 }} />
      {!roster ? (
        <div className="panel empty">
          <h3>No roster for {ctx.month} yet</h3>
          <p>Generate one from the current employees, calendars and absences. You can edit it afterwards.</p>
          <button className="btn primary" disabled={busy} onClick={generate}>Generate roster</button>
        </div>
      ) : view === 'employee' ? (
        id ? <EmployeeCalendar employeeId={id} /> : <div className="panel empty">No employees yet. Add some under Data.</div>
      ) : content ? (
        <RosterGrid groups={content.groups} processIds={content.processIds} summary={content.summary} subtitle={subtitle} />
      ) : null}
    </>
  );
}
