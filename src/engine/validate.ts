import type { ISODate, Roster, Status } from './types';
import { type Ctx, brandsWorking, required, requiredWeeklyOffs } from './rules';
import { WEEKDAYS, weekday } from './dates';

export type IssueCode =
  | 'NO_ASSIGNEE' | 'NO_COVERAGE' | 'UNDERSTAFFED' | 'LEAVE_CONFLICT'
  | 'CONSECUTIVE_DAYS' | 'WEEKLY_OFF_SHORT' | 'OVERLOAD' | 'RELIEF_INVALID' | 'PREF_OFF_DAY';

export interface Issue {
  id: string; code: IssueCode;
  severity: 'error' | 'warning';
  kind: 'MANDATORY' | 'PREFERENCE';
  message: string;
  date?: ISODate; employeeId?: string; processId?: string; brandId?: string;
}
export interface CoverageCell { required: number; actual: number; ok: boolean }
export interface ValidationResult {
  issues: Issue[];
  coverage: Record<string, Record<ISODate, CoverageCell>>; // processId -> date -> cell
  stats: { errors: number; warnings: number; coveragePct: number };
}

const WHY: Record<Status, string> = {
  W: 'working', WO: 'weekly off', PH: 'holiday', CL: 'closed', L: 'on leave', CO: 'comp-off',
};

export function validate(ctx: Ctx, r: Roster): ValidationResult {
  const { cfg, days, weeks } = ctx;
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, 'id'>) =>
    issues.push({ ...i, id: [i.code, i.processId, i.employeeId, i.date].filter(Boolean).join(':') });
  const st = (e: string, d: ISODate): Status => r.cells[e]?.[d] ?? 'W';
  const name = (e: string) => ctx.emp.get(e)?.name ?? e;
  const label = (pid: string) => {
    const p = ctx.proc.get(pid)!;
    return `${ctx.brandName.get(p.brandId)} › ${p.name}`;
  };

  // Valid relief only counts if that person is actually working that day.
  const reliefCount = new Map<string, number>();
  const reliefBrands = new Map<string, Set<string>>();
  for (const rl of r.reliefs) {
    if (!ctx.dayIndex.has(rl.date) || !ctx.proc.has(rl.processId)) continue;
    if (st(rl.employeeId, rl.date) !== 'W') {
      add({ code: 'RELIEF_INVALID', severity: 'error', kind: 'MANDATORY', date: rl.date,
        employeeId: rl.employeeId, processId: rl.processId,
        message: `${name(rl.employeeId)} is booked as relief for ${label(rl.processId)} on ${rl.date} but is ${WHY[st(rl.employeeId, rl.date)]}.` });
      continue;
    }
    const k = `${rl.processId}|${rl.date}`;
    reliefCount.set(k, (reliefCount.get(k) ?? 0) + 1);
    const bk = `${rl.employeeId}|${rl.date}`;
    if (!reliefBrands.has(bk)) reliefBrands.set(bk, new Set());
    reliefBrands.get(bk)!.add(ctx.proc.get(rl.processId)!.brandId);
  }

  // 1. Coverage, the core check, per process per day.
  const coverage: ValidationResult['coverage'] = {};
  let reqCells = 0, okCells = 0;
  for (const p of cfg.processes) {
    coverage[p.id] = {};
    const prim = ctx.primariesOf.get(p.id) ?? [];
    let reportedNoAssignee = false;
    for (const d of days) {
      const req = required(ctx, p.id, d);
      const working = prim.filter(e => st(e, d) === 'W');
      const actual = working.length + (reliefCount.get(`${p.id}|${d}`) ?? 0);
      coverage[p.id][d] = { required: req, actual, ok: actual >= req };
      if (!req) continue;
      reqCells++;
      if (actual >= req) { okCells++; continue; }
      if (!prim.length) {
        if (!reportedNoAssignee) {
          reportedNoAssignee = true;
          add({ code: 'NO_ASSIGNEE', severity: 'error', kind: 'MANDATORY', processId: p.id, brandId: p.brandId,
            message: `${label(p.id)} has no employee assigned but needs coverage.` });
        }
        continue;
      }
      const cause = prim.map(e => `${name(e)} (${WHY[st(e, d)]})`).join(', ');
      add({ code: actual === 0 ? 'NO_COVERAGE' : 'UNDERSTAFFED', severity: 'error', kind: 'MANDATORY',
        date: d, processId: p.id, brandId: p.brandId,
        message: `${label(p.id)} needs ${req} on ${d} (${WEEKDAYS[weekday(d)]}) but has ${actual}. Assigned: ${cause}.` });
    }
  }

  for (const e of cfg.employees) {
    // 2. Approved absences must be respected.
    for (const d of days) {
      const a = ctx.absence.get(`${e.id}|${d}`);
      if (a && st(e.id, d) !== a)
        add({ code: 'LEAVE_CONFLICT', severity: 'error', kind: 'MANDATORY', date: d, employeeId: e.id,
          message: `${e.name} has approved ${a === 'L' ? 'leave' : 'comp-off'} on ${d} but is rostered ${WHY[st(e.id, d)]}.` });
    }
    // 3. Max consecutive working days (flag once per run, at the first day over the limit).
    let run = 0;
    for (const d of days) {
      run = st(e.id, d) === 'W' ? run + 1 : 0;
      if (run === e.maxConsecutiveWorkDays + 1)
        add({ code: 'CONSECUTIVE_DAYS', severity: 'error', kind: 'MANDATORY', date: d, employeeId: e.id,
          message: `${e.name} works more than ${e.maxConsecutiveWorkDays} days in a row by ${d}.` });
    }
    // 4. Weekly offs. Waived if the week has no working day left to turn into an off.
    for (const w of weeks) {
      const need = requiredWeeklyOffs(e, w);
      const sts = w.map(i => st(e.id, days[i]));
      const have = sts.filter(s => s === 'WO' || s === 'CL' || (cfg.settings.leaveCountsAsWeeklyOff && (s === 'L' || s === 'CO'))).length;
      if (have < need && sts.includes('W'))
        add({ code: 'WEEKLY_OFF_SHORT', severity: 'error', kind: 'MANDATORY', date: days[w[0]], employeeId: e.id,
          message: `${e.name} has ${have} weekly off(s) in the week of ${days[w[0]]}; ${need} required.` });
    }
    // 5. Overload across brands on one day (multi-brand employees + relief duty).
    for (const d of days) {
      if (st(e.id, d) !== 'W') continue;
      const b = new Set([...brandsWorking(ctx, e.id, d), ...(reliefBrands.get(`${e.id}|${d}`) ?? [])]);
      if (b.size > cfg.settings.maxBrandsPerDay)
        add({ code: 'OVERLOAD', severity: 'warning', kind: 'MANDATORY', date: d, employeeId: e.id,
          message: `${e.name} covers ${b.size} brands on ${d} (limit ${cfg.settings.maxBrandsPerDay}).` });
    }
    // 6. Preferences (never override coverage; reported as warnings only).
    if (e.preferredOffDays.length)
      for (const d of days)
        if (st(e.id, d) === 'WO' && !e.preferredOffDays.includes(weekday(d)))
          add({ code: 'PREF_OFF_DAY', severity: 'warning', kind: 'PREFERENCE', date: d, employeeId: e.id,
            message: `${e.name}'s weekly off on ${d} (${WEEKDAYS[weekday(d)]}) is not a preferred day.` });
  }

  return {
    issues, coverage,
    stats: {
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      coveragePct: reqCells ? Math.round((okCells / reqCells) * 1000) / 10 : 100,
    },
  };
}
