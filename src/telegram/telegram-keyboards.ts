export function expenseConfirmationKeyboard(pendingExpenseId: string) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Записать', callback_data: `expense:confirm:${pendingExpenseId}` },
        { text: '✏️ Изменить', callback_data: `expense:edit:${pendingExpenseId}` },
        { text: '❌ Игнор', callback_data: `expense:ignore:${pendingExpenseId}` },
      ],
    ],
  };
}
