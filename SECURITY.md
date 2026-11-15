# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | yes       |

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately through GitHub's **Report a vulnerability** button under the repository's
Security tab (private vulnerability reporting). Include:

- a description of the issue and its impact
- steps to reproduce, or a proof of concept
- the affected version or commit

You will get an acknowledgement within 7 days. A fix or mitigation plan will follow once the
report is confirmed.

## Scope

Issues of particular interest:

- bypassing the webhook secret token check
- order actions performed by someone outside the admin group or `ADMIN_USER_IDS`
- HTML injection into bot messages or formula injection into exported sheets
- ways around the rate limiter that let one user degrade the bot for others
- leaking customer data (names, phone numbers, addresses) to other users

## Deployment hardening

- Keep `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`, `N8N_WEBHOOK_SECRET` and the Google service
  account key out of version control. Use environment variables or Docker secrets.
- Use a random `WEBHOOK_SECRET` of at least 32 characters (`openssl rand -hex 32`).
- Bind the webhook port to localhost and terminate TLS in a reverse proxy.
- Set `ADMIN_USER_IDS` so only named staff can change order status, and keep the admin group
  private.
- Give the service account access only to the shop spreadsheet; Viewer is enough unless you
  export orders.
- Verify `X-Shop-Signature` and `X-Shop-Timestamp` in n8n before acting on an event.
- The database holds customer personal data. Restrict access to the `data/` directory or
  volume and back it up securely.
