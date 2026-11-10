import { useEffect } from 'react';
import { useStore, type Tab } from './store';
import { Header } from './components/Header';
import { RosterViews } from './components/RosterViews';
import { CoverageHeatmap } from './components/CoverageHeatmap';
import { IssuesPanel } from './components/IssuesPanel';
import { AbsenceSimulator } from './components/AbsenceSimulator';
import { DataManager } from './components/DataManager';
import { GapDrawer } from './components/GapDrawer';

export default function App() {
  const { init, loading, error, tab, setTab, validation, toast, selected } = useStore();
  useEffect(() => { init(); }, [init]);
  const errors = validation?.stats.errors ?? 0;
  const tabs: [Tab, string][] = [['roster', 'Roster'], ['coverage', 'Coverage'], ['issues', 'Issues'], ['simulator', 'Change simulator'], ['data', 'Data']];

  return (
    <div className="shell">
      <Header />
      {error && (
        <div className="banner err">
          <span>{error}</span>
          <button className="btn sm" onClick={init}>Try again</button>
        </div>
      )}
      <nav className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}{id === 'issues' && errors > 0 && <span className="count">{errors}</span>}
          </button>
        ))}
      </nav>
      {loading ? <div className="panel empty"><h3>Loading roster…</h3></div> : (
        <main>
          {tab === 'roster' && <RosterViews />}
          {tab === 'coverage' && <CoverageHeatmap />}
          {tab === 'issues' && <IssuesPanel />}
          {tab === 'simulator' && <AbsenceSimulator />}
          {tab === 'data' && <DataManager />}
        </main>
      )}
      {selected && <GapDrawer />}
      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`} role="status">{toast.msg}</div>}
    </div>
  );
}
