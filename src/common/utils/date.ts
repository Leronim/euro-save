import dayjs from 'dayjs';

export function dayKey(value?: Date | string): string {
  return dayjs(value ?? new Date()).format('YYYY-MM-DD');
}

export function monthRange(date = new Date()) {
  const start = dayjs(date).startOf('month').toDate();
  const end = dayjs(date).add(1, 'month').startOf('month').toDate();
  return { start, end };
}

export function dayRange(date = new Date()) {
  const start = dayjs(date).startOf('day').toDate();
  const end = dayjs(date).add(1, 'day').startOf('day').toDate();
  return { start, end };
}

export function weekRange(date = new Date()) {
  const current = dayjs(date);
  const mondayOffset = (current.day() + 6) % 7;
  const start = current.subtract(mondayOffset, 'day').startOf('day').toDate();
  const end = dayjs(start).add(7, 'day').toDate();
  return { start, end };
}

export function halfYearRange(date = new Date()) {
  const start = dayjs(date).subtract(5, 'month').startOf('month').toDate();
  const end = dayjs(date).add(1, 'month').startOf('month').toDate();
  return { start, end };
}
