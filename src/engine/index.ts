import type { Absence, Config, ISODate, Roster, Status } from './types';
import { type Ctx, buildCtx } from './rules';
import { generate } from './generate';
import { validate } from './validate';
import { applyPatches } from './suggest';

export * from './types';
export * from './rules';
export * from './dates';
export * from './validate';
export * from './suggest';
export * from './generate';

// Turn a roster's W/WO cells into locks. Absences, closures and reliefs are always recomputed.
const lockAll = (r: Roster, skip: (e: string, d: ISODate) => boolean) => {
  const locks: Record<string, Status> = {};
  for (const [e, row] of Object.entries(r.cells))
    for (const [d, s] of Object.entries(row))
      if ((s === 'W' || s === 'WO') && !skip(e, d)) locks[`${e}|${d}`] = s;
  return locks;
};

export const generateRoster = (cfg: Config, month: string, pinned: Roster['pinned'] = [], prev?: Roster) => {
  const ctx = buildCtx(cfg, month);
  const locks: Record<string, Status> = {};
  for (const k of pinned) { const [e, d] = k.split('|'); const s = prev?.cells[e]?.[d]; if (s === 'W' || s === 'WO') locks[k] = s; }
  return generate(ctx, { locks, pinned });
};

// Re-plan ONLY the affected employees' week. Everyone else stays exactly as published.
export function repair(ctx: Ctx, base: Roster, affected: string[], fromDate: ISODate): Roster {
  const idx = ctx.days.findIndex(d => d >= fromDate);
  const week = ctx.weeks.find(w => w.includes(idx)) ?? [];
  const pinned = new Set(base.pinned);
  const locks = lockAll(base, (e, d) =>
    affected.includes(e) && week.includes(ctx.dayIndex.get(d)!) && !pinned.has(`${e}|${d}`));
  return generate(ctx, { locks, pinned: base.pinned });
}

export function diffRosters(a: Roster, b: Roster) {
  const out: { employeeId: string; date: ISODate; from: Status; to: Status }[] = [];
  for (const [e, row] of Object.entries(b.cells))
    for (const [d, to] of Object.entries(row)) {
      const from = a.cells[e]?.[d];
      if (from && from !== to) out.push({ employeeId: e, date: d, from, to });
    }
  return out;
}

// The "handle a change" demo: 1) show the damage, 2) show the repaired roster and what moved.
export function applyAbsence(cfg: Config, month: string, before: Roster, absence: Absence) {
  const cfg2: Config = { ...cfg, absences: [...cfg.absences, absence] };
  const ctx2 = buildCtx(cfg2, month);
  const naive = applyPatches(before, [{ op: 'SET', employeeId: absence.employeeId, date: absence.date, status: absence.type }]);
  const repaired = repair(ctx2, before, [absence.employeeId], absence.date);
  return {
    cfg2, ctx2,
    naive, impact: validate(ctx2, naive),               // gaps the change caused
    repaired, validation: validate(ctx2, repaired),     // after automatic repair
    changes: diffRosters(before, repaired),
  };
}
