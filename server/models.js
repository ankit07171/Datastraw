import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const ID = /^[A-Za-z0-9_:-]+$/;

function make(name, fields, indexes = []) {
  const schema = new Schema(
    { id: { type: String, required: true, unique: true, match: ID }, ...fields },
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
  preferredOffDays: { type: [Number], default: [] },
  maxConsecutiveWorkDays: { type: Number, default: 6, min: 1 },
});

export const Brand = make('Brand', { name: { type: String, required: true, trim: true } });

export const Proc = make('Process', {
  brandId: { type: String, required: true },
  name: { type: String, required: true },
  calendar: { type: String, enum: ['ALL_365', 'EXCEPT_HOLIDAYS', 'EXCEPT_SUN_HOLIDAYS'], required: true },
  minStaff: { type: Number, default: 1, min: 0 },
  minStaffByWeekday: { type: Schema.Types.Mixed, default: {} },
  minStaffByDate: { type: Schema.Types.Mixed, default: {} },
  closedDates: { type: [String], default: [] },
});

export const Assignment = make('Assignment', {
  employeeId: { type: String, required: true },
  processId: { type: String, required: true },
  role: { type: String, enum: ['primary', 'backup'], default: 'primary' },
}, [[{ employeeId: 1, processId: 1, role: 1 }, { unique: true }]]);

export const Absence = make('Absence', {
  employeeId: { type: String, required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  type: { type: String, enum: ['L', 'CO'], required: true },
}, [[{ employeeId: 1, date: 1 }, { unique: true }]]);

export const Holiday = make('Holiday', {
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  name: { type: String, required: true },
});

export const Settings = model('Settings', new Schema({
  key: { type: String, unique: true },
  maxBrandsPerDay: { type: Number, default: 3, min: 1 },
  leaveCountsAsWeeklyOff: { type: Boolean, default: false },
}, { versionKey: false }));

export const Roster = model('Roster', new Schema({
  month: { type: String, unique: true, required: true },
  cells: { type: Schema.Types.Mixed, default: {} },
  reliefs: { type: [Schema.Types.Mixed], default: [] },
  pinned: { type: [String], default: [] },
  status: { type: String, enum: ['draft', 'published'] },
  version: Number,
  publishedAt: Date,
  overrideReason: String,
  issueCountAtPublish: Number,
}, { versionKey: false, minimize: false }));

export const ChangeLog = model('ChangeLog', new Schema({
  at: { type: Date, default: Date.now },
  month: String,
  action: String,
  detail: Schema.Types.Mixed,
}, { versionKey: false }));
