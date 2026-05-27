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
    ['Purchase 12.40 EUR at LIDL', { amount: 12.4, currency: 'EUR', merchant: 'LIDL', type: 'expense' }],
    ['Your card was charged EUR 8.90 at WOLT', { amount: 8.9, currency: 'EUR', merchant: 'WOLT', type: 'expense' }],
    ['Refund 10.00 EUR from ZARA', { amount: 10, currency: 'EUR', merchant: 'ZARA', type: 'income' }],
  ])('parses generic message: %s', (text, expected) => {
    expect(parser.parse(text)).toMatchObject(expected);
  });
});
