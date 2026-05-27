import dayjs from 'dayjs';

export function dayKey(value?: Date | string): string {
  return dayjs(value ?? new Date()).format('YYYY-MM-DD');
}

export function monthRange(date = new Date()) {
  const start = dayjs(date).startOf('month').toDate();
  const end = dayjs(date).add(1, 'month').startOf('month').toDate();
  return { start, end };
}
