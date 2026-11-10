import type { ISODate, Roster, Status } from './types';
import { type Ctx, brandsWorking } from './rules';
import { type Issue, validate } from './validate';

export type Patch =
  | { op: 'SET'; employeeId: string; date: ISODate; status: Status }
  | { op: 'ADD_RELIEF'; employeeId: string; processId: string; date: ISODate };
export type SuggestionType = 'RELIEF' | 'SHIFT_WO' | 'REVIEW_LEAVE';
export interface Suggestion {
  type: SuggestionType; title: string; detail: string; patches: Patch[];
  resolved: number; introduced: number; net: number; // simulated effect on mandatory issues
}

export function applyPatches(r: Roster, patches: Patch[]): Roster {
  const cells = { ...r.cells };
  const reliefs = [...r.reliefs];
  for (const p of patches) {
    if (p.op === 'SET') cells[p.employeeId] = { ...cells[p.employeeId], [p.date]: p.status };
    else reliefs.push({ date: p.date, employeeId: p.employeeId, processId: p.processId });
  }
  return { ...r, cells, reliefs };
}

export function suggestFor(
  ctx: Ctx, roster: Roster, issue: Pick<Issue, 'processId' | 'date'>, locked: Set<string>,
  types: SuggestionType[] = ['RELIEF', 'SHIFT_WO', 'REVIEW_LEAVE'],
): Suggestion[] {
  if (!issue.processId || !issue.date) return [];
  const date = issue.date, pid = issue.processId;
  const prim = ctx.primariesOf.get(pid) ?? [];
  const nm = (e: string) => ctx.emp.get(e)!.name;
  const mand = (r: Roster) => new Set(validate(ctx, r).issues.filter(i => i.kind === 'MANDATORY').map(i => i.id));
  const before = mand(roster);

  // Simulate the patch: run the full validator again and diff the mandatory issues.
  const simulate = (patches: Patch[]) => {
    const after = mand(applyPatches(roster, patches));
    let resolved = 0, introduced = 0;
    before.forEach(id => { if (!after.has(id)) resolved++; });
    after.forEach(id => { if (!before.has(id)) introduced++; });
    return { resolved, introduced, net: resolved - introduced };
  };
  const out: Suggestion[] = [];

  if (types.includes('RELIEF')) {
    const taken = new Set(roster.reliefs.filter(r => r.processId === pid && r.date === date).map(r => r.employeeId));
    const backups = new Set(ctx.backupsOf.get(pid) ?? []);
    const pods = new Set(prim.map(e => ctx.emp.get(e)!.podId));
    const rank = (e: string) => (backups.has(e) ? 0 : pods.has(ctx.emp.get(e)!.podId) ? 1 : 2);
    ctx.cfg.employees
      .filter(e => !prim.includes(e.id) && !taken.has(e.id) && roster.cells[e.id]?.[date] === 'W')
      .sort((a, b) => rank(a.id) - rank(b.id) || brandsWorking(ctx, a.id, date).size - brandsWorking(ctx, b.id, date).size)
      .slice(0, 6)
      .forEach(e => {
        const patches: Patch[] = [{ op: 'ADD_RELIEF', employeeId: e.id, processId: pid, date }];
        const s = simulate(patches);
        out.push({ type: 'RELIEF', patches, ...s,
          title: `Book ${e.name} as relief on ${date}`,
          detail: `${backups.has(e.id) ? 'Designated backup' : pods.has(e.podId) ? 'Same pod' : 'Other pod'}; already covers ${brandsWorking(ctx, e.id, date).size} brand(s) that day.` +
            (s.introduced ? ` Creates ${s.introduced} new issue(s).` : '') });
      });
  }

  if (types.includes('SHIFT_WO')) {
    const week = ctx.weeks.find(w => w.includes(ctx.dayIndex.get(date)!))!;
    for (const e of prim) {
      if (roster.cells[e]?.[date] !== 'WO' || locked.has(`${e}|${date}`)) continue;
      for (const i of week) {
        const d2 = ctx.days[i];
        if (d2 === date || roster.cells[e][d2] !== 'W' || locked.has(`${e}|${d2}`)) continue;
        const patches: Patch[] = [
          { op: 'SET', employeeId: e, date, status: 'W' },
          { op: 'SET', employeeId: e, date: d2, status: 'WO' },
        ];
        const s = simulate(patches);
        if (s.resolved > 0)
          out.push({ type: 'SHIFT_WO', patches, ...s,
            title: `Move ${nm(e)}'s weekly off from ${date} to ${d2}`,
            detail: s.introduced ? `Fixes this gap but creates ${s.introduced} new issue(s).` : 'Fixes this gap with no new issues.' });
      }
    }
  }

  if (types.includes('REVIEW_LEAVE'))
    for (const e of prim) {
      const s = roster.cells[e]?.[date];
      if (s === 'L' || s === 'CO')
        out.push({ type: 'REVIEW_LEAVE', patches: [], resolved: 0, introduced: 0, net: 0,
          title: `Review ${nm(e)}'s ${s === 'L' ? 'leave' : 'comp-off'} on ${date}`,
          detail: 'This absence causes the gap. Consider re-dating it if no relief is available.' });
    }

  const order = { SHIFT_WO: 0, RELIEF: 1, REVIEW_LEAVE: 2 };
  return out.sort((a, b) => b.net - a.net || order[a.type] - order[b.type]).slice(0, 8);
}
