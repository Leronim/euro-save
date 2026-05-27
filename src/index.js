'use strict';

const STATUS_BY_BANK_WORD = {
  AUTHORISED: 'authorised',
  DECLINED: 'declined',
  REVERSED: 'reversed',
};

const CURRENCY_BY_SYMBOL = {
  '€': 'EUR',
};

const CATEGORY_RULES = [
  { pattern: 'CAFEME', category: '☕ Кофе' },
  { pattern: 'CAFE', category: '☕ Кофе' },
  { pattern: 'COFFEE', category: '☕ Кофе' },
];

function parseBankMessage(text, receivedAt = new Date()) {
  const originalText = String(text);
  const status = detectStatus(originalText);
  const transactionTime = detectTransactionTime(originalText);

  const parsed = {
    type: status === 'authorised' ? 'expense' : 'unknown',
    status,
  };

  const cardLast4 = detectCardLast4(originalText);
  if (cardLast4) parsed.cardLast4 = cardLast4;

  const merchant = detectMerchant(originalText);
  if (merchant) parsed.merchant = merchant;

  const amount = detectAmountAndCurrency(originalText);
  if (amount) {
    parsed.amount = amount.amount;
    parsed.currency = amount.currency;
  }

  if (transactionTime) {
    parsed.transactionTime = transactionTime;
    parsed.transactionDate = combineReceivedDateWithTime(receivedAt, transactionTime);
  }

  return parsed;
}

function processIncomingBankMessage({ text, receivedAt = new Date() }) {
  const receivedDate = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  const parsed = parseBankMessage(text, receivedAt);
  const incomingBankMessage = {
    text: String(text),
    receivedAt: receivedDate,
    parsed,
  };

  if (parsed.status !== 'authorised') {
    return { incomingBankMessage, parsed };
  }

  const pendingExpense = {
    amount: parsed.amount,
    currency: parsed.currency,
    merchant: parsed.merchant,
    transactionDate: parsed.transactionDate,
    transactionTime: parsed.transactionTime,
    cardLast4: parsed.cardLast4,
    category: categorizeMerchant(parsed.merchant),
    status: 'pending',
    source: 'bank_sms',
  };

  return {
    incomingBankMessage,
    parsed,
    pendingExpense,
    telegramConfirmation: formatTelegramExpenseConfirmation(pendingExpense),
  };
}

function detectCardLast4(text) {
  const cardMatch = text.match(/\bCARD\s+\*{1,}(\d{4})\b/i);
  if (cardMatch) return cardMatch[1];

  const standaloneMatch = text.match(/(?:^|\s)\*(\d{4})\b/i);
  return standaloneMatch ? standaloneMatch[1] : undefined;
}

function detectStatus(text) {
  const match = text.match(/\bWAS\s+(AUTHORISED|DECLINED|REVERSED)\b/i);
  if (!match) return 'unknown';

  return STATUS_BY_BANK_WORD[match[1].toUpperCase()] || 'unknown';
}

function detectMerchant(text) {
  const match = text.match(/\bWAS\s+(?:AUTHORISED|DECLINED|REVERSED)\s+FOR\s+(.+?),\s*(?=(?:€|\d|EUR\b))/i);
  if (!match) return undefined;

  return match[1].replace(/\s+/g, ' ').trim();
}

function detectAmountAndCurrency(text) {
  const symbolBefore = text.match(/€\s*(\d+(?:[,.]\d{1,2})?)/i);
  if (symbolBefore) {
    return {
      amount: normalizeAmount(symbolBefore[1]),
      currency: CURRENCY_BY_SYMBOL['€'],
    };
  }

  const codeBefore = text.match(/\b(EUR)\s+(\d+(?:[,.]\d{1,2})?)\b/i);
  if (codeBefore) {
    return {
      amount: normalizeAmount(codeBefore[2]),
      currency: codeBefore[1].toUpperCase(),
    };
  }

  const codeAfter = text.match(/\b(\d+(?:[,.]\d{1,2})?)\s+(EUR)\b/i);
  if (codeAfter) {
    return {
      amount: normalizeAmount(codeAfter[1]),
      currency: codeAfter[2].toUpperCase(),
    };
  }

  return undefined;
}

function normalizeAmount(value) {
  return Number(value.replace(',', '.'));
}

function detectTransactionTime(text) {
  const match = text.match(/\bAT\s+([01]\d|2[0-3]):([0-5]\d)\b/i);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

function combineReceivedDateWithTime(receivedAt, transactionTime) {
  const dateParts = getReceivedDateParts(receivedAt);
  const iso = `${dateParts.date}T${transactionTime}:00${dateParts.offset}`;
  return new Date(iso);
}

function getReceivedDateParts(receivedAt) {
  if (typeof receivedAt === 'string') {
    const match = receivedAt.match(/^(\d{4}-\d{2}-\d{2})T.*?(Z|[+-]\d{2}:\d{2})$/);
    if (match) {
      return { date: match[1], offset: match[2] };
    }
  }

  const date = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  return {
    date: [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-'),
    offset: formatLocalOffset(date),
  };
}

function formatLocalOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function categorizeMerchant(merchant) {
  if (!merchant) return undefined;

  const normalized = merchant.toUpperCase();
  const rule = CATEGORY_RULES.find(({ pattern }) => normalized.includes(pattern));
  return rule ? rule.category : undefined;
}

function formatTelegramExpenseConfirmation(expense) {
  const lines = [
    '💸 Найден расход',
    '',
    expense.merchant,
    `${formatAmount(expense.amount)} ${expense.currency}`,
  ];

  if (expense.transactionTime) lines.push(`Время: ${expense.transactionTime}`);
  if (expense.cardLast4) lines.push(`Карта: *${expense.cardLast4}`);
  if (expense.category) lines.push(`Категория: ${expense.category}`);

  lines.push('', 'Записать?');
  return lines.filter((line) => line !== undefined && line !== 'undefined').join('\n');
}

function formatTelegramButtons() {
  return ['✅ Записать', '✏️ Изменить', '❌ Игнор'];
}

function formatAmount(amount) {
  return Number(amount).toFixed(2);
}

module.exports = {
  CATEGORY_RULES,
  categorizeMerchant,
  combineReceivedDateWithTime,
  detectAmountAndCurrency,
  detectCardLast4,
  detectMerchant,
  detectStatus,
  detectTransactionTime,
  formatTelegramButtons,
  formatTelegramExpenseConfirmation,
  parseBankMessage,
  processIncomingBankMessage,
};
