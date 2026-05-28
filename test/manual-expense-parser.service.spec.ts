import { ManualExpenseParserService } from '../src/parser/manual-expense-parser.service';

describe('ManualExpenseParserService', () => {
  const parser = new ManualExpenseParserService();

  it.each([
    ['12.50 lidl', { amount: 12.5, merchant: 'LIDL' }],
    ['lidl 12.50', { amount: 12.5, merchant: 'LIDL' }],
    ['coffee island 3,40', { amount: 3.4, merchant: 'COFFEE ISLAND' }],
  ])('parses manual expense: %s', (text, expected) => {
    expect(parser.parse(text)).toMatchObject({
      ...expected,
      currency: 'EUR',
      description: expected.merchant,
    });
  });

  it('uses provided default currency', () => {
    expect(parser.parse('8.90 wolt', 'USD')).toMatchObject({
      amount: 8.9,
      currency: 'USD',
      merchant: 'WOLT',
    });
  });

  it('returns undefined when no amount is present', () => {
    expect(parser.parse('lidl groceries')).toBeUndefined();
  });
});
