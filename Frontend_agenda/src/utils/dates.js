export function getWeekDates(startDate = new Date()) {
  const weekStart = new Date(startDate);
  // Trova il lunedì della settimana (Lunedì = 1, Domenica = 0)
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1));
  
  const weekdays = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dayName = weekdays[i];
    const dayNum = d.getDate();
    const monthNum = String(d.getMonth() + 1).padStart(2, '0');
    days.push(`${dayName} ${dayNum}/${monthNum}`);
  }
  return days;
}

export function getTodayString() {
  const d = new Date();
  const weekdays = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  const dayNum = d.getDate();
  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
  const dayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
  return `${weekdays[dayIndex]} ${dayNum}/${monthNum}`;
}
