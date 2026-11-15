// n8n Code node ("Run Once for All Items"): verify the X-Shop-Signature header sent by
// telegram-shop-bot before trusting an order event. Put the same secret as N8N_WEBHOOK_SECRET
// in an n8n credential or environment variable called SHOP_WEBHOOK_SECRET.
//
// The bot signs "<timestamp>.<compact JSON body>" with HMAC-SHA256. The bot sends compact
// JSON, so JSON.stringify of the parsed body reproduces the signed bytes.
const crypto = require('crypto');

const secret = $env.SHOP_WEBHOOK_SECRET;
const out = [];
for (const item of $input.all()) {
  const headers = item.json.headers || {};
  const timestamp = headers['x-shop-timestamp'];
  const received = headers['x-shop-signature'] || '';
  const body = JSON.stringify(item.json.body);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300; // reject replays older than 5 minutes
  const valid =
    received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!valid || !fresh) throw new Error('Invalid or stale shop webhook signature');
  out.push({ json: item.json.body });
}
return out;
