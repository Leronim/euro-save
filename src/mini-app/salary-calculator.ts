import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc); dayjs.extend(timezone);

export function salaryCycle(payday: number, zone: string, now = new Date()) {
  const today = dayjs.utc(dayjs(now).tz(zone).format('YYYY-MM-DD'));
  const payment = (month: dayjs.Dayjs) => month.startOf('month').date(Math.min(payday, month.daysInMonth()));
  let start = payment(today);
  if (start.isAfter(today)) start = payment(today.subtract(1, 'month'));
  const end = payment(start.add(1, 'month'));
  return {
    start: dayjs.tz(start.format('YYYY-MM-DD'), zone).toDate(),
    end: dayjs.tz(end.format('YYYY-MM-DD'), zone).toDate(),
    label: `${start.format('DD.MM.YYYY')} – ${end.subtract(1, 'day').format('DD.MM.YYYY')}`,
    nextPayday: end.format('DD.MM.YYYY'),
    days: end.diff(start, 'day'), elapsed: today.diff(start, 'day') + 1,
  };
}

export function salaryResult(salary: number, background: number, spent: number, days: number, elapsed: number, count: number, savingsTarget = 1000) {
  const cents = (value: number) => Math.round(value * 100);
  const available = cents(salary) - cents(background);
  const remaining = (available - cents(spent)) / 100;
  const projectedExpenses = elapsed >= 3 && count > 0 ? Math.round(cents(spent) / elapsed * days) / 100 : null;
  const remainingDays = Math.max(1, days - elapsed + 1);
  const targetResult = (target: number) => {
    const budget = available - cents(target);
    const left = budget - cents(spent);
    return {
      target, periodBudget: budget / 100, remainingBudget: Math.max(0, left) / 100,
      dailyLimit: Math.floor(Math.max(0, left) / remainingDays) / 100,
      shortfall: Math.max(0, -left) / 100, achievable: left >= 0,
    };
  };
  const targets = [500, 1000, 1500].map(targetResult);
  return { remainingDays, targets, selectedTarget: targetResult(savingsTarget), background, spent, remaining, projectedExpenses, projectedSavings: projectedExpenses === null ? null : (available - cents(projectedExpenses)) / 100 };
}
