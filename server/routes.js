import { Router } from 'express';
import {
  Absence, Assignment, ChangeLog, Proc, Roster, Settings,
} from './models.js';
import {
  MODELS, httpError, loadConfig, logChange, randomId, saveRoster, seed, toEngineRoster,
} from './service.js';
import {
  applyAbsence, applyPatches, buildCtx, generateRoster, suggestFor, validate,
} from '../src/engine/index.ts';

export const api = Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // async errors -> handler
const strip = q => q.select('-_id').lean();
const GAP = new Set(['NO_COVERAGE', 'UNDERSTAFFED']);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

api.param('month', (req, _res, next, m) =>
  MONTH.test(m) ? next() : next(httpError(400, 'month must look like 2026-12')));

async function context(month) {
  const cfg = await loadConfig();
  return { cfg, ctx: buildCtx(cfg, month) };
}
async function mustFindRoster(month) {
  const doc = await Roster.findOne({ month }).select('-_id').lean();
  if (!doc) throw httpError(404, `No roster for ${month}. POST /api/rosters/${month}/generate first.`);
  return doc;
}

/* ───────────── Master data: generic CRUD, so new brands/processes/employees need no code ───────────── */

// Deleting a parent must not leave orphans, or a removed process would still "need coverage".
const cascade = {
  employees: id => Promise.all([Assignment.deleteMany({ employeeId: id }), Absence.deleteMany({ employeeId: id })]),
  processes: id => Assignment.deleteMany({ processId: id }),
  brands: async id => {
    const ids = (await Proc.find({ brandId: id }).lean()).map(p => p.id);
    await Promise.all([Proc.deleteMany({ brandId: id }), Assignment.deleteMany({ processId: { $in: ids } })]);
  },
};
// Natural ids where one exists, so the same holiday/assignment can't be added twice.
const idFor = {
  holidays: b => b.date,
  assignments: b => `${b.employeeId}:${b.processId}:${b.role ?? 'primary'}`,
};

for (const [path, M] of Object.entries(MODELS)) {
  api.get(`/${path}`, ah(async (_req, res) => res.json(await strip(M.find().sort({ id: 1 })))));

  const upsert = status => ah(async (req, res) => {
    const { _id, __v, ...body } = req.body ?? {};
    const id = req.params.id ?? body.id ?? idFor[path]?.(body) ?? randomId();
    const doc = await strip(M.findOneAndUpdate(
      { id }, { ...body, id }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }));
    await logChange(`${path}.upsert`, null, { id });
    res.status(status).json(doc);
  });
  api.post(`/${path}`, upsert(201));
  api.put(`/${path}/:id`, upsert(200));

  api.delete(`/${path}/:id`, ah(async (req, res) => {
    const { deletedCount } = await M.deleteOne({ id: req.params.id });
    if (!deletedCount) throw httpError(404, `${path}/${req.params.id} not found`);
    await cascade[path]?.(req.params.id);
    await logChange(`${path}.delete`, null, { id: req.params.id });
    res.status(204).end();
  }));
}

api.get('/config', ah(async (_req, res) => res.json(await loadConfig())));

api.put('/settings', ah(async (req, res) => {
  const { maxBrandsPerDay, leaveCountsAsWeeklyOff } = req.body ?? {};
  const doc = await strip(Settings.findOneAndUpdate(
    { key: 'main' }, { key: 'main', ...(maxBrandsPerDay != null && { maxBrandsPerDay }),
      ...(leaveCountsAsWeeklyOff != null && { leaveCountsAsWeeklyOff }) },
    { upsert: true, new: true, runValidators: true }));
  res.json(doc);
}));

api.post('/seed', ah(async (req, res) => {
  const loaded = await seed({ force: req.query.force === 'true' });
  res.json({ loaded, note: loaded ? 'Sample data loaded' : 'Database not empty; use ?force=true to reset' });
}));

/* ───────────── Rosters ───────────── */

api.get('/rosters', ah(async (_req, res) =>
  res.json(await strip(Roster.find().select('month status version publishedAt').sort({ month: 1 })))));

api.get('/rosters/:month', ah(async (req, res) => {
  const { month } = req.params;
  const roster = await mustFindRoster(month);
  const { ctx } = await context(month);
  res.json({ roster, validation: validate(ctx, toEngineRoster(roster, month)) });
}));

api.get('/rosters/:month/validation', ah(async (req, res) => {
  const { month } = req.params;
  const roster = await mustFindRoster(month);
  const { ctx } = await context(month);
  res.json(validate(ctx, toEngineRoster(roster, month)));
}));

// Generate (or regenerate) a month. Manually pinned cells are kept unless keepPinned:false.
api.post('/rosters/:month/generate', ah(async (req, res) => {
  const { month } = req.params;
  const { keepPinned = true, force = false } = req.body ?? {};
  const prev = await Roster.findOne({ month }).select('-_id').lean();
  if (prev?.status === 'published' && !force)
    throw httpError(409, 'This roster is published. Send {"force": true} to regenerate it as a new draft.');
  const { cfg, ctx } = await context(month);
  const pinned = keepPinned ? prev?.pinned ?? [] : [];
  const roster = generateRoster(cfg, month, pinned, prev ? toEngineRoster(prev, month) : undefined);
  const saved = await saveRoster(month, roster);
  await logChange('roster.generate', month, { keepPinned, pinned: pinned.length });
  res.json({ roster: saved, validation: validate(ctx, roster) });
}));

// Manual edits. Only W/WO are hand-editable: leaves come from approved absences and
// closures from calendars, so letting someone overwrite them would break the model.
api.patch('/rosters/:month', ah(async (req, res) => {
  const { month } = req.params;
  const { edits = [], addReliefs = [], removeReliefs = [] } = req.body ?? {};
  const doc = await mustFindRoster(month);
  const { ctx } = await context(month);
  const pinned = new Set(doc.pinned ?? []);

  for (const e of edits) {
    if (!ctx.emp.has(e.employeeId) || !ctx.dayIndex.has(e.date))
      throw httpError(400, `Unknown employee or date: ${e.employeeId} ${e.date}`);
    if (!['W', 'WO'].includes(e.status))
      throw httpError(400, 'Only W (working) and WO (weekly off) can be set by hand.');
    if (ctx.absence.has(`${e.employeeId}|${e.date}`))
      throw httpError(409, `${e.employeeId} has an approved absence on ${e.date}; change it under absences.`);
    if (['PH', 'CL'].includes(doc.cells?.[e.employeeId]?.[e.date]))
      throw httpError(409, `${e.date} is a closed day for ${e.employeeId}'s processes.`);
    pinned.add(`${e.employeeId}|${e.date}`);
  }
  for (const r of addReliefs)
    if (!ctx.emp.has(r.employeeId) || !ctx.proc.has(r.processId) || !ctx.dayIndex.has(r.date))
      throw httpError(400, 'addReliefs needs a valid employeeId, processId and date.');

  let roster = applyPatches(toEngineRoster(doc, month), [
    ...edits.map(e => ({ op: 'SET', employeeId: e.employeeId, date: e.date, status: e.status })),
    ...addReliefs.map(r => ({ op: 'ADD_RELIEF', employeeId: r.employeeId, processId: r.processId, date: r.date })),
  ]);
  roster = {
    ...roster,
    pinned: [...pinned],
    reliefs: roster.reliefs.filter(r => !removeReliefs.some(x =>
      x.employeeId === r.employeeId && x.processId === r.processId && x.date === r.date)),
  };
  const saved = await saveRoster(month, roster);
  await logChange('roster.edit', month, { edits: edits.length, addReliefs: addReliefs.length, removeReliefs: removeReliefs.length });
  // Return the validation immediately: the manager sees the impact of the edit they just made.
  res.json({ roster: saved, reopened: doc.status === 'published', validation: validate(ctx, roster) });
}));

// Ranked, simulated fixes for one coverage gap. Body: { processId, date }
api.post('/rosters/:month/suggestions', ah(async (req, res) => {
  const { month } = req.params;
  const { processId, date } = req.body ?? {};
  if (!processId || !date) throw httpError(400, 'processId and date are required');
  const doc = await mustFindRoster(month);
  const { ctx } = await context(month);
  res.json(suggestFor(ctx, toEngineRoster(doc, month), { processId, date }, new Set(doc.pinned ?? [])));
}));

// The change-handling flow. Body: { employeeId, date, type?: 'L'|'CO', apply?: boolean }
//   apply:false (default) = dry run: shows the damage and the auto-repair without saving anything.
//   apply:true            = records the absence AND saves the repaired roster as a new draft.
api.post('/rosters/:month/absence', ah(async (req, res) => {
  const { month } = req.params;
  const { employeeId, date, type = 'L', apply = false } = req.body ?? {};
  const doc = await mustFindRoster(month);
  const cfg = await loadConfig();
  const ctx = buildCtx(cfg, month);
  if (!ctx.emp.has(employeeId)) throw httpError(400, `Unknown employee ${employeeId}`);
  if (!ctx.dayIndex.has(date)) throw httpError(400, `${date} is not in ${month}`);
  if (!['L', 'CO'].includes(type)) throw httpError(400, "type must be 'L' or 'CO'");
  if (ctx.absence.has(`${employeeId}|${date}`)) throw httpError(409, 'That employee already has an absence on this date.');

  const id = randomId();
  const r = applyAbsence(cfg, month, toEngineRoster(doc, month), { id, employeeId, date, type });

  // For every gap that survives the auto-repair, attach ranked options for the manager.
  const locked = new Set(doc.pinned ?? []);
  const remainingGaps = r.validation.issues.filter(i => GAP.has(i.code)).slice(0, 12)
    .map(issue => ({ issue, suggestions: suggestFor(r.ctx2, r.repaired, issue, locked) }));

  if (apply) {
    await Absence.create({ id, employeeId, date, type });
    await saveRoster(month, r.repaired);
    await logChange('absence.apply', month, { employeeId, date, type, cellsChanged: r.changes.length });
  }
  res.json({
    applied: apply,
    gapsCausedByChange: r.impact.issues.filter(i => GAP.has(i.code)),   // before repair
    beforeRepair: r.impact.stats,
    afterRepair: r.validation.stats,
    remainingGaps,                                                      // needs the manager's decision
    changes: r.changes,                                                 // exactly which cells moved
  });
}));

// Publish gate: the server re-validates, so a stale or buggy client can't publish an invalid roster.
// Mandatory errors block publishing unless the manager explicitly overrides WITH a written reason.
api.post('/rosters/:month/publish', ah(async (req, res) => {
  const { month } = req.params;
  const { override = false, reason = '' } = req.body ?? {};
  const doc = await mustFindRoster(month);
  const { ctx } = await context(month);
  const v = validate(ctx, toEngineRoster(doc, month));
  const blocking = v.issues.filter(i => i.kind === 'MANDATORY' && i.severity === 'error');
  if (blocking.length && !(override && reason.trim()))
    throw httpError(422, `${blocking.length} mandatory issue(s) must be fixed, or override with a written reason.`,
      { blockingCount: blocking.length, issues: blocking.slice(0, 100), stats: v.stats });

  const saved = await Roster.findOneAndUpdate({ month }, {
    $set: { status: 'published', publishedAt: new Date(), issueCountAtPublish: blocking.length,
      ...(blocking.length && { overrideReason: reason.trim() }) },
  }, { new: true }).select('-_id').lean();
  await logChange('roster.publish', month, { blocking: blocking.length, overrideReason: reason.trim() || null });
  res.json({ roster: saved, stats: v.stats });
}));

// CSV export (opens in Excel / Google Sheets). 'W+R' means working and also booked as relief that day.
api.get('/rosters/:month/export.csv', ah(async (req, res) => {
  const { month } = req.params;
  const doc = await mustFindRoster(month);
  const { cfg, ctx } = await context(month);
  const esc = s => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const podName = new Map(cfg.pods.map(p => [p.id, p.name]));
  const relief = new Set((doc.reliefs ?? []).map(r => `${r.employeeId}|${r.date}`));
  const lines = [['Employee', 'Pod', ...ctx.days].map(esc).join(',')];
  for (const e of cfg.employees)
    lines.push([e.name, podName.get(e.podId) ?? '', ...ctx.days.map(d => {
      const s = doc.cells?.[e.id]?.[d] ?? '';
      return relief.has(`${e.id}|${d}`) ? `${s}+R` : s;
    })].map(esc).join(','));
  res.type('text/csv').attachment(`roster-${month}.csv`).send(lines.join('\n'));
}));

api.get('/changelog', ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(await strip(ChangeLog.find().sort({ at: -1 }).limit(limit)));
}));

api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
