# SePay production setup

The Railway application is ready to receive signed SePay webhooks at:

`https://taopho88-production.up.railway.app/api/webhooks/sepay`

## Linked account

- Bank: `TPBank`
- Account: `88888888188`
- QR provider: `vietqr.app`
- Order data mode: `test` (all current orders are stored with `is_test = 1`)

## Payment-code recognition

In **Cấu hình Công ty → Cấu hình chung → Cấu trúc mã thanh toán**, add an active pattern:

- Prefix: `TPHO` (SePay only accepts letters in payment-code prefixes)
- Minimum suffix length: `12`
- Maximum suffix length: `12`
- Character type: letters and numbers

The application also extracts this pattern from the original transfer content when SePay sends `code: null`.

## Webhook

Create an enabled webhook with:

- Event: incoming bank transaction
- Account: TPBank `88888888188`
- Content type: `application/json`
- Automatic retries: enabled
- Authentication: `HMAC-SHA256`
- Secret: copy the existing Railway variable `SEPAY_WEBHOOK_SECRET`; never paste it into source code or documentation

Do not enable a filter that drops transactions without a recognized payment code. The backend safely stores these as `unmatched` for later reconciliation instead of applying them to an order.

After saving, use SePay's **Gửi thử** action. A successful delivery must return HTTP 200 with exactly `{"success": true}`.

## Operational rules

- The browser cannot mark an order paid. Only a verified webhook can do that.
- SePay transaction IDs are unique in the database, so retries and manual replays cannot credit an order twice.
- Partial transfers accumulate; exact payment becomes `paid`, excess becomes `overpaid`.
- Wrong-account and outgoing transactions are retained for audit but never applied to an order.
- A paid order cannot be cancelled directly. Finance must first complete the bank transfer back to the customer, then record it with `payment.refund` using the exact received amount, reason and bank reference. The backend stores one immutable refund record, voids the order allocation, writes the refund ledger entry and cancels the order atomically.
- The current refund command intentionally supports full refunds only while an order is still `new` or `accepted`; partial refunds and returns after preparation require a separate approval workflow.
- Switch `ORDER_DATA_MODE=live` only when the shop formally starts accepting real customer orders.
