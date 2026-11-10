import { describe, it, expect } from 'vitest';
import { seedConfig } from '../data/seed';
import { buildCtx, generate, validate, applyAbsence, suggestFor, type Roster } from './index';

const month = '2026-12';
const cfg = seedConfig();
const ctx = buildCtx(cfg, month);
const roster = generate(ctx);
const v = validate(ctx, roster);

describe('seed data', () => {
  it('has 30+ employees and ~80% single-resource brands', () => {
    expect(cfg.employees.length).toBeGreaterThanOrEqual(30);
    const perBrand = new Map<string, Set<string>>();
    for (const a of cfg.assignments.filter(a => a.role === 'primary')) {
      const b = cfg.processes.find(p => p.id === a.processId)!.brandId;
      (perBrand.get(b) ?? perBrand.set(b, new Set()).get(b)!).add(a.employeeId);
    }
    const singles = [...perBrand.values()].filter(s => s.size === 1).length;
    expect(singles / perBrand.size).toBeCloseTo(0.8, 1);
  });
});

describe('generated roster', () => {
  it('has no weekly-off, consecutive-day or leave-conflict violations', () => {
    expect(v.issues.filter(i => ['WEEKLY_OFF_SHORT', 'CONSECUTIVE_DAYS', 'LEAVE_CONFLICT', 'RELIEF_INVALID'].includes(i.code))).toEqual([]);
  });
  it('is deterministic', () => {
    expect(generate(ctx)).toEqual(roster);
  });
  it('reports coverage, and gaps (if any) are explained', () => {
    console.log('baseline stats', v.stats, 'gaps:', v.issues.filter(i => i.code === 'NO_COVERAGE' || i.code === 'UNDERSTAFFED').length);
    expect(v.stats.coveragePct).toBeGreaterThan(90);
    for (const g of v.issues.filter(i => i.code === 'NO_COVERAGE')) expect(g.message).toContain('Assigned:');
  });
});

describe('change handling', () => {
  it('flags a gap for a sole-resource brand and repairs/suggests', () => {
    const day = Object.entries(roster.cells.e22).find(([d, s]) => s === 'W' && d > '2026-12-16')![0];
    const r = applyAbsence(cfg, month, roster, { id: 'x', employeeId: 'e22', date: day, type: 'L' });
    const gap = r.impact.issues.find(i => i.processId === 'bloom-ACC' && i.date === day);
    expect(gap).toBeTruthy();
    const sg = suggestFor(r.ctx2, r.naive, gap!, new Set());
    expect(sg.length).toBeGreaterThan(0);
    console.log('sole-resource leave on', day, '-> before repair', r.impact.stats, 'after', r.validation.stats, 'moved', r.changes.length);
  });
  it('keeps pinned cells when regenerating', () => {
    const pinnedKey = 'e04|2026-12-03';
    const roster2: Roster = { ...roster, cells: { ...roster.cells, e04: { ...roster.cells.e04, '2026-12-03': 'WO' } }, pinned: [pinnedKey] };
    const re = generate(ctx, { locks: { [pinnedKey]: 'WO' }, pinned: [pinnedKey] });
    expect(re.cells.e04['2026-12-03']).toBe('WO');
    expect(roster2.pinned).toContain(pinnedKey);
  });
});
