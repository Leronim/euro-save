import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezonePlugin from 'dayjs/plugin/timezone';
import 'dayjs/locale/ru';
import { Category, Expense, Prisma } from '@prisma/client';
import { formatMoney } from '../common/utils/money';

dayjs.extend(utc);
dayjs.extend(timezonePlugin);
export type ReportPeriod = 'w' | 'm';
// UUID views open a category's operations; 'u' selects uncategorized expenses.
export type ReportView = 's' | 'c' | 'd' | 'o' | 'u' | (string & {});
type Row = Expense & { category: Category | null };
const key = (date: dayjs.Dayjs) => date.format('YYYYMMDD');
const calendar = (date: dayjs.Dayjs, timezone: string) => dayjs.tz(date.format('YYYY-MM-DD'), timezone);

export function reportRange(period: ReportPeriod, anchor: string | undefined, timezone: string, now = new Date()) {
  const today = dayjs(now).tz(timezone);
  const base = anchor ? dayjs(`${anchor.slice(0, 4)}-${anchor.slice(4, 6)}-${anchor.slice(6, 8)}`) : dayjs(today.format('YYYY-MM-DD'));
  if (!base.isValid() || (anchor && key(base) !== anchor)) throw new Error('Invalid report date');
  const begin = (date: dayjs.Dayjs) => period === 'm' ? date.startOf('month') : date.subtract((date.day() + 6) % 7, 'day').startOf('day');
  const current = begin(dayjs(today.format('YYYY-MM-DD')));
  const start = begin(base).isAfter(current) ? current : begin(base);
  const end = period === 'm' ? start.add(1, 'month') : start.add(7, 'day');
  const previous = period === 'm' ? start.subtract(1, 'month') : start.subtract(7, 'day');
  const active = key(start) === key(current);
  const elapsed = active ? dayjs(today.format('YYYY-MM-DD')).diff(start, 'day') + 1 : end.diff(start, 'day');
  // Compare through the same local time on the corresponding day, capped at the previous period's end.
  const previousDay = previous.add(elapsed - 1, 'day');
  const previousInstant = dayjs.tz(`${previousDay.format('YYYY-MM-DD')} ${today.format('HH:mm:ss.SSS')}`, timezone);
  const previousEnd = calendar(start, timezone);
  return {
    period, timezone, anchor: key(start), previousAnchor: key(previous), nextAnchor: key(end), active, elapsed,
    days: end.diff(start, 'day'), start: calendar(start, timezone).toDate(),
    cutoff: active ? now : calendar(end, timezone).toDate(),
    previousStart: calendar(previous, timezone).toDate(),
    previousCutoff: active && previousInstant.isBefore(previousEnd) ? previousInstant.toDate() : previousEnd.toDate(),
    label: `${start.format('DD.MM.YYYY')}–${end.subtract(1, 'day').format('DD.MM.YYYY')}`,
    through: today.format('DD.MM HH:mm'),
  };
}

type Report = { range: ReturnType<typeof reportRange>; expenses: Row[]; previous: Row[] };
const total = (rows: Row[]) => rows.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0)).toNumber();
const short = (value: string, length = 65) => value.replace(/\s+/g, ' ').slice(0, length);
const categoryLabel = (row: Row) => short(row.category ? `${row.category.emoji ?? ''} ${row.category.name}`.trim() : '❓ Другое');

export function renderPeriodReport(report: Report, view: ReportView = 's', requestedPage = 0) {
  const { range: r, expenses, previous } = report;
  const button = (text: string, period = r.period, anchor = r.anchor, tab: ReportView = 's', page = 0) => ({
    text, callback_data: `r:${period}:${anchor}:${tab}:${page}`,
  });
  const lines = [r.period === 'w' ? '📊 Расходы за неделю' : '📅 Расходы за месяц', r.label];
  if (r.active) lines.push(`По ${r.through} · время Кипра`);
  lines.push('Только подтверждённые расходы', '');
  if (view !== 's') lines.push(view === 'c' ? 'Категории' : view === 'd' ? 'По дням' : view === 'o' ? 'Операции' : 'Операции категории');
  const currencies = [...new Set([...expenses, ...previous].map(row => row.currency))].sort();
  let sections: string[] = [];
  let extra: ReturnType<typeof button>[][] = [];
  let pageSize = 6;
  if (view === 's') {
    pageSize = 2;
    sections = currencies.map(currency => {
      const rows = expenses.filter(row => row.currency === currency);
      const amount = total(rows);
      const old = total(previous.filter(row => row.currency === currency));
      const change = old > 0 ? `${amount < old ? '↓' : amount > old ? '↑' : '→'} ${Math.abs((amount - old) / old * 100).toFixed(0)}% к предыдущему периоду` : 'Нет базы для сравнения';
      const categories = [...new Set(rows.map(row => row.categoryId))].map(id => {
        const items = rows.filter(row => row.categoryId === id);
        return { label: categoryLabel(items[0]), amount: total(items) };
      }).sort((a, b) => b.amount - a.amount);
      return [
        `Всего: ${formatMoney(amount, currency)}`, change,
        `Операций: ${rows.length} · Средний чек: ${formatMoney(rows.length ? amount / rows.length : 0, currency)}`,
        ...(r.period === 'm' ? [`В среднем за день: ${formatMoney(amount / r.elapsed, currency)}`,
          ...(r.active && r.elapsed >= 3 ? [`Прогноз: ≈ ${formatMoney(amount / r.elapsed * r.days, currency)} (по среднему в день)`] : [])] : []),
        ...categories.slice(0, 3).map(c => `${c.label}: ${formatMoney(c.amount, currency)} · ${amount ? Math.round(c.amount / amount * 100) : 0}%`),
      ].join('\n');
    });
  } else if (view === 'c') {
    const ids = [...new Set(expenses.map(row => row.categoryId ?? 'other'))].sort();
    sections = ids.map(id => {
      const rows = expenses.filter(row => (row.categoryId ?? 'other') === id);
      return `${categoryLabel(rows[0])}\n${[...new Set(rows.map(row => row.currency))].map(currency => {
        const amount = total(rows.filter(row => row.currency === currency));
        const sum = total(expenses.filter(row => row.currency === currency));
        return `${formatMoney(amount, currency)} · ${sum ? Math.round(amount / sum * 100) : 0}%`;
      }).join(' / ')}`;
    });
    extra = ids.map(id => [button(categoryLabel(expenses.find(row => (row.categoryId ?? 'other') === id)!), r.period, r.anchor, id === 'other' ? 'u' : id)]);
  } else if (view === 'd') {
    const start = dayjs(r.start).tz(r.timezone).format('YYYY-MM-DD');
    sections = Array.from({ length: r.elapsed }, (_, i) => {
      const date = dayjs(start).add(i, 'day');
      const rows = expenses.filter(row => dayjs(row.transactionDate).tz(r.timezone).format('YYYY-MM-DD') === date.format('YYYY-MM-DD'));
      return `${date.locale('ru').format('dd, DD.MM')}: ${rows.length ? [...new Set(rows.map(row => row.currency))].map(currency => formatMoney(total(rows.filter(row => row.currency === currency)), currency)).join(' / ') : 'нет расходов'}`;
    });
    pageSize = 10;
  } else {
    const rows = view === 'o' ? expenses : expenses.filter(row => (row.categoryId ?? 'u') === view);
    sections = rows.map((row, i) => `${i + 1}. ${dayjs(row.transactionDate).tz(r.timezone).format('DD.MM HH:mm')} · ${short(row.merchant ?? row.description ?? 'Расход')}\n${formatMoney(Number(row.amount), row.currency)} · ${categoryLabel(row)}`);
    extra = rows.map((row, i) => [
      { text: `✏️ ${i + 1}`, callback_data: `expense:edit_saved:${row.id}` },
      { text: `🏷 ${i + 1}`, callback_data: `expense:categories:${row.id}` },
      { text: `Удалить ${i + 1}`, callback_data: `expense:delete:${row.id}` },
    ]);
  }
  const pages = Math.max(1, Math.ceil(sections.length / pageSize));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  lines.push(...(sections.length ? sections.slice(page * pageSize, (page + 1) * pageSize) : ['Расходов за этот период нет.']));
  if (r.active && view === 's') lines.push('', 'Сравнение с тем же отрезком предыдущего периода, до текущего времени.');
  if (pages > 1) lines.push('', `Страница ${page + 1} из ${pages}`);
  const keyboard = extra.slice(page * pageSize, (page + 1) * pageSize);
  if (pages > 1) keyboard.push([
    ...(page > 0 ? [button('‹ Страница', r.period, r.anchor, view, page - 1)] : []),
    ...(page + 1 < pages ? [button('Страница ›', r.period, r.anchor, view, page + 1)] : []),
  ]);
  keyboard.push([
    button('‹ Предыдущая', r.period, r.previousAnchor),
    ...(r.active ? [] : [button('Следующая ›', r.period, r.nextAnchor)]),
  ]);
  keyboard.push([button(view === 's' ? '✓ Обзор' : 'Обзор'), button(view === 'c' ? '✓ Категории' : 'Категории', r.period, r.anchor, 'c')]);
  keyboard.push([button(view === 'd' ? '✓ По дням' : 'По дням', r.period, r.anchor, 'd'), button(view === 'o' ? '✓ Операции' : 'Операции', r.period, r.anchor, 'o')]);
  keyboard.push([button(r.period === 'w' ? '✓ Неделя' : 'Неделя', 'w'), button(r.period === 'm' ? '✓ Месяц' : 'Месяц', 'm')]);
  const currentAnchor = key(dayjs().tz(r.timezone));
  if (!r.active) keyboard.push([button('К текущему периоду', r.period, currentAnchor)]);
  keyboard.push([{ text: '✕ Закрыть отчёт', callback_data: 'report:close' }]);
  return { text: lines.join('\n\n').replace(/\n{3,}/g, '\n\n'), reply_markup: { inline_keyboard: keyboard } };
}
