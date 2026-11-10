import type { ISODate, Relief, Roster, Status } from './types';
import { type Ctx, brandsWorking, fixedStatus, required, requiredWeeklyOffs } from './rules';
import { weekday } from './dates';
import { validate } from './validate';
import { applyPatches, suggestFor } from './suggest';

const isOff = (s: Status | null) => s !== null && s !== 'W'; // null = undecided, assumed working

export function generate(ctx: Ctx, opts: { locks?: Record<string, Status>; pinned?: string[] } = {}): Roster {
  const { cfg, days, weeks } = ctx;
  const locks = opts.locks ?? {};
  const state = new Map(cfg.employees.map(e => [e.id, days.map(d => fixedStatus(ctx, e.id, d, locks))]));

  // Load-balancing counters so offs spread across days and weekends rotate fairly.
  const podOffs = new Map<string, number[]>();
  const pod = (id: string) => (podOffs.get(id) ?? podOffs.set(id, days.map(() => 0)).get(id)!);
  const weekendOffs = new Map<string, number>();
  for (const e of cfg.employees) {
    weekendOffs.set(e.id, 0);
    state.get(e.id)!.forEach((s, i) => {
      if (s !== 'WO') return;
      pod(e.podId)[i]++;
      if ([0, 6].includes(weekday(days[i]))) weekendOffs.set(e.id, weekendOffs.get(e.id)! + 1);
    });
  }

  // Most-constrained-first ordering: employees with the least slack choose their off day first.
  const maxReq = (pid: string) => Math.max(0, ...days.map(d => required(ctx, pid, d)));
  const slack = (id: string) => {
    const ps = ctx.primaryProcsOf.get(id)!;
    return ps.length ? Math.min(...ps.map(p => ctx.primariesOf.get(p)!.length - maxReq(p))) : 99;
  };
  const order = [...cfg.employees].sort((a, b) => slack(a.id) - slack(b.id) || a.id.localeCompare(b.id));

  const lastOff = (s: (Status | null)[], i: number) => { for (let k = i - 1; k >= 0; k--) if (isOff(s[k])) return k; return -1; };
  const nextOff = (s: (Status | null)[], i: number) => { for (let k = i + 1; k < s.length; k++) if (isOff(s[k])) return k; return -1; };

  for (const week of weeks) {
    for (const e of order) {
      const mine = state.get(e.id)!;
      const have = week.filter(i => mine[i] === 'WO' || mine[i] === 'CL' ||
        (cfg.settings.leaveCountsAsWeeklyOff && (mine[i] === 'L' || mine[i] === 'CO'))).length;
      for (let k = requiredWeeklyOffs(e, week) - have; k > 0; k--) {
        const cands = week.filter(i => mine[i] === null);
        if (!cands.length) break;
        let best = cands[0], bestCost = Infinity;
        for (const i of cands) {
          const d = days[i], wd = weekday(d);
          let c = 0;
          // (a) Coverage: shortfall this off would create. Cheaper if a backup exists.
          for (const pid of ctx.primaryProcsOf.get(e.id)!) {
            const req = required(ctx, pid, d); if (!req) continue;
            const others = ctx.primariesOf.get(pid)!.filter(o => o !== e.id && !isOff(state.get(o)![i])).length;
            c += Math.max(0, req - others) * (ctx.backupsOf.get(pid)!.length ? 150 : 1000);
          }
          // (b) Backups should avoid being off when the people they back up are off.
          for (const pid of ctx.backupProcsOf.get(e.id)!) {
            const req = required(ctx, pid, d); if (!req) continue;
            const up = ctx.primariesOf.get(pid)!.filter(o => !isOff(state.get(o)![i])).length;
            c += Math.max(0, req - up) * 200;
          }
          // (c) Max consecutive working days (hard-ish).
          const prev = lastOff(mine, i), next = nextOff(mine, i);
          if (i - prev - 1 > e.maxConsecutiveWorkDays) c += 5000;
          if (next !== -1 && next - i - 1 > e.maxConsecutiveWorkDays) c += 5000;
          // (d) Soft terms: preference, spreading, weekend fairness, ~7-day spacing.
          if (e.preferredOffDays.length && !e.preferredOffDays.includes(wd)) c += 20;
          c += pod(e.podId)[i] * 4;
          if (wd === 0 || wd === 6) c += weekendOffs.get(e.id)! * 6;
          c += Math.abs(i - (prev + 7)) * 3;
          if (c < bestCost) { bestCost = c; best = i; } // strict < keeps the earliest day on ties (deterministic)
        }
        mine[best] = 'WO';
        pod(e.podId)[best]++;
        if ([0, 6].includes(weekday(days[best]))) weekendOffs.set(e.id, weekendOffs.get(e.id)! + 1);
      }
    }
  }

  const cells: Roster['cells'] = {};
  for (const e of cfg.employees) {
    cells[e.id] = {};
    days.forEach((d, i) => { cells[e.id][d] = state.get(e.id)![i] ?? 'W'; });
  }
  let roster: Roster = { month: ctx.month, cells, reliefs: [], pinned: opts.pinned ?? [] };

  // Book relief first, then try to improve only the gaps that relief could not cover.
  // (Sole-owner gaps are normally closed by relief, so optimising them first is wasted work.)
  // Each accepted shift changes who is off, so relief is recalculated every round.
  const lockedKeys = new Set(Object.keys(locks));
  roster = { ...roster, reliefs: assignReliefs(ctx, roster.cells) };
  for (let it = 0; it < 15; it++) {
    const gaps = validate(ctx, roster).issues.filter(i => i.code === 'NO_COVERAGE' || i.code === 'UNDERSTAFFED');
    let moved = false;
    for (const g of gaps) {
      const best = suggestFor(ctx, roster, g, lockedKeys, ['SHIFT_WO'])[0];
      if (best && best.net > 0) {
        const shifted = applyPatches(roster, best.patches);
        roster = { ...shifted, reliefs: assignReliefs(ctx, shifted.cells) };
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return roster;
}

// Fill remaining shortfalls from designated backups first, then any floater, lightest load first.
function assignReliefs(ctx: Ctx, cells: Roster['cells']): Relief[] {
  const reliefs: Relief[] = [];
  const load = new Map<string, number>();
  const dayBrands = new Map<string, Set<string>>();
  const brandsOf = (e: string, d: ISODate) => {
    const k = `${e}|${d}`;
    if (!dayBrands.has(k)) dayBrands.set(k, brandsWorking(ctx, e, d));
    return dayBrands.get(k)!;
  };
  const floaters = ctx.cfg.employees.filter(e => ctx.backupProcsOf.get(e.id)!.length).map(e => e.id);
  for (const p of ctx.cfg.processes) {
    const prim = ctx.primariesOf.get(p.id)!;
    const designated = ctx.backupsOf.get(p.id)!;
    for (const d of ctx.days) {
      let need = required(ctx, p.id, d) - prim.filter(e => cells[e][d] === 'W').length;
      const used = new Set<string>();
      while (need > 0) {
        const pick = [...new Set([...designated, ...floaters])]
          .filter(e => !prim.includes(e) && !used.has(e) && cells[e][d] === 'W' &&
            (brandsOf(e, d).has(p.brandId) || brandsOf(e, d).size < ctx.cfg.settings.maxBrandsPerDay))
          .sort((a, b) => Number(!designated.includes(a)) - Number(!designated.includes(b)) ||
            (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b))[0];
        if (!pick) break; // unresolved: the validator will flag it for the manager
        reliefs.push({ date: d, employeeId: pick, processId: p.id });
        brandsOf(pick, d).add(p.brandId);
        load.set(pick, (load.get(pick) ?? 0) + 1);
        used.add(pick); need--;
      }
    }
  }
  return reliefs;
}
