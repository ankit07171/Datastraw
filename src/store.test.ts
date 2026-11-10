import { describe, it, expect, beforeAll, vi } from 'vitest';
import { seedConfig } from './data/seed';
import { buildCtx, generateRoster, applyPatches, validate, type Config, type Roster } from './engine';

// A fake API that behaves like the Express server (same routes and payload shapes),
// so we can test the store's wiring without a database.
const month = '2026-12';
let cfg: Config = seedConfig();
let doc: Roster & { status: string; version: number };
const calls: string[] = [];

beforeAll(() => {
  doc = { ...generateRoster(cfg, month), status: 'draft', version: 1 };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^\/api/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push(`${method} ${path}`);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (path === '/config') return json(cfg);
    if (path === '/rosters') return json([{ month, status: doc.status, version: doc.version }]);
    if (path === `/rosters/${month}` && method === 'GET') return json({ roster: doc });
    if (path === `/rosters/${month}` && method === 'PATCH') {
      let r: Roster = doc;
      const pinned = new Set(doc.pinned);
      for (const e of body.edits) { pinned.add(`${e.employeeId}|${e.date}`); r = applyPatches(r, [{ op: 'SET', ...e }]); }
      doc = { ...r, pinned: [...pinned], status: 'draft', version: doc.version + 1 };
      return json({ roster: doc });
    }
    if (path === `/rosters/${month}/publish`) {
      const v = validate(buildCtx(cfg, month), doc);
      const blocking = v.issues.filter(i => i.kind === 'MANDATORY' && i.severity === 'error');
      if (blocking.length && !body.override) return json({ error: 'blocked', details: { blockingCount: blocking.length, issues: blocking } }, 422);
      doc = { ...doc, status: 'published' };
      return json({ roster: doc });
    }
    return json({ error: 'not found' }, 404);
  });
});

describe('store <-> API wiring', () => {
  it('loads config + roster and derives validation on the client', async () => {
    const { useStore } = await import('./store');
    await useStore.getState().init();
    const s = useStore.getState();
    expect(s.config?.employees.length).toBeGreaterThanOrEqual(30);
    expect(s.roster).toBeTruthy();
    expect(s.validation?.stats.coveragePct).toBe(100);
    expect(calls).toContain('GET /config');
  });

  it('a manual cell toggle is validated instantly, persisted and pinned', async () => {
    const { useStore } = await import('./store');
    // e04 solely owns Lumina Skincare (365-day). Turning a working day into an off creates a gap.
    const day = Object.entries(useStore.getState().roster!.cells.e04).find(([, st]) => st === 'W')![0];
    await useStore.getState().toggleCell('e04', day);
    const s = useStore.getState();
    expect(s.roster!.cells.e04[day]).toBe('WO');
    expect(s.roster!.pinned).toContain(`e04|${day}`);
    expect(calls.some(c => c.startsWith('PATCH'))).toBe(true);
  });

  it('refuses to hand-edit leave or holiday cells', async () => {
    const { useStore } = await import('./store');
    const before = calls.length;
    await useStore.getState().toggleCell('e06', '2026-12-14'); // approved leave in seed data
    expect(calls.length).toBe(before);                         // no request sent
    expect(useStore.getState().toast?.kind).toBe('err');
  });

  it('publish returns the blocking issues when the roster is invalid', async () => {
    const { useStore } = await import('./store');
    const res = await useStore.getState().publish(false, '');
    if (useStore.getState().validation!.stats.errors > 0) expect(res.blocked?.count).toBeGreaterThan(0);
    const ok = await useStore.getState().publish(true, 'client agreed');
    expect(ok.ok).toBe(true);
    expect(useStore.getState().meta?.status).toBe('published');
  });
});
