import type { Config, Employee, ISODate, Process, Status } from './types';
import { monthDays, weekday } from './dates';

// Ctx = everything precomputed once per (config, month) so hot loops are just Map lookups.
export interface Ctx {
  cfg: Config; month: string; days: ISODate[]; dayIndex: Map<ISODate, number>;
  weeks: number[][];                          // Mon-Sun blocks of day indexes
  holidays: Set<ISODate>;
  proc: Map<string, Process>; emp: Map<string, Employee>; brandName: Map<string, string>;
  primariesOf: Map<string, string[]>;         // processId -> employeeIds
  backupsOf: Map<string, string[]>;
  primaryProcsOf: Map<string, string[]>;      // employeeId -> processIds
  backupProcsOf: Map<string, string[]>;
  absence: Map<string, 'L' | 'CO'>;           // 'emp|date' -> type
}

export function buildCtx(cfg: Config, month: string): Ctx {
  const days = monthDays(month);
  const weeks: number[][] = [];
  days.forEach((d, i) => {
    if (i === 0 || weekday(d) === 1) weeks.push([]);
    weeks[weeks.length - 1].push(i);
  });
  const proc = new Map(cfg.processes.map(p => [p.id, p]));
  const emp = new Map(cfg.employees.map(e => [e.id, e]));
  const mk = (ids: string[]) => new Map<string, string[]>(ids.map(id => [id, []]));
  const primariesOf = mk(cfg.processes.map(p => p.id));
  const backupsOf = mk(cfg.processes.map(p => p.id));
  const primaryProcsOf = mk(cfg.employees.map(e => e.id));
  const backupProcsOf = mk(cfg.employees.map(e => e.id));
  for (const a of cfg.assignments) {
    if (!proc.has(a.processId) || !emp.has(a.employeeId)) continue; // tolerate stale rows after deletes
    (a.role === 'primary' ? primariesOf : backupsOf).get(a.processId)!.push(a.employeeId);
    (a.role === 'primary' ? primaryProcsOf : backupProcsOf).get(a.employeeId)!.push(a.processId);
  }
  return {
    cfg, month, days, dayIndex: new Map(days.map((d, i) => [d, i])), weeks,
    holidays: new Set(cfg.holidays.map(h => h.date)), proc, emp,
    brandName: new Map(cfg.brands.map(b => [b.id, b.name])),
    primariesOf, backupsOf, primaryProcsOf, backupProcsOf,
    absence: new Map(cfg.absences.map(a => [`${a.employeeId}|${a.date}`, a.type])),
  };
}

export function operates(ctx: Ctx, p: Process, date: ISODate): boolean {
  if (p.closedDates.includes(date)) return false;
  const hol = ctx.holidays.has(date);
  if (p.calendar === 'ALL_365') return true;
  if (p.calendar === 'EXCEPT_HOLIDAYS') return !hol;
  return !hol && weekday(date) !== 0;
}

// Headcount the process needs on a date. 0 when it is closed.
export function required(ctx: Ctx, pid: string, date: ISODate): number {
  const p = ctx.proc.get(pid)!;
  if (!operates(ctx, p, date)) return 0;
  return p.minStaffByDate[date] ?? p.minStaffByWeekday[weekday(date)] ?? p.minStaff;
}

// Offs owed in a (possibly partial) week. 4+ days of a 7-day week = 1 off, 3 or fewer = 0.
export const requiredWeeklyOffs = (e: Employee, week: number[]) =>
  Math.round((week.length * e.weeklyOffs) / 7);

export function brandsWorking(ctx: Ctx, empId: string, date: ISODate): Set<string> {
  const s = new Set<string>();
  for (const pid of ctx.primaryProcsOf.get(empId) ?? []) {
    const p = ctx.proc.get(pid)!;
    if (operates(ctx, p, date)) s.add(p.brandId);
  }
  return s;
}

// Statuses that are NOT a planning decision: absences, closures, and locked cells.
export function fixedStatus(ctx: Ctx, empId: string, date: ISODate, locks: Record<string, Status>): Status | null {
  const a = ctx.absence.get(`${empId}|${date}`);
  if (a) return a;                                    // approved absence always wins
  const ps = ctx.primaryProcsOf.get(empId) ?? [];
  if (ps.length && ps.every(pid => !operates(ctx, ctx.proc.get(pid)!, date)))
    return ctx.holidays.has(date) ? 'PH' : 'CL';      // nothing to work on -> derived, not planned
  const l = locks[`${empId}|${date}`];
  return l === 'W' || l === 'WO' ? l : null;
}
