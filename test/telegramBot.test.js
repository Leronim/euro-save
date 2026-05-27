'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createEmptyStore } = require('../src/storage');
const { CALLBACKS, createTelegramBot } = require('../src/telegramBot');

function createMemoryStore() {
  let data = createEmptyStore();

  return {
    read() {
      return JSON.parse(JSON.stringify(data));
    },
    write(next) {
      data = JSON.parse(JSON.stringify(next));
    },
    update(updater) {
      data = updater(this.read());
      return data;
    },
  };
}

function createFetchRecorder() {
  const calls = [];

  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, payload: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({ ok: true, result: [] }),
      };
    },
  };
}

test('Telegram bot sends expense confirmation with inline buttons', async () => {
  const store = createMemoryStore();
  const recorder = createFetchRecorder();
  const bot = createTelegramBot({
    token: 'token',
    store,
    fetchImpl: recorder.fetchImpl,
    now: () => new Date('2026-05-27T21:30:00+03:00'),
  });

  await bot.handleMessage({
    message_id: 101,
    chat: { id: 10 },
    from: { id: 20 },
    text: 'YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12',
  });

  const sendMessage = recorder.calls.find((call) => call.url.endsWith('/sendMessage'));
  assert.equal(sendMessage.payload.chat_id, 10);
  assert.equal(
    sendMessage.payload.text,
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
  assert.deepEqual(sendMessage.payload.reply_markup.inline_keyboard[0], [
    { text: '✅ Записать', callback_data: CALLBACKS.SAVE },
    { text: '✏️ Изменить', callback_data: CALLBACKS.EDIT },
    { text: '❌ Игнор', callback_data: CALLBACKS.IGNORE },
  ]);

  const data = store.read();
  assert.equal(data.incomingBankMessages.length, 1);
  assert.equal(data.pendingExpenses.length, 1);
  assert.equal(data.incomingBankMessages[0].text, 'YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12');
});

test('Telegram bot saves confirmed expense', async () => {
  const store = createMemoryStore();
  const recorder = createFetchRecorder();
  const bot = createTelegramBot({
    token: 'token',
    store,
    fetchImpl: recorder.fetchImpl,
    now: () => new Date('2026-05-27T21:30:00+03:00'),
  });

  await bot.handleMessage({
    message_id: 101,
    chat: { id: 10 },
    from: { id: 20 },
    text: 'YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12',
  });
  await bot.handleCallbackQuery({
    id: 'callback-1',
    data: CALLBACKS.SAVE,
    from: { id: 20 },
    message: { chat: { id: 10 } },
  });

  const data = store.read();
  assert.equal(data.pendingExpenses.length, 0);
  assert.equal(data.savedExpenses.length, 1);
  assert.equal(data.savedExpenses[0].status, 'saved');
  assert.equal(data.ignoredExpenses.length, 0);
});

test('Telegram bot edits pending expense before save', async () => {
  const store = createMemoryStore();
  const recorder = createFetchRecorder();
  const bot = createTelegramBot({
    token: 'token',
    store,
    fetchImpl: recorder.fetchImpl,
    now: () => new Date('2026-05-27T21:30:00+03:00'),
  });

  await bot.handleMessage({
    message_id: 101,
    chat: { id: 10 },
    from: { id: 20 },
    text: 'YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12',
  });
  await bot.handleCallbackQuery({
    id: 'callback-edit',
    data: CALLBACKS.EDIT,
    from: { id: 20 },
    message: { chat: { id: 10 } },
  });
  await bot.handleMessage({
    message_id: 103,
    chat: { id: 10 },
    from: { id: 20 },
    text: 'COFFEE ISLAND | 8.50 EUR | ☕ Кофе',
  });

  const data = store.read();
  assert.equal(data.pendingExpenses.length, 1);
  assert.equal(data.pendingExpenses[0].merchant, 'COFFEE ISLAND');
  assert.equal(data.pendingExpenses[0].amount, 8.5);
  assert.equal(data.pendingExpenses[0].currency, 'EUR');
  assert.equal(data.pendingExpenses[0].category, '☕ Кофе');

  const lastSendMessage = recorder.calls.filter((call) => call.url.endsWith('/sendMessage')).at(-1);
  assert.equal(lastSendMessage.payload.text.includes('COFFEE ISLAND'), true);
  assert.equal(lastSendMessage.payload.text.includes('8.50 EUR'), true);
});

test('Telegram bot stores declined message without pending expense', async () => {
  const store = createMemoryStore();
  const recorder = createFetchRecorder();
  const bot = createTelegramBot({
    token: 'token',
    store,
    fetchImpl: recorder.fetchImpl,
    now: () => new Date('2026-05-27T21:30:00+03:00'),
  });

  await bot.handleMessage({
    message_id: 102,
    chat: { id: 10 },
    from: { id: 20 },
    text: 'YOUR CARD *4617 WAS DECLINED FOR CAFEME RED BUS, €7,40 AT 20:12',
  });

  const data = store.read();
  assert.equal(data.incomingBankMessages.length, 1);
  assert.equal(data.pendingExpenses.length, 0);

  const sendMessage = recorder.calls.find((call) => call.url.endsWith('/sendMessage'));
  assert.equal(sendMessage.payload.text, 'Сообщение сохранено. Расход не создан: declined.');
});
