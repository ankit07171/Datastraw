import { useMemo } from 'react';
import { suggestFor, type Suggestion } from '../engine';
import { useStore } from '../store';
import { CODE_LABEL, shortDate } from './shared';

// The "what do I do about this gap?" panel: explains the gap and lists simulated fixes.
export function GapDrawer() {
  const { selected, select, ctx, roster, validation, applySuggestion } = useStore();
  const gap = selected && validation?.issues.find(i =>
    i.processId === selected.processId && i.date === selected.date && (i.code === 'NO_COVERAGE' || i.code === 'UNDERSTAFFED'));
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!ctx || !roster || !selected || !gap) return [];
    return suggestFor(ctx, roster, selected, new Set(roster.pinned));
  }, [ctx, roster, selected, gap]);
  if (!selected || !ctx) return null;
  const p = ctx.proc.get(selected.processId);

  return (
    <aside className="drawer" aria-label="Coverage gap">
      <header>
        <div className="grow">
          <h2>{p ? `${ctx.brandName.get(p.brandId)} › ${p.name}` : 'Process'}</h2>
          <div className="muted">{shortDate(selected.date)}</div>
        </div>
        <button className="btn sm" onClick={() => select(null)} aria-label="Close">Close</button>
      </header>
      <div className="body">
        {!gap ? (
          <div className="empty"><h3>This gap is resolved</h3><p>Coverage on {shortDate(selected.date)} now meets the minimum.</p></div>
        ) : (
          <>
            <p><span className="tag m">{CODE_LABEL[gap.code]}</span></p>
            <p>{gap.message}</p>
            <h3 style={{ margin: '16px 0 8px' }}>Options</h3>
            <p className="muted small">Each option was tried against the full rules. “Net” is issues fixed minus issues created.</p>
            {suggestions.length === 0 && <p>No automatic fix. Consider adding a backup for this process or moving a leave.</p>}
            {suggestions.map((s, i) => (
              <div className="sugg" key={i}>
                <div style={{ fontWeight: 600 }}>{s.title}</div>
                <div className="muted small">{s.detail}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <span className={`net ${s.net > 0 ? 'good' : s.net < 0 ? 'mid' : 'zero'}`}>
                    {s.patches.length ? `Net ${s.net > 0 ? '+' : ''}${s.net} · fixes ${s.resolved}, creates ${s.introduced}` : 'Needs a decision'}
                  </span>
                  <span className="spacer" />
                  {s.patches.length > 0 && <button className="btn primary sm" onClick={() => applySuggestion(s)}>Apply</button>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
