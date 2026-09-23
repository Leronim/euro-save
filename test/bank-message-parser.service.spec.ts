import { BankMessageParserService } from '../src/parser/bank-message-parser.service';

describe('BankMessageParserService', () => {
  const parser = new BankMessageParserService();

  it('parses Eurobank/Hellenic authorised SMS', () => {
    const parsed = parser.parse(
      'YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12',
      '2026-05-27T21:30:00+03:00',
    );

    expect(parsed).toMatchObject({
      cardLast4: '4617',
      merchant: 'CAFEME RED BUS',
      amount: 7.4,
      currency: 'EUR',
      transactionTime: '20:12',
      type: 'expense',
      status: 'authorised',
    });
  });

  it.each([
    ['2026-09-23T09:43:00Z', '12:42', '2026-09-23T09:42:00.000Z'],
    ['2026-01-23T10:43:00Z', '12:42', '2026-01-23T10:42:00.000Z'],
    ['2026-09-22T21:10:00Z', '00:09', '2026-09-22T21:09:00.000Z'],
    ['2026-09-22T21:01:00Z', '23:59', '2026-09-22T20:59:00.000Z'],
  ])('converts Cyprus SMS time regardless of server timezone: %s', (received, time, expected) => {
    const parsed=parser.parse(`YOUR CARD *4617 WAS AUTHORISED FOR SHOP, €7.40 AT ${time}`,received);
    expect(parsed.transactionDate?.toISOString()).toBe(expected);
    expect(parsed.transactionDate!.getTime()).toBeLessThanOrEqual(new Date(received).getTime());
  });

  it.each([
    ['Purchase 12.40 EUR at LIDL', { amount: 12.4, currency: 'EUR', merchant: 'LIDL', type: 'expense' }],
    ['Your card was charged EUR 8.90 at WOLT', { amount: 8.9, currency: 'EUR', merchant: 'WOLT', type: 'expense' }],
    ['Refund 10.00 EUR from ZARA', { amount: 10, currency: 'EUR', merchant: 'ZARA', type: 'income' }],
  ])('parses generic message: %s', (text, expected) => {
    expect(parser.parse(text)).toMatchObject(expected);
  });
});
