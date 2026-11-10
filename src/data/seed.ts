import type { CalendarType, Config, Process } from '../engine/types';

const CAL: Record<string, CalendarType> = { '365': 'ALL_365', HOL: 'EXCEPT_HOLIDAYS', SUN: 'EXCEPT_SUN_HOLIDAYS' };
const PNAME: Record<string, string> = { CS: 'Customer Support', ACC: 'Abandoned Cart', RET: 'Retention', NDR: 'NDR' };
const NAMES = ['Anita Deshmukh','Rohan Mehta','Sneha Kulkarni','Priya Sharma','Arjun Nair','Kavya Iyer','Imran Shaikh',
  'Neha Gupta','Vikram Singh','Pooja Patil','Rahul Verma','Ananya Rao','Siddharth Joshi','Meera Pillai','Karan Malhotra',
  'Divya Menon','Aditya Bhatt','Ishita Das','Farhan Ansari','Tanvi Shah','Yash Chauhan','Riya Kapoor','Nikhil Reddy',
  'Shruti Jain','Manish Yadav','Sana Qureshi','Omkar Pawar','Harsh Trivedi','Lavanya Krishnan','Dev Sethi','Mohit Rane',
  'Aisha Khan','Tejas More'];
const eid = (n: number) => `e${String(n).padStart(2, '0')}`;
const FLOATER: Record<string, string> = { alpha: 'e31', bravo: 'e32', charlie: 'e33' };

// [brand, pod, 'PROCESS:calendar,...'] -> one dedicated employee each (e04..e19)
// calendar codes: 365 = every day, HOL = every day except public holidays, SUN = closed Sundays + holidays
const SINGLES: [string, string, string][] = [
  ['Lumina Skincare','alpha','CS:365,ACC:365,NDR:HOL'], ['UrbanThread','bravo','CS:HOL,ACC:SUN'],
  ['Nomad Gear','charlie','CS:365,RET:HOL'], ['PureBrew Coffee','alpha','CS:SUN,ACC:SUN'],
  ['Zenith Wear','bravo','CS:365,NDR:SUN'], ['Kiddo Toys','charlie','CS:HOL,ACC:HOL'],
  ['GlowUp Beauty','alpha','CS:365,ACC:HOL,RET:HOL'], ['TerraFoods','bravo','CS:SUN,NDR:SUN'],
  ['FitFuel','charlie','CS:365,ACC:365'], ['PetPals','alpha','CS:HOL,ACC:SUN'],
  ['HomeNest Decor','bravo','CS:SUN,ACC:SUN,NDR:SUN'], ['Aurora Jewels','charlie','CS:HOL,RET:HOL'],
  ['BoltBikes','alpha','CS:365,NDR:HOL'], ['Velvet Candles','bravo','CS:SUN,ACC:SUN'],
  ['MintFresh','charlie','CS:HOL,ACC:HOL'], ['Sparkle Gadgets','alpha','CS:365,ACC:SUN'],
];
// Multi-employee brands: separate AND overlapping process ownership, plus day-specific minimums.
const MULTI = [
  { id: 'bloom', name: 'Bloom Organics', pod: 'alpha',
    procs: [['CS','365',1],['ACC','HOL',1],['NDR','SUN',1]] as [string,string,number][],
    staff: { e20: ['CS'], e21: ['CS','NDR'], e22: ['ACC'] } as Record<string, string[]> },
  { id: 'swiftkart', name: 'SwiftKart', pod: 'bravo',
    procs: [['CS','365',1],['ACC','365',1],['RET','HOL',1],['NDR','SUN',1]] as [string,string,number][],
    staff: { e23: ['CS'], e24: ['ACC'], e25: ['RET','NDR'] } as Record<string, string[]> },
  { id: 'craftly', name: 'Craftly', pod: 'charlie',
    procs: [['CS','HOL',1],['ACC','SUN',1]] as [string,string,number][],
    staff: { e26: ['CS'], e27: ['CS','ACC'] } as Record<string, string[]> },
  { id: 'orbit', name: 'Orbit Electronics', pod: 'bravo',
    procs: [['CS','365',1],['ACC','HOL',1]] as [string,string,number][],
    staff: { e28: ['CS'], e29: ['CS'], e30: ['CS','ACC'] } as Record<string, string[]> },
];

export function seedConfig(): Config {
  const cfg: Config = {
    pods: [], employees: [], brands: [], processes: [], assignments: [], absences: [],
    holidays: [
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2027-01-01', name: "New Year's Day" },
      { date: '2027-01-26', name: 'Republic Day' },
    ],
    settings: { maxBrandsPerDay: 3, leaveCountsAsWeeklyOff: false },
  };
  const podOf: Record<number, string> = {};
  for (let n = 1; n <= 3; n++) podOf[n] = ['alpha','bravo','charlie'][n - 1];
  SINGLES.forEach(([, pod], i) => (podOf[4 + i] = pod));
  MULTI.forEach(m => Object.keys(m.staff).forEach(k => (podOf[+k.slice(1)] = m.pod)));
  [31, 32, 33].forEach((n, i) => (podOf[n] = ['alpha','bravo','charlie'][i]));

  for (let n = 1; n <= 33; n++)
    cfg.employees.push({
      id: eid(n), name: NAMES[n - 1], podId: podOf[n], weeklyOffs: 1, maxConsecutiveWorkDays: 6,
      preferredOffDays: n % 5 === 0 ? [0, 6] : n % 4 === 0 ? [0] : [],
    });
  cfg.pods = [
    { id: 'alpha', name: 'Pod Alpha', leadId: 'e01' },
    { id: 'bravo', name: 'Pod Bravo', leadId: 'e02' },
    { id: 'charlie', name: 'Pod Charlie', leadId: 'e03' },
  ];

  const addProcess = (brandId: string, code: string, cal: string, min = 1, wk: Process['minStaffByWeekday'] = {}) => {
    const id = `${brandId}-${code}`;
    cfg.processes.push({ id, brandId, name: PNAME[code], calendar: CAL[cal], minStaff: min,
      minStaffByWeekday: wk, minStaffByDate: {}, closedDates: [] });
    return id;
  };

  SINGLES.forEach(([name, pod, spec], i) => {
    const brandId = `b${i + 1}`, emp = eid(4 + i);
    cfg.brands.push({ id: brandId, name });
    for (const part of spec.split(',')) {
      const [code, cal] = part.split(':');
      const pid = addProcess(brandId, code, cal);
      cfg.assignments.push({ employeeId: emp, processId: pid, role: 'primary' });
      // Anything not auto-closed on Sunday needs relief when the sole owner takes a weekly off.
      if (cal !== 'SUN') cfg.assignments.push({ employeeId: FLOATER[pod], processId: pid, role: 'backup' });
    }
  });

  MULTI.forEach(m => {
    cfg.brands.push({ id: m.id, name: m.name });
    m.procs.forEach(([code, cal, min]) => {
      // Orbit CS needs two people on Fri/Sat peak days.
      addProcess(m.id, code, cal, min, m.id === 'orbit' && code === 'CS' ? { 5: 2, 6: 2 } : {});
    });
    Object.entries(m.staff).forEach(([emp, codes]) =>
      codes.forEach(c => cfg.assignments.push({ employeeId: emp, processId: `${m.id}-${c}`, role: 'primary' })));
    // Teammates in the same brand back each other up on processes they don't own.
    Object.keys(m.staff).forEach(emp =>
      m.procs.forEach(([code]) => {
        if (!m.staff[emp].includes(code))
          cfg.assignments.push({ employeeId: emp, processId: `${m.id}-${code}`, role: 'backup' });
      }));
  });

  cfg.absences = [
    { id: 'a1', employeeId: 'e06', date: '2026-12-14', type: 'L' },
    { id: 'a2', employeeId: 'e22', date: '2026-12-15', type: 'L' },
    { id: 'a3', employeeId: 'e25', date: '2026-12-18', type: 'CO' },
  ];
  return cfg;
}
