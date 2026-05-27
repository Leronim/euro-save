# Euro Save

Expense tracker backend for iPhone Shortcuts bank messages and Telegram confirmations.

Flow:

```text
iPhone Shortcuts -> POST /api/incoming/bank-message -> NestJS backend -> PostgreSQL -> Telegraf bot -> Expense
```

## Stack

- Node.js + TypeScript
- NestJS
- PostgreSQL
- Prisma
- Telegraf
- Docker Compose
- Zod + class-validator
- dayjs

## Run with Docker

```sh
cp .env.example .env
docker compose up --build
```

Required `.env` values:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OWNER_ID`
- `IOS_SHORTCUT_SECRET`

## Local development

```sh
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

## API

```http
POST /api/incoming/bank-message
Content-Type: application/json
```

```json
{
  "source": "ios_shortcuts",
  "secret": "123",
  "sender": "Eurobank",
  "text": "Purchase 12.40 EUR at LIDL",
  "receivedAt": "2026-05-27T21:30:00+03:00"
}
```

## Supported SMS examples

```text
YOUR CARD *4617 WAS AUTHORISED FOR CAFEME RED BUS, €7,40 AT 20:12
Purchase 12.40 EUR at LIDL
Your card was charged EUR 8.90 at WOLT
Refund 10.00 EUR from ZARA
```

The parser extracts amount, currency, merchant, transaction time, card digits and transaction type. `authorised` expense messages create pending expenses. `declined`, `reversed`, refund and income-like messages are stored but do not create expenses automatically.

## Telegram

Commands:

```text
/start
/help
/categories
/month
/stats
```

For a parsed expense, the bot sends:

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
12.40 LIDL продукты
```

## Test

```sh
npm test
```

## Hetzner deployment

Production deploy is handled by GitHub Actions in `.github/workflows/deploy.yml`.

One-time server setup on Ubuntu:

```sh
sudo bash scripts/install-hetzner.sh
```

Point DNS `A` record for `DOMAIN` to the Hetzner server IPv4 address, then add these GitHub repository secrets:

```text
HETZNER_HOST
HETZNER_USER
HETZNER_SSH_KEY
HETZNER_SSH_PORT
HETZNER_DEPLOY_PATH
DOMAIN
POSTGRES_PASSWORD
DATABASE_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_OWNER_ID
IOS_SHORTCUT_SECRET
DEFAULT_CURRENCY
DEFAULT_TIMEZONE
```

For the bundled Postgres service, use this production `DATABASE_URL` shape:

```text
postgresql://expense_user:POSTGRES_PASSWORD@postgres:5432/expense_tracker
```

After secrets are configured, every push to `main` builds, tests and deploys to Hetzner.
