import { randomUUID } from 'node:crypto';
import {
  Absence, Assignment, Brand, ChangeLog, Employee, Holiday, Pod, Proc, Roster, Settings,
} from './models.js';
import { generateRoster } from '../src/engine/index.ts';
import { seedConfig } from '../src/data/seed.ts';

// The ORDER here matters: loadConfig destructures in this order.
export const MODELS = {
  pods: Pod, employees: Employee, brands: Brand, processes: Proc,
  assignments: Assignment, absences: Absence, holidays: Holiday,
};
export const DEFAULT_MONTH = '2026-12';
export const randomId = () => randomUUID();

export function httpError(status, message, details) {
  return Object.assign(new Error(message), { status, details });
}

// Assemble the exact `Config` object the engine expects from the collections.
export async function loadConfig() {
  const [pods, employees, brands, processes, assignments, absences, holidays, settings] =
    await Promise.all([
      ...Object.values(MODELS).map(M => M.find().select('-_id').lean()),
      Settings.findOne({ key: 'main' }).select('-_id -key').lean(),
    ]);
  return {
    pods, brands, assignments, absences, holidays,
    // Normalise optional fields so a hand-edited document can never crash the engine.
    employees: employees.map(e => ({ weeklyOffs: 1, maxConsecutiveWorkDays: 6, ...e, preferredOffDays: e.preferredOffDays ?? [] })),
    processes: processes.map(p => ({
      minStaff: 1, ...p,
      minStaffByWeekday: p.minStaffByWeekday ?? {},
      minStaffByDate: p.minStaffByDate ?? {},
      closedDates: p.closedDates ?? [],
    })),
    settings: { maxBrandsPerDay: 3, leaveCountsAsWeeklyOff: false, ...settings },
  };
}

// Stored document -> the engine's Roster shape.
export const toEngineRoster = (doc, month) => ({
  month, cells: doc?.cells ?? {}, reliefs: doc?.reliefs ?? [], pinned: doc?.pinned ?? [],
});

// Every save lands as a draft and bumps the version; editing a published roster re-opens it.
export function saveRoster(month, roster, extra = {}) {
  return Roster.findOneAndUpdate(
    { month },
    {
      $set: { cells: roster.cells, reliefs: roster.reliefs, pinned: roster.pinned, status: 'draft', ...extra },
      $unset: { publishedAt: '', overrideReason: '', issueCountAtPublish: '' },
      $inc: { version: 1 },
    },
    { upsert: true, new: true },
  ).select('-_id').lean();
}

// Audit logging must never break the request that triggered it.
export async function logChange(action, month, detail) {
  try { await ChangeLog.create({ action, month, detail }); } catch (e) { console.error('changelog failed', e.message); }
}

// Load sample data (33 employees, 20 brands, 3 pods) and generate a first draft roster.
export async function seed({ force = false } = {}) {
  if (!force && (await Employee.estimatedDocumentCount()) > 0) return false;
  const cfg = seedConfig();
  await Promise.all([
    ...Object.values(MODELS).map(M => M.deleteMany({})),
    Roster.deleteMany({}), Settings.deleteMany({}),
  ]);
  await Promise.all([
    Pod.insertMany(cfg.pods), Employee.insertMany(cfg.employees),
    Brand.insertMany(cfg.brands), Proc.insertMany(cfg.processes),
    Assignment.insertMany(cfg.assignments.map(a => ({ id: `${a.employeeId}:${a.processId}:${a.role}`, ...a }))),
    Absence.insertMany(cfg.absences),
    Holiday.insertMany(cfg.holidays.map(h => ({ id: h.date, ...h }))),
    Settings.create({ key: 'main', ...cfg.settings }),
  ]);
  await saveRoster(DEFAULT_MONTH, generateRoster(await loadConfig(), DEFAULT_MONTH));
  return true;
}
