# Bank Message Parser Specification

## Eurobank / Hellenic SMS parser format

The parser must support this SMS format:

```text
YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12
```

Expected parsed result:

```json
{
  "cardLast4": "4617",
  "merchant": "CAFEME RED BUS",
  "amount": 7.40,
  "currency": "EUR",
  "transactionTime": "20:12",
  "type": "expense",
  "status": "authorised"
}
```

### Parsing rules

1. Detect card last digits from:
   - `CARD *4617`
   - `CARD ****4617`
   - `*4617`

2. Detect operation status:
   - `WAS AUTHORISED` -> `authorised`
   - `WAS DECLINED` -> `declined`
   - `WAS REVERSED` -> `reversed`

3. For MVP:
   - `authorised` should create a `PendingExpense`.
   - `declined` should be saved as `IncomingBankMessage` but must NOT create a `PendingExpense`.
   - `reversed` should be saved as `IncomingBankMessage` but must NOT create a `PendingExpense`.

4. Detect merchant from the text between:
   - `WAS AUTHORISED FOR`
   - and the comma before the amount

Example:

```text
WAS AUTHORISED FOR CAFEME RED BUS, €7,40
```

-> merchant = `CAFEME RED BUS`

5. Detect amount and currency from:
   - `€7,40`
   - `€7.40`
   - `7,40 EUR`
   - `7.40 EUR`
   - `EUR 7.40`

6. Decimal comma must be normalized:
   - `7,40` -> `7.40`

7. Detect transaction time from:
   - `AT 20:12`

8. If the SMS does not include a date, use `receivedAt` date and combine it with parsed transaction time.

Example:

```text
receivedAt = 2026-05-27T21:30:00+03:00
parsed time = 20:12
transactionDate = 2026-05-27T20:12:00+03:00
```

9. The parser should be case-insensitive.

10. Original text must always be stored in `IncomingBankMessage.text`.

## ParsedBankMessage type

`ParsedBankMessage` should include card digits, transaction time, and operation status:

```ts
type ParsedBankMessage = {
  amount?: number;
  currency?: string;
  merchant?: string;
  description?: string;
  transactionDate?: Date;
  transactionTime?: string;
  cardLast4?: string;
  type: 'expense' | 'income' | 'unknown';
  status?: 'authorised' | 'declined' | 'reversed' | 'unknown';
};
```

## Autocategory rules

Add coffee category rules for merchant matching:

```text
CAFEME -> ☕ Кофе
CAFE -> ☕ Кофе
COFFEE -> ☕ Кофе
```

## Telegram confirmation

For this SMS:

```text
YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12
```

Telegram confirmation should look like:

```text
💸 Найден расход

CAFEME RED BUS
7.40 EUR
Время: 20:12
Карта: *4617
Категория: ☕ Кофе

Записать?
```

Buttons:

```text
✅ Записать
✏️ Изменить
❌ Игнор
```
