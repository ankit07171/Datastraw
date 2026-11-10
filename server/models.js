import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// Ids are plain strings that the engine references. Letters, digits, _ - : only, because
// employee ids become keys inside the roster document and Mongo keys can't contain '.' or '$'.
const ID = /^[A-Za-z0-9_:-]+$/;

function make(name, fields, indexes = []) {
  const schema = new Schema(
    { id: { type: String, required: true, unique: true, match: ID }, ...fields },
    // minimize:false keeps empty objects ({}) instead of silently dropping them,
    // and the engine reads p.minStaffByWeekday[...] so it must never be undefined.
    { versionKey: false, minimize: false },
  );
  indexes.forEach(([spec, opts]) => schema.index(spec, opts));
  return model(name, schema);
}

export const Pod = make('Pod', { name: { type: String, required: true }, leadId: String });

export const Employee = make('Employee', {
  name: { type: String, required: true, trim: true },
  podId: String,
  weeklyOffs: { type: Number, default: 1, min: 0, max: 3 },
  preferredOffDays: { type: [Number], default: [] },      // 0=Sun..6=Sat, a preference only
  maxConsecutiveWorkDays: { type: Number, default: 6, min: 1 },
});

export const Brand = make('Brand', { name: { type: String, required: true, trim: true } });

export const Proc = make('Process', {
  brandId: { type: String, required: true },
  name: { type: String, required: true },
  calendar: { type: String, enum: ['ALL_365', 'EXCEPT_HOLIDAYS', 'EXCEPT_SUN_HOLIDAYS'], required: true },
  minStaff: { type: Number, default: 1, min: 0 },
  minStaffByWeekday: { type: Schema.Types.Mixed, default: {} },   // { "5": 2 } = 2 people on Fridays
  minStaffByDate: { type: Schema.Types.Mixed, default: {} },      // { "2026-12-12": 3 } = sale day
  closedDates: { type: [String], default: [] },
});

// One row per (employee, process, role). The unique index blocks accidental duplicates.
export const Assignment = make('Assignment', {
  employeeId: { type: String, required: true },
  processId: { type: String, required: true },
  role: { type: String, enum: ['primary', 'backup'], default: 'primary' },
}, [[{ employeeId: 1, processId: 1, role: 1 }, { unique: true }]]);

export const Absence = make('Absence', {
  employeeId: { type: String, required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  type: { type: String, enum: ['L', 'CO'], required: true },        // leave | comp-off
}, [[{ employeeId: 1, date: 1 }, { unique: true }]]);

export const Holiday = make('Holiday', {
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  name: { type: String, required: true },
});

// A single document (key: 'main') holding global rules.
export const Settings = model('Settings', new Schema({
  key: { type: String, unique: true },
  maxBrandsPerDay: { type: Number, default: 3, min: 1 },
  leaveCountsAsWeeklyOff: { type: Boolean, default: false },
}, { versionKey: false }));

// One document per month. No schema defaults for status/version: saveRoster sets them
// explicitly, which avoids Mongo "update path conflict" errors on upsert.
export const Roster = model('Roster', new Schema({
  month: { type: String, unique: true, required: true },
  cells: { type: Schema.Types.Mixed, default: {} },     // employeeId -> date -> status
  reliefs: { type: [Schema.Types.Mixed], default: [] }, // backup cover booked on top of own work
  pinned: { type: [String], default: [] },              // 'employeeId|date' cells the manager set by hand
  status: { type: String, enum: ['draft', 'published'] },
  version: Number,
  publishedAt: Date,
  overrideReason: String,                               // set if published despite mandatory issues
  issueCountAtPublish: Number,
}, { versionKey: false, minimize: false }));

// Append-only audit trail: what changed, and why a roster was published.
export const ChangeLog = model('ChangeLog', new Schema({
  at: { type: Date, default: Date.now },
  month: String,
  action: String,
  detail: Schema.Types.Mixed,
}, { versionKey: false }));
