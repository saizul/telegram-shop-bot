# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Product search: `/search WORDS`, or any text of two or more characters sent outside checkout,
  lists matching active products as buttons (up to 10, with a hint to add a word when there are
  more). Every word must match the name, description, id or category name in English or Bangla;
  matching is case-insensitive, ignores punctuation and treats Bangla and ASCII digits alike.
  Name matches rank first. `/search` is registered with `setMyCommands` in both languages and
  listed in `/help`.
- `CatalogService.search()`, `searchProducts()`, `normalizeSearchText()` and `commandArgs()`
  for embedding.
- Contributor community files: `CODE_OF_CONDUCT.md`, issue templates and a pull request
  template.

## [0.1.0] - 2026-11-15

### Added

- Catalogue from a JSON file or Google Sheets (service account JWT, Sheets `values` API), with
  categories, sale prices, stock, photos and a cached loader that survives Google outages.
- Inline keyboard shopping: categories, paginated product lists, product cards with photo,
  cart with +/-/remove/clear.
- Storage for sessions, carts and orders in SQLite (`node:sqlite`) or a JSON file.
- Checkout: name, Bangladeshi mobile number normalisation or contact sharing, division and
  district picker for all 64 districts, address, delivery fee inside/outside Dhaka with an
  optional free-delivery threshold, cash on delivery or bKash Send Money with TrxID.
- Saved customer details for repeat orders; checkout expiry.
- Order confirmation to the customer; admin group notification with Confirm, Ship, Delivered
  and Cancel buttons, status history and customer notifications in their language.
- Order export to Google Sheets (RAW input) and signed n8n webhook events with retries.
- Bangla and English strings with a language switch and Bangla digits.
- Rate limiting and anti-spam (token bucket, repeated messages, flood mute, length limit).
- Long polling and webhook mode with secret token verification and a `/healthz` endpoint.
- Dockerfile, docker-compose example (optional n8n), example catalogue, Sheets templates and
  an n8n starter workflow.

[0.1.0]: https://github.com/saizul/telegram-shop-bot/releases/tag/v0.1.0
