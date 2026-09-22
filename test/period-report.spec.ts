import { Prisma } from '@prisma/client';
import { reportRange, renderPeriodReport } from '../src/expenses/period-report';

const row = (currency: string, amount: number, id = 'a') => ({
  id, currency, amount: new Prisma.Decimal(amount), transactionDate: new Date('2026-09-22T09:00:00Z'),
  categoryId: null, category: null, merchant: 'LIDL',
} as any);

describe('calendar report ranges', () => {
  it('uses Nicosia Monday boundaries even when UTC is still Sunday', () => {
    const r = reportRange('w', undefined, 'Europe/Nicosia', new Date('2026-09-20T22:00:00Z'));
    expect(r.anchor).toBe('20260921');
    expect(r.start.toISOString()).toBe('2026-09-20T21:00:00.000Z');
    expect(r.previousCutoff.toISOString()).toBe('2026-09-13T22:00:00.000Z');
  });
  it('reconstructs each midnight across daylight saving changes', () => {
    const r = reportRange('w', '20260323', 'Europe/Nicosia', new Date('2026-04-05T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2026-03-22T22:00:00.000Z');
    expect(r.cutoff.toISOString()).toBe('2026-03-29T21:00:00.000Z');
    expect(r.days).toBe(7);
  });
  it('caps comparison at February end on March 31', () => {
    const r = reportRange('m', undefined, 'Europe/Nicosia', new Date('2026-03-31T12:00:00Z'));
    expect(r.previousStart.toISOString()).toBe('2026-01-31T22:00:00.000Z');
    expect(r.previousCutoff.toISOString()).toBe('2026-02-28T22:00:00.000Z');
  });
  it('uses the full previous month for a completed month', () => {
    const r = reportRange('m', '20260201', 'Europe/Nicosia', new Date('2026-09-22T12:00:00Z'));
    expect(r.previousCutoff.toISOString()).toBe('2026-01-31T22:00:00.000Z');
    expect(r.active).toBe(false);
    expect(r.previousAnchor).toBe('20260101');
  });
  it('rejects normalized invalid dates and clamps future periods', () => {
    expect(() => reportRange('m', '20260231', 'Europe/Nicosia')).toThrow('Invalid');
    expect(reportRange('m', '20300101', 'Europe/Nicosia', new Date('2026-09-22T12:00:00Z')).anchor).toBe('20260901');
  });
});

describe('report screens', () => {
  const range = reportRange('m', undefined, 'Europe/Nicosia', new Date('2026-09-22T12:00:00Z'));
  it('keeps currency totals and comparison baselines separate', () => {
    const result = renderPeriodReport({ range, expenses: [row('EUR', 10), row('USD', 100)], previous: [row('EUR', 20)] });
    expect(result.text).toContain('10.00 EUR');
    expect(result.text).toContain('100.00 USD');
    expect(result.text).not.toContain('110.00');
    expect(result.text).toContain('↓ 50%');
    expect(result.text).toContain('Нет базы для сравнения');
    expect(result.reply_markup.inline_keyboard.flat().some(b => b.text === 'Следующая ›')).toBe(false);
  });
  it('paginates long operations, preserves report state and keeps Telegram limits', () => {
    const expenses = Array.from({ length: 200 }, (_, i) => ({ ...row('EUR', 1, `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`), merchant: 'x'.repeat(2000) }));
    const result = renderPeriodReport({ range, expenses, previous: [] }, 'o', 1);
    expect(result.text).toContain('7.');
    expect(result.text).toContain('Страница 2 из 34');
    expect(result.text.length).toBeLessThan(4096);
    expect(result.reply_markup.inline_keyboard.flat().every(b => Buffer.byteLength(b.callback_data) <= 64)).toBe(true);
    expect(result.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'r:m:20260901:o:2')).toBe(true);
  });
  it('shows empty days and an actionable empty summary', () => {
    expect(renderPeriodReport({ range, expenses: [], previous: [] }).text).toContain('Расходов за этот период нет');
    expect(renderPeriodReport({ range, expenses: [], previous: [] }, 'd').text).toContain('01.09: нет расходов');
  });
});
