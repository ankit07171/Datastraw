import { create } from 'zustand';
import {
  applyPatches, buildCtx, validate,
  type Config, type Ctx, type Patch, type Roster, type Status, type Suggestion, type ValidationResult, type Issue,
} from './engine';
import { api, ApiError } from './api';

export type Tab = 'roster' | 'coverage' | 'issues' | 'simulator' | 'data';
export type View = 'company' | 'pod' | 'brand' | 'process' | 'employee';

export interface RosterMeta {
  status: 'draft' | 'published'; version: number; publishedAt?: string;
  overrideReason?: string; issueCountAtPublish?: number;
}
type RosterDoc = Roster & RosterMeta;
interface RosterListItem { month: string; status: 'draft' | 'published'; version: number }
export interface AbsenceResult {
  applied: boolean;
  gapsCausedByChange: Issue[];
  beforeRepair: ValidationResult['stats'];
  afterRepair: ValidationResult['stats'];
  remainingGaps: { issue: Issue; suggestions: Suggestion[] }[];
  changes: { employeeId: string; date: string; from: Status; to: Status }[];
}

interface State {
  config: Config | null;
  month: string;
  rosterList: RosterListItem[];
  roster: Roster | null;
  meta: RosterMeta | null;
  ctx: Ctx | null;
  validation: ValidationResult | null;
  stale: boolean;                       // master data changed since the roster was generated
  tab: Tab; view: View; filterId: string;
  selected: { processId: string; date: string } | null;   // the coverage gap shown in the fix drawer
  loading: boolean; busy: boolean;
  error: string | null;
  toast: { msg: string; kind: 'ok' | 'err' } | null;

  init: () => Promise<void>;
  loadRoster: (month: string) => Promise<void>;
  reloadConfig: () => Promise<void>;
  generate: () => Promise<void>;
  toggleCell: (employeeId: string, date: string) => Promise<void>;
  applySuggestion: (s: Suggestion) => Promise<void>;
  publish: (override?: boolean, reason?: string) => Promise<{ ok: boolean; blocked?: { count: number; issues: Issue[] } }>;
  simulateAbsence: (b: { employeeId: string; date: string; type: 'L' | 'CO'; apply: boolean }) => Promise<AbsenceResult | null>;
  upsert: (path: string, row: Record<string, any>) => Promise<boolean>;
  remove: (path: string, id: string) => Promise<void>;
  saveSettings: (s: Config['settings']) => Promise<void>;
  setTab: (t: Tab) => void;
  setView: (v: View, filterId?: string) => void;
  select: (g: State['selected']) => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const metaOf = (d: RosterDoc): RosterMeta => ({
  status: d.status, version: d.version, publishedAt: d.publishedAt,
  overrideReason: d.overrideReason, issueCountAtPublish: d.issueCountAtPublish,
});
const toRoster = (d: RosterDoc): Roster => ({ month: d.month, cells: d.cells ?? {}, reliefs: d.reliefs ?? [], pinned: d.pinned ?? [] });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ctx + validation are derived data: recompute whenever config, month or roster change.
// The same pure engine runs here (instant feedback) and on the server (publish gate).
const derive = (config: Config | null, month: string, roster: Roster | null) => {
  if (!config) return { ctx: null, validation: null };
  const ctx = buildCtx(config, month);
  return { ctx, validation: roster ? validate(ctx, roster) : null };
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  config: null, month: '2026-12', rosterList: [], roster: null, meta: null, ctx: null, validation: null,
  stale: false, tab: 'roster', view: 'company', filterId: '', selected: null,
  loading: true, busy: false, error: null, toast: null,

  notify(m, kind = 'ok') {
    clearTimeout(toastTimer);
    set({ toast: { msg: m, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 4500);
  },
  setTab: tab => set({ tab }),
  setView: (view, filterId = '') => set({ view, filterId, tab: 'roster' }),
  select: selected => set({ selected }),

  async init() {
    set({ loading: true, error: null });
    try {
      const [config, rosterList] = await Promise.all([api.get<Config>('/config'), api.get<RosterListItem[]>('/rosters')]);
      const month = rosterList.length ? rosterList[rosterList.length - 1].month : get().month;
      set({ config, rosterList });
      await get().loadRoster(month);
    } catch (e) {
      set({ error: msg(e) });
    } finally {
      set({ loading: false });
    }
  },

  async loadRoster(month) {
    const { config } = get();
    try {
      const { roster: doc } = await api.get<{ roster: RosterDoc }>(`/rosters/${month}`);
      const roster = toRoster(doc);
      set({ month, roster, meta: metaOf(doc), selected: null, stale: false, ...derive(config, month, roster) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) set({ month, roster: null, meta: null, selected: null, ...derive(config, month, null) });
      else { get().notify(msg(e), 'err'); }
    }
  },

  async reloadConfig() {
    const config = await api.get<Config>('/config');
    const { month, roster } = get();
    set({ config, ...derive(config, month, roster) });
  },

  async generate() {
    set({ busy: true });
    try {
      const { month } = get();
      const prev = get().meta;
      const { roster: doc } = await api.post<{ roster: RosterDoc }>(`/rosters/${month}/generate`, { keepPinned: true, force: prev?.status === 'published' });
      const roster = toRoster(doc);
      const rosterList = await api.get<RosterListItem[]>('/rosters');
      set({ roster, meta: metaOf(doc), rosterList, stale: false, selected: null, ...derive(get().config, month, roster) });
      get().notify('Roster generated. Pinned cells were kept.');
    } catch (e) {
      get().notify(msg(e), 'err');
    } finally {
      set({ busy: false });
    }
  },

  // Manual edit flow: apply locally first (instant validation), then persist; roll back on failure.
  async toggleCell(employeeId, date) {
    const { roster, config, month } = get();
    const cur = roster?.cells[employeeId]?.[date];
    if (!roster || !cur) return;
    if (cur !== 'W' && cur !== 'WO') {
      get().notify({ L: 'Leave', CO: 'Comp-off', PH: 'Public holiday', CL: 'Closed day' }[cur] + ' is set by the calendar or an approved absence, so it can’t be edited by hand.', 'err');
      return;
    }
    await commit(set, get, [{ op: 'SET', employeeId, date, status: cur === 'W' ? 'WO' : 'W' }], config!, month);
  },

  async applySuggestion(s) {
    const { config, month } = get();
    if (!s.patches.length) return;
    await commit(set, get, s.patches, config!, month);
    get().notify('Applied: ' + s.title);
  },

  async publish(override = false, reason = '') {
    const { month } = get();
    try {
      const out = await api.post<{ roster: RosterDoc }>(`/rosters/${month}/publish`, { override, reason });
      set({ meta: metaOf(out.roster), rosterList: await api.get<RosterListItem[]>('/rosters') });
      get().notify(`Published ${month}.`);
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.status === 422)
        return { ok: false, blocked: { count: e.details?.blockingCount ?? 0, issues: e.details?.issues ?? [] } };
      get().notify(msg(e), 'err');
      return { ok: false };
    }
  },

  async simulateAbsence(body) {
    const { month } = get();
    try {
      const out = await api.post<AbsenceResult>(`/rosters/${month}/absence`, body);
      if (body.apply) {            // the server saved the absence and the repaired roster: reload both
        await get().reloadConfig();
        await get().loadRoster(month);
        get().notify('Leave approved and roster repaired.');
      }
      return out;
    } catch (e) {
      get().notify(msg(e), 'err');
      return null;
    }
  },

  // Master-data writes (employees, brands, processes, assignments, ...). After any change the
  // existing roster no longer reflects the rules, so we mark it stale and prompt to regenerate.
  async upsert(path, row) {
    try {
      if (row.id) await api.put(`/${path}/${row.id}`, row);
      else await api.post(`/${path}`, row);
      await get().reloadConfig();
      set({ stale: true });
      return true;
    } catch (e) {
      get().notify(msg(e), 'err');
      return false;
    }
  },
  async remove(path, id) {
    try {
      await api.del(`/${path}/${id}`);
      await get().reloadConfig();
      set({ stale: true });
    } catch (e) {
      get().notify(msg(e), 'err');
    }
  },
  async saveSettings(s) {
    try {
      await api.put('/settings', s);
      await get().reloadConfig();
      set({ stale: true });
      get().notify('Rules saved.');
    } catch (e) {
      get().notify(msg(e), 'err');
    }
  },
}));

async function commit(
  set: (p: Partial<State>) => void, get: () => State, patches: Patch[], config: Config, month: string,
) {
  const before = get().roster!;
  const pinned = new Set(before.pinned);
  patches.forEach(p => p.op === 'SET' && pinned.add(`${p.employeeId}|${p.date}`));
  const optimistic = { ...applyPatches(before, patches), pinned: [...pinned] };
  set({ roster: optimistic, meta: get().meta && { ...get().meta!, status: 'draft' }, ...derive(config, month, optimistic) });
  try {
    const out = await api.patch<{ roster: RosterDoc }>(`/rosters/${month}`, {
      edits: patches.filter(p => p.op === 'SET').map(p => ({ employeeId: p.employeeId, date: (p as any).date, status: (p as any).status })),
      addReliefs: patches.filter(p => p.op === 'ADD_RELIEF').map(p => ({ employeeId: p.employeeId, processId: (p as any).processId, date: p.date })),
    });
    const saved = toRoster(out.roster);
    set({ roster: saved, meta: metaOf(out.roster), ...derive(config, month, saved) });
  } catch (e) {
    set({ roster: before, ...derive(config, month, before) });   // roll back the optimistic change
    get().notify(msg(e), 'err');
  }
}
