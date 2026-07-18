export function shiftWeek(isoDate, deltaWeeks) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + deltaWeeks * 7);
  return d.toISOString().split('T')[0];
}
