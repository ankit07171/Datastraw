import { useState } from 'react';
import { useStore } from '../store';
import type { Config } from '../engine';

type Row = Record<string, any>;
type Col = { key: string; label: string; type: 'text' | 'number' | 'select' | 'list' | 'map' | 'date'; options?: { value: string; label: string }[]; hint?: string };
interface Entity { path: keyof Config; label: string; cols: Col[]; prefix: string; fixed?: boolean; blurb: string }

const parseList = (s: string, num: boolean) => s.split(',').map(x => x.trim()).filter(Boolean).map(x => (num ? Number(x) : x));
const parseMap = (s: string) => Object.fromEntries(s.split(',').map(x => x.trim()).filter(Boolean).map(p => { const [k, v] = p.split(':'); return [k.trim(), Number(v)]; }));
const showMap = (m: Record<string, number> | undefined) => Object.entries(m ?? {}).map(([k, v]) => `${k}:${v}`).join(',');
const rid = (p: string) => `${p}${Math.random().toString(36).slice(2, 7)}`;

export function DataManager() {
  const { config, ctx, upsert, remove, saveSettings, stale } = useStore();
  const [which, setWhich] = useState<Entity['path'] | 'settings'>('employees');
  if (!config || !ctx) return null;

  const opts = (items: { id: string; name: string }[]) => items.map(i => ({ value: i.id, label: i.name }));
  const procOpts = config.processes.map(p => ({ value: p.id, label: `${ctx.brandName.get(p.brandId) ?? '?'} › ${p.name}` }));
  const entities: Entity[] = [
    { path: 'employees', label: 'Employees', prefix: 'e', blurb: 'Preferred off days are weekday numbers (0 = Sunday … 6 = Saturday). Preferences never override coverage.', cols: [
      { key: 'name', label: 'Name', type: 'text' }, { key: 'podId', label: 'Pod', type: 'select', options: opts(config.pods) },
      { key: 'weeklyOffs', label: 'Weekly offs', type: 'number' }, { key: 'maxConsecutiveWorkDays', label: 'Max days in a row', type: 'number' },
      { key: 'preferredOffDays', label: 'Preferred off days', type: 'list', hint: '0,6' }] },
    { path: 'pods', label: 'Pods', prefix: 'pod', blurb: 'Each pod has a lead who oversees the pod’s employees.', cols: [
      { key: 'name', label: 'Name', type: 'text' }, { key: 'leadId', label: 'Pod lead', type: 'select', options: opts(config.employees) }] },
    { path: 'brands', label: 'Brands', prefix: 'b', blurb: 'Add a brand here, then add its processes.', cols: [{ key: 'name', label: 'Name', type: 'text' }] },
    { path: 'processes', label: 'Processes & rules', prefix: 'p', blurb: 'Calendar sets which days the process operates. Minimums by weekday look like 5:2,6:2 (2 people on Fri and Sat). By date: 2026-12-12:3.', cols: [
      { key: 'brandId', label: 'Brand', type: 'select', options: opts(config.brands) }, { key: 'name', label: 'Process', type: 'text' },
      { key: 'calendar', label: 'Operating calendar', type: 'select', options: [
        { value: 'ALL_365', label: '365 days' }, { value: 'EXCEPT_HOLIDAYS', label: 'Daily, holidays off' }, { value: 'EXCEPT_SUN_HOLIDAYS', label: 'Sundays + holidays off' }] },
      { key: 'minStaff', label: 'Min staff', type: 'number' }, { key: 'minStaffByWeekday', label: 'By weekday', type: 'map', hint: '5:2,6:2' },
      { key: 'minStaffByDate', label: 'By date', type: 'map', hint: '2026-12-12:3' }, { key: 'closedDates', label: 'Extra closed dates', type: 'list', hint: '2026-12-31' }] },
    { path: 'assignments', label: 'Assignments', prefix: 'as', fixed: true, blurb: 'Owners cover a process day to day. Backups are booked as relief when an owner is off.', cols: [
      { key: 'employeeId', label: 'Employee', type: 'select', options: opts(config.employees) }, { key: 'processId', label: 'Process', type: 'select', options: procOpts },
      { key: 'role', label: 'Role', type: 'select', options: [{ value: 'primary', label: 'Owner' }, { value: 'backup', label: 'Backup' }] }] },
    { path: 'holidays', label: 'Holidays', prefix: 'h', fixed: true, blurb: 'Public holidays close processes whose calendar excludes them.', cols: [
      { key: 'date', label: 'Date', type: 'date' }, { key: 'name', label: 'Name', type: 'text' }] },
    { path: 'absences', label: 'Absences', prefix: 'a', fixed: true, blurb: 'To add leave and repair the roster at the same time, use the Change simulator tab.', cols: [
      { key: 'employeeId', label: 'Employee', type: 'select', options: opts(config.employees) }, { key: 'date', label: 'Date', type: 'date' },
      { key: 'type', label: 'Type', type: 'select', options: [{ value: 'L', label: 'Leave' }, { value: 'CO', label: 'Comp-off' }] }] },
  ];
  const ent = entities.find(e => e.path === which);

  return (
    <div className="panel">
      {stale && <div className="banner">Master data changed. Regenerate the roster to apply it.</div>}
      <div className="toolbar"><div className="seg" role="group" aria-label="Data type" style={{ flexWrap: 'wrap' }}>
        {entities.map(e => <button key={e.path} aria-pressed={which === e.path} onClick={() => setWhich(e.path)}>{e.label}</button>)}
        <button aria-pressed={which === 'settings'} onClick={() => setWhich('settings')}>Global rules</button>
      </div></div>
      {which === 'settings'
        ? <SettingsForm value={config.settings} onSave={saveSettings} />
        : ent && <EntityTable key={ent.path} ent={ent} rows={config[ent.path] as Row[]} upsert={upsert} remove={remove} />}
    </div>
  );
}

function EntityTable({ ent, rows, upsert, remove }: { ent: Entity; rows: Row[]; upsert: (p: string, r: Row) => Promise<boolean>; remove: (p: string, id: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <p className="muted small">{ent.blurb}</p>
      <div className="scroll">
        <table className="data">
          <thead><tr>{ent.cols.map(c => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {adding && <EditRow ent={ent} row={{ id: rid(ent.prefix) }} isNew onSave={async r => { if (await upsert(ent.path, r)) setAdding(false); }} onCancel={() => setAdding(false)} />}
            {rows.map(r => <EditRow key={r.id} ent={ent} row={r}
              onSave={r2 => upsert(ent.path, r2).then(() => undefined)}
              onDelete={() => { if (confirm('Delete this row? Related assignments and absences are removed too.')) remove(ent.path, r.id); }} />)}
          </tbody>
        </table>
      </div>
      {!adding && <button className="btn" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>Add {ent.label.toLowerCase().replace(/s$/, '').replace('processe', 'process')}</button>}
    </>
  );
}

function EditRow({ ent, row, isNew, onSave, onDelete, onCancel }: {
  ent: Entity; row: Row; isNew?: boolean; onSave: (r: Row) => void | Promise<void>; onDelete?: () => void; onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Row>(row);
  const [dirty, setDirty] = useState(!!isNew);
  const readOnly = ent.fixed && !isNew;     // assignments, holidays, absences: add or delete, never edit in place
  const set = (k: string, v: any) => { setDraft(d => ({ ...d, [k]: v })); setDirty(true); };
  return (
    <tr>
      {ent.cols.map(c => {
        const v = draft[c.key];
        let input;
        if (readOnly) {
          const shown = c.type === 'select' ? c.options?.find(o => o.value === v)?.label ?? v : c.type === 'map' ? showMap(v) : Array.isArray(v) ? v.join(',') : v;
          input = <span>{shown}</span>;
        } else if (c.type === 'select')
          input = <select value={v ?? ''} onChange={e => set(c.key, e.target.value)}><option value="">Choose…</option>{c.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
        else if (c.type === 'number') input = <input type="number" min={0} value={v ?? ''} onChange={e => set(c.key, Number(e.target.value))} />;
        else if (c.type === 'date') input = <input type="date" value={v ?? ''} onChange={e => set(c.key, e.target.value)} />;
        else if (c.type === 'list') input = <input type="text" placeholder={c.hint} defaultValue={(v ?? []).join(',')} onBlur={e => set(c.key, parseList(e.target.value, c.key === 'preferredOffDays'))} />;
        else if (c.type === 'map') input = <input type="text" placeholder={c.hint} defaultValue={showMap(v)} onBlur={e => set(c.key, parseMap(e.target.value))} />;
        else input = <input type="text" value={v ?? ''} onChange={e => set(c.key, e.target.value)} />;
        return <td key={c.key}>{input}</td>;
      })}
      <td style={{ whiteSpace: 'nowrap' }}>
        {!readOnly && dirty && <button className="btn primary sm" onClick={async () => { await onSave(draft); setDirty(false); }}>Save</button>}{' '}
        {isNew ? <button className="btn sm" onClick={onCancel}>Cancel</button> : <button className="btn sm danger" onClick={onDelete}>Delete</button>}
      </td>
    </tr>
  );
}

function SettingsForm({ value, onSave }: { value: Config['settings']; onSave: (s: Config['settings']) => Promise<void> }) {
  const [v, setV] = useState(value);
  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
      <label className="field">Most brands one person may cover in a day
        <input type="number" min={1} value={v.maxBrandsPerDay} onChange={e => setV({ ...v, maxBrandsPerDay: Number(e.target.value) })} /></label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={v.leaveCountsAsWeeklyOff} onChange={e => setV({ ...v, leaveCountsAsWeeklyOff: e.target.checked })} />
        Approved leave counts as the weekly off for that week</label>
      <div><button className="btn primary" onClick={() => onSave(v)}>Save rules</button></div>
    </div>
  );
}
