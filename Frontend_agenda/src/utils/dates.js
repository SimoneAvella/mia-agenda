export function getWeekDates(startDate = new Date()) {
  // startDate = lunedì della settimana
  const weekStart = new Date(startDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // lunedì

  const weekdays = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];
  const days = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);

    const dayNum = d.getDate();
    const monthNum = String(d.getMonth() + 1).padStart(2, '0'); // sempre due cifre
    const dayStr = `${weekdays[d.getDay() === 0 ? 6 : d.getDay()-1]} ${dayNum}/${monthNum}`;
    
   days.push(dayStr);
  }
  return days;
}
