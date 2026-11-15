# Contributing

Thanks for helping. Bug reports, translations and pull requests are welcome.

## Development setup

```bash
git clone https://github.com/saizul/telegram-shop-bot.git
cd telegram-shop-bot
npm install
npm test        # builds, then runs node:test on dist/test/*.test.js
npm run lint    # type-check only
```

Use Node 22.13 or newer to run the SQLite tests (they are skipped on older versions).

To try the bot against Telegram, create a separate test bot with @BotFather, copy
`.env.example` to `.env`, and run `npm run dev`. Never commit `.env` or real tokens.

## Guidelines

- The bot logic only talks to the `TelegramApi` interface. New features should come with tests
  that drive the bot through `test/helpers/harness.ts`, without network access.
- Keep the zero-runtime-dependency rule: use Node built-ins (`fetch`, `node:crypto`,
  `node:sqlite`, `node:http`).
- Every user-facing string goes in `src/i18n/strings.ts` in **both** English and Bangla. The
  tests fail if a key or placeholder is missing in one language.
- Escape all user and catalogue content with `escapeHtml` before sending HTML messages.
- Callback data must stay within Telegram's 64-byte limit; use the `button()` helper.

## Pull requests

1. Create a branch from `main`.
2. Add tests for your change and run `npm test`.
3. Update `README.md` and `CHANGELOG.md` when behaviour or configuration changes.
4. Keep commits focused, with a short imperative summary line.
