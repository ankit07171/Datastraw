import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { CODE_LABEL } from './shared';

type Filter = 'errors' | 'warnings' | 'all';

export function IssuesPanel() {
  const { validation, select, setView, roster } = useStore();
  const [filter, setFilter] = useState<Filter>('errors');
  const list = useMemo(() => {
    const all = validation?.issues ?? [];
    return filter === 'all' ? all : all.filter(i => (filter === 'errors' ? i.severity === 'error' : i.severity === 'warning'));
  }, [validation, filter]);
  const byCode = useMemo(() => {
    const m = new Map<string, number>();
    list.forEach(i => m.set(i.code, (m.get(i.code) ?? 0) + 1));
    return [...m.entries()];
  }, [list]);
  if (!roster || !validation) return <div className="panel empty"><h3>Nothing to check yet</h3><p>Generate a roster first.</p></div>;

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter issues">
          {(['errors', 'warnings', 'all'] as Filter[]).map(f => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'errors' ? `Must fix (${validation.stats.errors})` : f === 'warnings' ? `Preferences and warnings (${validation.stats.warnings})` : 'All'}
            </button>
          ))}
        </div>
        <span className="muted small">Coverage rules always outrank preferences. Preferences are never allowed to cause a gap.</span>
      </div>
      {byCode.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {byCode.map(([c, n]) => <span key={c} className="tag">{CODE_LABEL[c]}: {n}</span>)}</div>}
      {list.length === 0 && <div className="empty"><h3>{filter === 'errors' ? 'No blocking issues' : 'Nothing here'}</h3><p>Every required process is covered and every rule is met.</p></div>}
      <div className="scroll">
        {list.slice(0, 300).map(i => {
          const isGap = i.code === 'NO_COVERAGE' || i.code === 'UNDERSTAFFED';
          return (
            <div className="issue" key={i.id}>
              <i className={`dot ${i.severity}`} />
              <div className="grow">
                <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
                  <span className={`tag ${i.kind === 'MANDATORY' ? 'm' : ''}`}>{i.kind === 'MANDATORY' ? 'Mandatory' : 'Preference'}</span>
                  <span className="tag">{CODE_LABEL[i.code]}</span>
                </div>
                {i.message}
              </div>
              {isGap && <button className="btn sm" onClick={() => select({ processId: i.processId!, date: i.date! })}>See fixes</button>}
              {!isGap && i.employeeId && <button className="btn sm" onClick={() => setView('employee', i.employeeId)}>Open employee</button>}
            </div>
          );
        })}
        {list.length > 300 && <p className="muted small">Showing the first 300 of {list.length}.</p>}
      </div>
    </div>
  );
}
