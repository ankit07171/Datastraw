import { useStore } from '../store';
import { RosterGrid } from './RosterGrid';

// Every process on one screen: red cells are days a process is below its minimum.
export function CoverageHeatmap() {
  const { ctx, roster } = useStore();
  if (!ctx || !roster) return <div className="panel empty"><h3>No roster yet</h3><p>Generate a roster to see coverage.</p></div>;
  return (
    <>
      <p className="muted">Each cell shows people working / people required. “–” means the process is closed that day.</p>
      <RosterGrid groups={[]} processIds={ctx.cfg.processes.map(p => p.id)} />
    </>
  );
}
