import { expenseConfirmationKeyboard } from '../src/telegram/telegram-keyboards';

describe('telegram keyboards', () => {
  it('builds pending expense confirmation keyboard', () => {
    expect(expenseConfirmationKeyboard('pending-1')).toEqual({
      inline_keyboard: [
        [
          { text: '✅ Записать', callback_data: 'expense:confirm:pending-1' },
          { text: '✏️ Изменить', callback_data: 'expense:edit:pending-1' },
          { text: '❌ Игнор', callback_data: 'expense:ignore:pending-1' },
        ],
      ],
    });
  });
});
