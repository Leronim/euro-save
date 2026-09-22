import { historyQuery } from '../src/mini-app/history-query';

describe('expense history filters', () => {
  it('searches every month and scopes every query to its owner', () => {
    const { where, skip } = historyQuery('owner', { q: ' Zorbas ' }, 'Europe/Nicosia');
    expect(where).toEqual({ userId: 'owner', OR: [{ merchant: { contains: 'Zorbas', mode: 'insensitive' } }, { description: { contains: 'Zorbas', mode: 'insensitive' } }] });
    expect(skip).toBe(0);
  });
  it.each([
    ['2026-03-29', '2026-03-28T22:00:00.000Z', '2026-03-29T21:00:00.000Z'],
    ['2026-10-25', '2026-10-24T21:00:00.000Z', '2026-10-25T22:00:00.000Z'],
  ])('includes the whole local day across DST: %s', (date, start, end) => {
    expect(historyQuery('u', { from: date, to: date }, 'Europe/Nicosia').where.transactionDate).toEqual({ gte: new Date(start), lt: new Date(end) });
  });
  it('combines merchant, category, currency and inclusive amounts', () => {
    const { where, skip } = historyQuery('u', { merchant: ' Lidl ', category: 'none', currency: 'EUR', min: '0', max: '20.50', offset: '30' }, 'Europe/Nicosia');
    expect(where.merchant).toEqual({ contains: 'Lidl', mode: 'insensitive' });
    expect(where.categoryId).toBeNull();expect(where.currency).toBe('EUR');expect(skip).toBe(30);
    expect(JSON.parse(JSON.stringify(where.amount))).toEqual({ gte: '0', lte: '20.5' });
  });
  it.each([{from:'2026-02-30'},{from:'2026-10-10',to:'2026-10-09'},{min:'20',max:'10'},{min:'-1'},{max:'Infinity'},{max:'2.001'},{offset:'-1'},{category:'other'},{currency:'eur'},{q:['a','b']}])('rejects invalid filters %j', query => {
    expect(() => historyQuery('u', query as any, 'Europe/Nicosia')).toThrow();
  });
});
