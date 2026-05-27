'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  categorizeMerchant,
  detectAmountAndCurrency,
  detectCardLast4,
  formatTelegramButtons,
  parseBankMessage,
  processIncomingBankMessage,
} = require('../src');

test('parses Eurobank/Hellenic authorised SMS', () => {
  const parsed = parseBankMessage(
    'YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12',
    '2026-05-27T21:30:00+03:00',
  );

  assert.equal(parsed.cardLast4, '4617');
  assert.equal(parsed.merchant, 'CAFEME RED BUS');
  assert.equal(parsed.amount, 7.4);
  assert.equal(parsed.currency, 'EUR');
  assert.equal(parsed.transactionTime, '20:12');
  assert.equal(parsed.transactionDate.toISOString(), '2026-05-27T17:12:00.000Z');
  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.status, 'authorised');
});

test('supports card and amount variants case-insensitively', () => {
  assert.equal(detectCardLast4('your CARD ****4617 was authorised'), '4617');
  assert.equal(detectCardLast4('payment on *4617'), '4617');
  assert.deepEqual(detectAmountAndCurrency('WAS AUTHORISED FOR SHOP, €7.40 AT 20:12'), {
    amount: 7.4,
    currency: 'EUR',
  });
  assert.deepEqual(detectAmountAndCurrency('WAS AUTHORISED FOR SHOP, 7,40 EUR AT 20:12'), {
    amount: 7.4,
    currency: 'EUR',
  });
  assert.deepEqual(detectAmountAndCurrency('WAS AUTHORISED FOR SHOP, EUR 7.40 AT 20:12'), {
    amount: 7.4,
    currency: 'EUR',
  });
});

test('declined and reversed messages do not create pending expenses', () => {
  const declined = processIncomingBankMessage({
    text: 'YOUR CARD *4617 WAS DECLINED FOR CAFEME RED BUS, €7,40 AT 20:12',
    receivedAt: '2026-05-27T21:30:00+03:00',
  });
  const reversed = processIncomingBankMessage({
    text: 'YOUR CARD *4617 WAS REVERSED FOR CAFEME RED BUS, €7,40 AT 20:12',
    receivedAt: '2026-05-27T21:30:00+03:00',
  });

  assert.equal(declined.incomingBankMessage.text, 'YOUR CARD *4617 WAS DECLINED FOR CAFEME RED BUS, €7,40 AT 20:12');
  assert.equal(declined.parsed.status, 'declined');
  assert.equal(declined.pendingExpense, undefined);
  assert.equal(reversed.parsed.status, 'reversed');
  assert.equal(reversed.pendingExpense, undefined);
});

test('creates pending expense and Telegram confirmation for authorised messages', () => {
  const result = processIncomingBankMessage({
    text: 'YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12',
    receivedAt: '2026-05-27T21:30:00+03:00',
  });

  assert.equal(result.incomingBankMessage.text, 'YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12');
  assert.equal(result.pendingExpense.category, '☕ Кофе');
  assert.equal(
    result.telegramConfirmation,
    [
      '💸 Найден расход',
      '',
      'CAFEME RED BUS',
      '7.40 EUR',
      'Время: 20:12',
      'Карта: *4617',
      'Категория: ☕ Кофе',
      '',
      'Записать?',
    ].join('\n'),
  );
  assert.deepEqual(formatTelegramButtons(), ['✅ Записать', '✏️ Изменить', '❌ Игнор']);
});

test('categorizes coffee merchants', () => {
  assert.equal(categorizeMerchant('CAFEME RED BUS'), '☕ Кофе');
  assert.equal(categorizeMerchant('Some Cafe'), '☕ Кофе');
  assert.equal(categorizeMerchant('Coffee Island'), '☕ Кофе');
});
