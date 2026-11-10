export type ISODate = string; // 'YYYY-MM-DD'
// W=working, WO=weekly off, PH=public holiday (closed), CL=calendar closure (e.g. Sunday), L=leave, CO=comp-off
export type Status = 'W' | 'WO' | 'PH' | 'CL' | 'L' | 'CO';
export type CalendarType = 'ALL_365' | 'EXCEPT_HOLIDAYS' | 'EXCEPT_SUN_HOLIDAYS';

export interface Pod { id: string; name: string; leadId: string }
export interface Employee {
  id: string; name: string; podId: string;
  weeklyOffs: number;               // offs per 7 days
  preferredOffDays: number[];       // 0=Sun..6=Sat, a PREFERENCE only
  maxConsecutiveWorkDays: number;   // MANDATORY labour rule
}
export interface Brand { id: string; name: string }
export interface Process {
  id: string; brandId: string; name: string;
  calendar: CalendarType;
  minStaff: number;
  minStaffByWeekday: Partial<Record<number, number>>; // e.g. {5: 2} = 2 people on Fridays
  minStaffByDate: Record<ISODate, number>;            // one-off overrides (sale days)
  closedDates: ISODate[];
}
export interface Assignment { id?: string; employeeId: string; processId: string; role: 'primary' | 'backup' }
export interface Absence { id: string; employeeId: string; date: ISODate; type: 'L' | 'CO' }
export interface Holiday { id?: string; date: ISODate; name: string }
export interface Settings { maxBrandsPerDay: number; leaveCountsAsWeeklyOff: boolean }

export interface Config {
  pods: Pod[]; employees: Employee[]; brands: Brand[]; processes: Process[];
  assignments: Assignment[]; absences: Absence[]; holidays: Holiday[]; settings: Settings;
}

export interface Relief { date: ISODate; employeeId: string; processId: string }
export interface Roster {
  month: string;                                   // 'YYYY-MM'
  cells: Record<string, Record<ISODate, Status>>;  // employeeId -> date -> status
  reliefs: Relief[];                               // backup cover booked on top of own work
  pinned: string[];                                // 'employeeId|date' set by manual edits
}
