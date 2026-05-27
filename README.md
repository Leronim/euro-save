# Euro Save

Telegram bot for parsing Eurobank/Hellenic card SMS messages and confirming expenses.

## Run

```sh
TELEGRAM_BOT_TOKEN=123456:telegram-token npm start
```

Optional environment variables:

- `ALLOWED_TELEGRAM_USER_ID` limits bot access to one Telegram user id.
- `DATA_FILE` sets the JSON storage path. Default: `data/euro-save.json`.

## Supported SMS

```text
YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12
```

The bot parses card digits, merchant, amount, currency, status and transaction time. `authorised` messages create a pending expense. `declined` and `reversed` messages are stored as incoming bank messages but do not create expenses.

## Telegram flow

For an authorised SMS, the bot sends:

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

`✏️ Изменить` accepts corrections in this format:

```text
MERCHANT | 7.40 EUR | ☕ Кофе
```

## Test

```sh
npm test
```
