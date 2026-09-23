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

## Hetzner pull-based deploy

The current server uses a pull-based deploy timer, so it does not require GitHub secrets. The server polls `origin/main` every minute and redeploys only when the commit changes.

Installed unit files:

```text
/etc/systemd/system/euro-save-deploy.service
/etc/systemd/system/euro-save-deploy.timer
```

The service runs:

```text
/opt/euro-save/scripts/euro-save-deploy.sh
```

Useful server commands:

```sh
systemctl status euro-save-deploy.timer
journalctl -u euro-save-deploy.service -n 100 --no-pager
cd /opt/euro-save && docker compose -f docker-compose.prod.yml ps
```

## Interactive week and month reports

`/week`, `/month` and the main menu open an inline report. Previous/next period,
overview, categories, daily totals and paginated operations update the same message.
Category buttons open that category's operations; existing edit/category/delete
buttons remain available on operation pages. Historical reports have a return-to-current button.

Ranges use `DEFAULT_TIMEZONE` (Nicosia by default), Monday-based weeks and exclusive
end boundaries. Only confirmed Expense records are counted. Currency totals and
comparisons remain separate. An ongoing period is compared through the same local
time in the previous period, capped at the end of shorter months. Monthly forecasts
use the average per elapsed calendar day and appear from day three onward.

Validation: `npm run build` and `TZ=UTC npm test`.

## Telegram Mini App

Open `/app` or the Telegram menu button **Мои расходы**. `/start`, `/menu` and
`/cancel` clear editing state, remove the old reply keyboard and show the app button.
Text reports remain available, with a close button on newly opened reports.

The application is served at `/mini-app` by NestJS through Caddy. It has overview,
category and operation tabs, weekly/monthly navigation, currency-specific charts,
search within the selected period, and forms for creating/editing confirmed expenses.
The browser uses the device timezone for date entry; report boundaries use the configured
Nicosia timezone. No extra frontend build is required. Database migrations run automatically at startup.

Set `MINI_APP_URL` to the public HTTPS URL if moving to another host. Docker includes
`public/mini-app`; the deploy script recreates Caddy to load updated routes.

Every `/api/mini-app` request requires `X-Telegram-Init-Data`: server-side HMAC
validation, maximum age 24 hours and the configured `TELEGRAM_OWNER_ID` are checked.
No credentials or expenses are saved to browser storage. Opening the URL in a normal
browser displays an instruction to open it from Telegram, without exposing expenses.

### Merchant categories

Editing a purchase defaults to applying its category to all matching purchases and
open pending drafts for the current user, and saving a rule for future imports.
Uncheck the merchant-wide checkbox to edit only one purchase. Telegram category
buttons use the same merchant-wide behavior. Changes and the rule are transactional.
Learned rules use MerchantRule.merchantName and take priority over default substring
rules; seeding defaults no longer resets category choices. Names are normalized for
case, punctuation and whitespace; ZORBAS branches share one chain key. Other names
require a full normalized match, to avoid merging unrelated stores.

## Budget, pending purchases and undo

The monthly overview has a per-month, per-currency budget (0 removes it), remaining
balance and a daily allowance through month end. Pending purchases are shown separately
from confirmed totals and can be confirmed with a category or ignored in the Mini App.
Chat and Mini App share an atomic pending-status transition, preventing duplicate saves.

Mini App writes persist an undo record for 10 minutes. Undo restores all affected
purchases, drafts, merchant rules and budgets in one serializable transaction, but
refuses to overwrite records that were changed afterwards. Undo remains available
after closing the app. Records that have expired are cleaned up on the next write.
The new MonthlyBudget and UndoAction tables are created by the additive migration
`20260922090000_budgets_and_undo`.

Categories now expose saved merchant rules; bulk changes show the affected purchase
count first. Day chart bars open that day's purchases. Operations are grouped by date,
with daily totals; bank descriptions remain visible inside the edit form.

### Weekly Telegram digest (VPS)

`euro-save-weekly.timer` runs Sundays at 20:00 Europe/Nicosia (DST-aware),
using the salary plan's saved `savingsTarget` for each currency. The default
for an existing plan is 1000; change it in the Mini App's savings calculator.

Install the units from `scripts/systemd/` into `/etc/systemd/system/`, run
`systemctl daemon-reload`, then `systemctl enable --now euro-save-weekly.timer`.
Disable with `systemctl disable --now euro-save-weekly.timer`. Change the
schedule with a systemd timer override. The timer sends only on its scheduled
activation; it does not send a catch-up report after downtime.

The host wrapper uses the deployment lock and stores weekly delivery markers
in `/var/lib/euro-save-weekly/`. Check with
`systemctl list-timers euro-save-weekly.timer` and
`journalctl -u euro-save-weekly.service`.
Validate report generation without sending a Telegram message:

```sh
docker compose -f docker-compose.prod.yml exec -T app node - --dry-run < scripts/send-weekly-report.cjs
```
