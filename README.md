# telegram-shop-bot

[![CI](https://github.com/saizul/telegram-shop-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/saizul/telegram-shop-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

A Telegram bot for small online shops in Bangladesh. Customers browse your catalogue, fill a
cart, and check out with **cash on delivery** or a **bKash Send Money** reference, in **Bangla
or English**. Orders land in your admin group with **Confirm / Ship / Delivered / Cancel**
buttons, and can be exported to **Google Sheets** and sent to **n8n** for automations.

No payment gateway, no database server and no npm runtime dependencies: just Node.js and a bot
token.

## Features

- **Catalogue from Google Sheets or a JSON file**: categories, product cards with photo, sale
  price and stock, cached with a configurable refresh interval. Sheets access uses a service
  account (JWT) and the Sheets `values` API directly.
- **Inline keyboard shopping**: categories, paginated product lists, product cards with
  add/remove buttons, a cart with +/-/remove/clear.
- **Product search**: `/search jamdani`, or simply send a product name. Matches every word
  against names, descriptions, ids and category names in English and Bangla (Bangla digits
  included), ranks name matches first and shows up to 10 results as buttons.
- **Cart and sessions stored in SQLite** (`node:sqlite`, built into Node 22.13+) or a JSON file.
- **Checkout built for Bangladesh**: name, mobile number with BD normalisation (`+880`, `880`,
  `01...`, Bangla digits, operator detection) or one-tap contact sharing, division and district
  picker for all 64 districts (or type the name, English or Bangla, old spellings accepted),
  delivery address, and delivery fee inside or outside Dhaka (configurable districts and free
  delivery threshold).
- **Payment**: cash on delivery, or bKash "Send Money" with a validated TrxID reference field.
  There is no payment API: you check the TrxID in your bKash app before confirming.
- **Saved details**: returning customers can reuse their last name, phone and address.
- **Order confirmation** to the customer and a **notification in the admin group** with action
  buttons. Every status change edits the admin message and notifies the customer in their
  language.
- **Order export**: append each order (and optionally each status change) to a Google Sheet,
  and POST signed JSON events to an **n8n** webhook (HMAC-SHA256, retries with backoff).
- **Bangla and English** UI with a language switch; prices use Bangla digits in Bangla.
- **Anti-spam**: per-user token bucket, repeated-message and flood detection with temporary
  mutes, message length limit, per-user serial processing so double taps cannot race.
- **Long polling or webhook mode**. Webhook mode verifies the
  `X-Telegram-Bot-Api-Secret-Token` header in constant time and answers Telegram immediately.
- **Testable by design**: the bot only talks to an injectable `TelegramApi` interface. The test
  suite drives full conversations with simulated updates and no network.
- **Docker image and docker-compose** example (optionally with n8n).

## How it looks

```text
Customer                                   Admin group
--------                                   -----------
/start  -> [Shop] [Cart (0)]
Shop    -> [Sarees] [Tea & Spices]
Sarees  -> Dhakai Jamdani · ৳5,900
           (photo, price, stock)
           [Add to cart]
Cart    -> 1 × Dhakai Jamdani: ৳5,900
           [Checkout]
Name, phone, division -> district,
address, [Cash on delivery] [bKash]
Summary -> [Confirm order]              ->  Order ORD-261115-7KQ2: PENDING
"Thank you! Your order ... placed"           [Confirm] [Cancel]
"Your order ... has been confirmed"     <-   (admin taps Confirm)
```

## Install

You need Node.js 22.13 or newer for the default SQLite storage (Node 20 works with
`STORAGE=json`), and a bot token from [@BotFather](https://t.me/BotFather).

```bash
git clone https://github.com/saizul/telegram-shop-bot.git
cd telegram-shop-bot
npm install
npm run build
cp .env.example .env            # then edit .env
mkdir -p data && cp examples/catalog.json data/catalog.json
node --env-file=.env dist/src/main.js
```

### Install from GitHub Packages

The package is also published to GitHub Packages as `@saizul/telegram-shop-bot`, which is
handy for embedding the bot (see [Embedding](#embedding)). Point the `@saizul` scope at the
GitHub registry in your project's `.npmrc`:

```ini
@saizul:registry=https://npm.pkg.github.com
```

GitHub Packages needs authentication even for public packages. Create a personal access token
(classic) with the `read:packages` scope, expose it as an environment variable, and reference it
from your user-level `~/.npmrc`:

```ini
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

```bash
npm install @saizul/telegram-shop-bot
```

## Usage

### 1. Create the bot and the admin group

1. Create a bot with @BotFather and put the token in `TELEGRAM_BOT_TOKEN`.
2. Create a Telegram group for your team and add the bot.
3. Start the bot once and send `/chatid` in the group. Put the number it replies with
   (negative, for example `-1001234567890`) in `ADMIN_CHAT_ID`.
4. Optional: restrict the order buttons to specific people with `ADMIN_USER_IDS`.

### 2. Add products

**JSON file** (`CATALOG_SOURCE=json`, default): see [`examples/catalog.json`](examples/catalog.json).

```json
{
  "categories": [{ "id": "saree", "name_en": "Sarees", "name_bn": "শাড়ি", "sort": 1 }],
  "products": [
    {
      "id": "jamdani-red",
      "category": "saree",
      "name_en": "Dhakai Jamdani (red)",
      "name_bn": "ঢাকাই জামদানি (লাল)",
      "description_en": "Handwoven half-silk jamdani.",
      "description_bn": "হাতে বোনা হাফ সিল্ক জামদানি।",
      "price": 6500,
      "sale_price": 5900,
      "photo": "https://images.example.com/jamdani-red.jpg",
      "stock": 4
    }
  ]
}
```

**Google Sheets** (`CATALOG_SOURCE=sheets`): create a spreadsheet with a `Products` tab and an
optional `Categories` tab. Import the templates in
[`examples/google-sheets/`](examples/google-sheets) to get the headers.

| Column | Required | Notes |
|--------|----------|-------|
| `id` | yes | 1-32 characters: `A-Z a-z 0-9 _ -` (used in button data) |
| `category` | yes | category id; unknown ids get a category automatically |
| `name_en`, `name_bn` | one of them | the other language falls back to it |
| `description_en`, `description_bn` | no | trimmed to fit the 1024-character caption limit |
| `price` | yes | `1850`, `1,850`, `৳১,৮৫০` and `Tk 1850` all work |
| `sale_price` | no | shown struck through next to the regular price |
| `photo` | no | HTTPS URL or a Telegram `file_id` |
| `stock` | no | empty means unlimited; `0` shows "out of stock" |
| `active` | no | `FALSE`/`no` hides the product |
| `sort` | no | lower first; defaults to row order |

Then share the spreadsheet with your service account:

1. In Google Cloud, create a project, enable the **Google Sheets API**, create a **service
   account** and download a JSON key.
2. Share the spreadsheet with the service account's e-mail address (Viewer is enough for the
   catalogue, Editor if you also export orders).
3. Set `GOOGLE_SHEETS_ID` (the long id in the sheet URL) and `GOOGLE_SERVICE_ACCOUNT_FILE`
   (path to the key) or `GOOGLE_SERVICE_ACCOUNT_JSON`.

The catalogue is cached for `CATALOG_TTL_SECONDS` (default 300) and reloaded right before an
order is placed, so prices and stock are checked at the moment of ordering. If Google is
unreachable, the last good copy keeps being served.

### 3. Run

**Long polling** (`BOT_MODE=polling`, default) needs no public URL: ideal for a VPS, a home
server or development.

**Webhook mode** (`BOT_MODE=webhook`) needs an HTTPS URL that reaches the bot:

```ini
BOT_MODE=webhook
WEBHOOK_URL=https://shop.example.com
WEBHOOK_PATH=/telegram/webhook
WEBHOOK_SECRET=<openssl rand -hex 32>
PORT=8080
```

On start the bot calls `setWebhook` with `secret_token`, `allowed_updates` and your URL.
Telegram then sends the secret in the `X-Telegram-Bot-Api-Secret-Token` header of every
request; requests without the right value get `401`. Put Caddy or Nginx in front for TLS
(Telegram accepts ports 443, 80, 88 and 8443). `GET /healthz` returns `ok` for monitoring.

### 4. Docker

```bash
cp .env.example .env               # fill in TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, ...
mkdir -p data && cp examples/catalog.json data/catalog.json
docker compose up -d               # BOT_MODE from .env
docker compose --profile n8n up -d # also start n8n on 127.0.0.1:5678
```

The image is `node:24-alpine`, runs as the unprivileged `node` user, and keeps the SQLite
database in the `shop-data` volume.

## Configuration

All settings are environment variables; [`.env.example`](.env.example) lists every one.

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | required | from @BotFather |
| `ADMIN_CHAT_ID` | required | admin group id (send `/chatid` in the group) |
| `ADMIN_USER_IDS` | empty | comma-separated user ids allowed to press order buttons |
| `BOT_MODE` | `polling` | `polling` or `webhook` |
| `WEBHOOK_URL`, `WEBHOOK_PATH`, `WEBHOOK_SECRET` | | webhook mode; secret is 16-256 chars of `A-Z a-z 0-9 _ -` |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | webhook server |
| `SHOP_NAME` | `Our Shop` | shown in the welcome message |
| `DEFAULT_LANG` | `bn` | `bn` or `en`; users with a Bangla Telegram client start in Bangla |
| `BKASH_NUMBER` | empty | number customers send money to; empty hides the bKash option |
| `DELIVERY_FEE_INSIDE_DHAKA` | `70` | Taka |
| `DELIVERY_FEE_OUTSIDE_DHAKA` | `130` | Taka |
| `INSIDE_DHAKA_DISTRICTS` | `dhaka` | district ids charged the inside fee, e.g. `dhaka,gazipur,narayanganj` |
| `FREE_DELIVERY_MIN` | empty | free delivery from this subtotal |
| `CATALOG_SOURCE` | `json` | `json` or `sheets` |
| `CATALOG_FILE` | `./data/catalog.json` | JSON catalogue path |
| `CATALOG_TTL_SECONDS` | `300` | catalogue cache lifetime |
| `GOOGLE_SHEETS_ID` | | spreadsheet id |
| `SHEETS_PRODUCTS_RANGE` | `Products!A1:L` | |
| `SHEETS_CATEGORIES_RANGE` | `Categories!A1:D` | `none` if you have no Categories tab |
| `GOOGLE_SERVICE_ACCOUNT_FILE` / `_JSON` | | service account key (file path or inline JSON) |
| `SHEETS_EXPORT_ORDERS` | `false` | append orders to a sheet |
| `SHEETS_ORDERS_ID`, `SHEETS_ORDERS_RANGE` | sheet id, `Orders!A1` | where orders go |
| `SHEETS_LOG_STATUS_CHANGES` | `true` | also append a row per status change |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | | order events endpoint and HMAC secret |
| `STORAGE` | `sqlite` | `sqlite` or `json` |
| `DATA_DIR`, `STORAGE_PATH` | `./data` | database location |
| `RATE_LIMIT_BURST`, `RATE_LIMIT_PER_SECOND` | `8`, `1` | token bucket per user |
| `SPAM_MUTE_MINUTES` | `10` | mute length after flooding or repeated messages |
| `LOG_LEVEL` | `info` | JSON logs to stdout/stderr |

The bot validates the configuration on start and exits with a clear message naming the
variable that is wrong.

## Examples

### Order events for n8n

Each event is a `POST` with JSON like this:

```json
{
  "event": "order.created",
  "at": "2026-11-15T06:00:00.000Z",
  "order": {
    "id": "ORD-261115-7KQ2",
    "status": "pending",
    "customer": { "name": "Rahim Uddin", "phone": "01712345678", "district": "Dhaka", "address": "House 12, Road 5, Dhanmondi" },
    "payment": { "method": "bkash", "bkashTrxId": "9C7D6E5F4G" },
    "zone": "inside",
    "lines": [{ "productId": "jamdani-red", "name": "Dhakai Jamdani (red) / ঢাকাই জামদানি (লাল)", "unitPrice": 5900, "qty": 1, "total": 5900 }],
    "subtotal": 5900,
    "deliveryFee": 70,
    "total": 5970
  }
}
```

Headers: `X-Shop-Event`, `X-Shop-Timestamp`, `X-Shop-Delivery` (an idempotency key) and, when
`N8N_WEBHOOK_SECRET` is set, `X-Shop-Signature: sha256=<HMAC of "<timestamp>.<body>">`.
`order.status_changed` events add `previousStatus` and `changedBy`.

Import [`examples/n8n/shop-orders-workflow.json`](examples/n8n/shop-orders-workflow.json) for a
starter workflow (webhook, signature check, branch on event type), or paste
[`examples/n8n/verify-signature.js`](examples/n8n/verify-signature.js) into a Code node.
Typical uses: SMS confirmation, booking a courier (Pathao, Steadfast, RedX), or a CRM entry.

### Orders in Google Sheets

Create an `Orders` tab with the header row from
[`examples/google-sheets/Orders-header.csv`](examples/google-sheets/Orders-header.csv) and set
`SHEETS_EXPORT_ORDERS=true`. Rows are appended with `valueInputOption=RAW`, so text a customer
types (for example a name starting with `=`) is stored as text and never runs as a formula.

### Embedding

```js
import { ShopBot, HttpTelegramApi, JsonStore, CatalogService, JsonCatalogSource, OrderEvents } from 'telegram-shop-bot';
```

See [`examples/embed-custom-sink.mjs`](examples/embed-custom-sink.mjs) for a complete example
with a custom order event sink.

### Commands

| Command | What it does |
|---------|--------------|
| `/start` | welcome menu |
| `/shop` | categories |
| `/search WORDS` | find products by name, description or category; plain text outside checkout does the same |
| `/cart` | cart |
| `/orders` | last five orders with status |
| `/language` | switch Bangla / English |
| `/help` | how to order |
| `/cancel` | leave checkout (the cart is kept) |
| `/chatid` | in a group: reply with the group's chat id |

The commands are registered with `setMyCommands` in English and Bangla on start.

## Testing

```bash
npm install
npm test              # builds, then: node --test dist/test/*.test.js
npm run lint          # type-check
```

The tests use `node:test` and a `FakeTelegramApi` that records every call. They cover the full
customer journey (browse, cart, checkout with COD and bKash, saved details, expiry, stock
changes), admin actions and permissions, HTML escaping, rate limiting, the JSON and SQLite
stores, Google service account JWT signing (verified with a generated RSA key) and the Sheets
client, the n8n webhook signing and retries, the webhook server (secret token, body limits),
long polling, config validation and the app wiring. SQLite tests are skipped automatically
on Node versions without `node:sqlite`. CI runs on Node 20, 22 and 24 and builds the Docker
image.

## Limitations

- No payment API: bKash payments are a reference (TrxID) the customer types in. Check it in
  your bKash app or statement before confirming the order. Nagad and Rocket are not built in
  (the same pattern is easy to add).
- Stock is read from the catalogue and checked at checkout, but not decremented by the bot;
  update the sheet or JSON file (or automate it from the n8n event).
- One bot process per token. Rate limits and duplicate-update tracking are in memory.
- The JSON store rewrites one file per change: fine for a small shop, use SQLite for more
  traffic.
- Delivery fees are two zones (inside/outside), plus an optional free-delivery threshold.
  Thana-level pricing or courier quotes would need custom code.
- Admin notifications are in English; customer messages follow the customer's language.
- Product photos must be HTTPS URLs or Telegram `file_id`s. If a photo fails to load, the
  product is shown as text.

## License

[MIT](LICENSE) © 2026 Saizul Amin
