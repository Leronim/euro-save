'use strict';

const path = require('node:path');
const {
  categorizeMerchant,
  detectAmountAndCurrency,
  formatTelegramButtons,
  formatTelegramExpenseConfirmation,
  processIncomingBankMessage,
} = require('./index');
const { createJsonStore } = require('./storage');

const CALLBACKS = {
  SAVE: 'expense:save',
  EDIT: 'expense:edit',
  IGNORE: 'expense:ignore',
};

function createTelegramBot({
  token,
  store = createJsonStore(process.env.DATA_FILE || path.join(process.cwd(), 'data', 'euro-save.json')),
  allowedUserId = process.env.ALLOWED_TELEGRAM_USER_ID,
  now = () => new Date(),
  apiBaseUrl = 'https://api.telegram.org',
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required. Use Node.js 20+ or pass fetchImpl.');
  }

  const pendingByChat = new Map();
  const editByChat = new Map();

  async function handleUpdate(update) {
    if (update.message) {
      return handleMessage(update.message);
    }

    if (update.callback_query) {
      return handleCallbackQuery(update.callback_query);
    }

    return undefined;
  }

  async function handleMessage(message) {
    const chatId = message.chat.id;
    if (!isAllowed(message.from)) {
      return sendMessage(chatId, 'Доступ запрещен.');
    }

    const text = message.text || '';
    if (text === '/start') {
      return sendMessage(
        chatId,
        'Отправь банковское SMS от Eurobank/Hellenic, я найду расход и предложу записать его.',
      );
    }

    if (text === '/help') {
      return sendMessage(chatId, 'Поддерживается формат: YOUR CARD *4617 WAS AUTHORISED FOR MERCHANT, €7,40 AT 20:12');
    }

    if (!text.trim()) {
      return sendMessage(chatId, 'Пришли текст банковского SMS.');
    }

    if (editByChat.has(String(chatId))) {
      return handleEditMessage(message);
    }

    const result = processIncomingBankMessage({ text, receivedAt: now() });
    const messageId = saveIncomingResult(result, message);

    if (!result.pendingExpense) {
      const status = result.parsed.status || 'unknown';
      return sendMessage(chatId, `Сообщение сохранено. Расход не создан: ${status}.`);
    }

    pendingByChat.set(String(chatId), {
      messageId,
      pendingExpense: result.pendingExpense,
    });

    return sendMessage(chatId, result.telegramConfirmation, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Записать', callback_data: CALLBACKS.SAVE },
            { text: '✏️ Изменить', callback_data: CALLBACKS.EDIT },
            { text: '❌ Игнор', callback_data: CALLBACKS.IGNORE },
          ],
        ],
      },
    });
  }

  async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    if (!isAllowed(query.from)) {
      await answerCallbackQuery(query.id, 'Доступ запрещен.');
      return undefined;
    }

    const pending = pendingByChat.get(String(chatId)) || findLatestPendingExpense(chatId);
    if (!pending) {
      await answerCallbackQuery(query.id, 'Нет расхода для обработки.');
      return sendMessage(chatId, 'Нет расхода для обработки.');
    }

    if (query.data === CALLBACKS.SAVE) {
      confirmPendingExpense(pending.messageId, 'saved');
      pendingByChat.delete(String(chatId));
      editByChat.delete(String(chatId));
      await answerCallbackQuery(query.id, 'Записано');
      return sendMessage(chatId, '✅ Расход записан.');
    }

    if (query.data === CALLBACKS.IGNORE) {
      confirmPendingExpense(pending.messageId, 'ignored');
      pendingByChat.delete(String(chatId));
      editByChat.delete(String(chatId));
      await answerCallbackQuery(query.id, 'Игнорировано');
      return sendMessage(chatId, '❌ Расход проигнорирован.');
    }

    if (query.data === CALLBACKS.EDIT) {
      editByChat.set(String(chatId), pending.messageId);
      await answerCallbackQuery(query.id, 'Редактирование');
      return sendMessage(
        chatId,
        [
          '✏️ Пришли исправление в формате:',
          '',
          'MERCHANT | 7.40 EUR | ☕ Кофе',
          '',
          formatTelegramExpenseConfirmation(pending.pendingExpense),
        ].join('\n'),
      );
    }

    await answerCallbackQuery(query.id, 'Неизвестное действие.');
    return undefined;
  }

  async function handleEditMessage(message) {
    const chatId = message.chat.id;
    const messageId = editByChat.get(String(chatId));
    const pending = pendingByChat.get(String(chatId)) || findLatestPendingExpense(chatId);

    if (!messageId || !pending) {
      editByChat.delete(String(chatId));
      return sendMessage(chatId, 'Нет расхода для редактирования.');
    }

    const editedExpense = applyExpenseEdit(pending.pendingExpense, message.text);
    updatePendingExpense(messageId, editedExpense);
    pendingByChat.set(String(chatId), {
      messageId,
      pendingExpense: editedExpense,
    });
    editByChat.delete(String(chatId));

    return sendMessage(chatId, formatTelegramExpenseConfirmation(editedExpense), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Записать', callback_data: CALLBACKS.SAVE },
            { text: '✏️ Изменить', callback_data: CALLBACKS.EDIT },
            { text: '❌ Игнор', callback_data: CALLBACKS.IGNORE },
          ],
        ],
      },
    });
  }

  function saveIncomingResult(result, telegramMessage) {
    const id = createId();
    store.update((data) => {
      const incomingBankMessage = serializeDates({
        id,
        telegramChatId: telegramMessage.chat.id,
        telegramMessageId: telegramMessage.message_id,
        ...result.incomingBankMessage,
      });

      data.incomingBankMessages.push(incomingBankMessage);

      if (result.pendingExpense) {
        data.pendingExpenses.push(serializeDates({
          id,
          telegramChatId: telegramMessage.chat.id,
          ...result.pendingExpense,
        }));
      }

      return data;
    });

    return id;
  }

  function confirmPendingExpense(messageId, action) {
    store.update((data) => {
      const index = data.pendingExpenses.findIndex((expense) => expense.id === messageId);
      if (index === -1) return data;

      const [expense] = data.pendingExpenses.splice(index, 1);
      const target = action === 'saved' ? data.savedExpenses : data.ignoredExpenses;
      target.push({
        ...expense,
        status: action,
        confirmedAt: now().toISOString(),
      });

      return data;
    });
  }

  function updatePendingExpense(messageId, pendingExpense) {
    store.update((data) => {
      const index = data.pendingExpenses.findIndex((expense) => expense.id === messageId);
      if (index === -1) return data;

      data.pendingExpenses[index] = serializeDates({
        ...data.pendingExpenses[index],
        ...pendingExpense,
        updatedAt: now().toISOString(),
      });

      return data;
    });
  }

  function findLatestPendingExpense(chatId) {
    const data = store.read();
    const pendingExpense = [...data.pendingExpenses]
      .reverse()
      .find((expense) => String(expense.telegramChatId) === String(chatId));

    if (!pendingExpense) return undefined;

    return {
      messageId: pendingExpense.id,
      pendingExpense,
    };
  }

  function isAllowed(from) {
    if (!allowedUserId) return true;
    return from && String(from.id) === String(allowedUserId);
  }

  async function request(method, payload) {
    const response = await fetchImpl(`${apiBaseUrl}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) {
      throw new Error(`Telegram ${method} failed: ${JSON.stringify(body)}`);
    }
    return body.result;
  }

  function sendMessage(chatId, text, extra = {}) {
    return request('sendMessage', {
      chat_id: chatId,
      text,
      ...extra,
    });
  }

  function answerCallbackQuery(callbackQueryId, text) {
    return request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async function startPolling({ pollTimeout = 30 } = {}) {
    let offset = 0;
    logger.log('Euro Save Telegram bot started');

    for (;;) {
      try {
        const updates = await request('getUpdates', {
          offset,
          timeout: pollTimeout,
          allowed_updates: ['message', 'callback_query'],
        });

        for (const update of updates) {
          offset = update.update_id + 1;
          await handleUpdate(update);
        }
      } catch (error) {
        logger.error(error);
        await delay(1000);
      }
    }
  }

  return {
    CALLBACKS,
    answerCallbackQuery,
    handleCallbackQuery,
    handleEditMessage,
    handleMessage,
    handleUpdate,
    request,
    sendMessage,
    startPolling,
  };
}

function applyExpenseEdit(expense, editText) {
  const [merchantPart, amountPart, categoryPart] = String(editText)
    .split('|')
    .map((part) => part.trim());
  const next = { ...expense };

  if (merchantPart) {
    next.merchant = merchantPart;
  }

  if (amountPart) {
    const parsedAmount = detectAmountAndCurrency(amountPart);
    if (parsedAmount) {
      next.amount = parsedAmount.amount;
      next.currency = parsedAmount.currency;
    }
  }

  if (categoryPart) {
    next.category = categoryPart;
  } else if (merchantPart) {
    next.category = categorizeMerchant(merchantPart);
  }

  return next;
}

function serializeDates(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (require.main === module) {
  const bot = createTelegramBot({ token: process.env.TELEGRAM_BOT_TOKEN });
  bot.startPolling();
}

module.exports = {
  CALLBACKS,
  applyExpenseEdit,
  createTelegramBot,
};
