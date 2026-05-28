import { dayKey, dayRange, halfYearRange, monthRange, weekRange } from '../src/common/utils/date';
import { sha256 } from '../src/common/utils/hash';
import { formatMoney } from '../src/common/utils/money';

describe('common utils', () => {
  it('formats money with two decimals and currency', () => {
    expect(formatMoney(7.4, 'EUR')).toBe('7.40 EUR');
    expect(formatMoney('12', 'USD')).toBe('12.00 USD');
  });

  it('builds deterministic sha256 hashes', () => {
    expect(sha256('test')).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('returns day keys in YYYY-MM-DD format', () => {
    expect(dayKey('2026-05-27T21:30:00+03:00')).toBe('2026-05-27');
  });

  it('returns day range boundaries', () => {
    const range = dayRange(new Date('2026-05-27T15:30:00Z'));

    expect(range.start.toISOString()).toBe('2026-05-26T21:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-05-27T21:00:00.000Z');
  });

  it('returns month range boundaries', () => {
    const range = monthRange(new Date('2026-05-27T15:30:00Z'));

    expect(range.start.toISOString()).toBe('2026-04-30T21:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-05-31T21:00:00.000Z');
  });

  it('returns Monday to next Monday week range', () => {
    const range = weekRange(new Date('2026-05-28T15:30:00Z'));

    expect(range.start.toISOString()).toBe('2026-05-24T21:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-05-31T21:00:00.000Z');
  });

  it('returns current month plus five previous months for half-year range', () => {
    const range = halfYearRange(new Date('2026-05-28T15:30:00Z'));

    expect(range.start.toISOString()).toBe('2025-11-30T22:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-05-31T21:00:00.000Z');
  });
});
