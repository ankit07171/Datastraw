import type { Status } from '../engine';

export const STATUS_LABEL: Record<Status, string> = {
  W: 'Working', WO: 'Weekly off', PH: 'Public holiday', CL: 'Closed (calendar)', L: 'Leave', CO: 'Comp-off',
};
export const STATUS_SHORT: Record<Status, string> = { W: 'W', WO: 'OFF', PH: 'PH', CL: 'CL', L: 'L', CO: 'CO' };

export function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      {(Object.keys(STATUS_LABEL) as Status[]).map(s => (
        <span key={s}><i className={`sw s-${s}`} />{STATUS_SHORT[s]} {STATUS_LABEL[s].toLowerCase()}</span>
      ))}
      <span><i className="sw" style={{ background: 'var(--gap)' }} />coverage gap</span>
      <span><b style={{ color: 'var(--accent)' }}>R</b> booked as relief</span>
      <span><i className="sw" style={{ background: 'linear-gradient(135deg,var(--accent) 50%,transparent 50%)' }} />pinned by hand</span>
    </div>
  );
}

export const CODE_LABEL: Record<string, string> = {
  NO_COVERAGE: 'No one covering', UNDERSTAFFED: 'Understaffed', NO_ASSIGNEE: 'No employee assigned',
  LEAVE_CONFLICT: 'Rostered on leave', CONSECUTIVE_DAYS: 'Too many days in a row',
  WEEKLY_OFF_SHORT: 'Weekly off missing', OVERLOAD: 'Too many brands in a day',
  RELIEF_INVALID: 'Relief not working', PREF_OFF_DAY: 'Off day not preferred',
};

export const shortDate = (d: string) => new Date(d + 'T00:00:00Z')
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
