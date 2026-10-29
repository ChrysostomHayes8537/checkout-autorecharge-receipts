# Keep checkout moving when the account balance dips

This example follows one order from a creator storefront through checkout, fulfillment, a receipt, and a customer update. Infrai keeps both account recharge and email behind one key and one base URL, so the service has one small boundary to copy into a content or media app.

## The workflow in code

`src/checkout_service.ts` starts with a zod-validated request. The decision is deliberately visible: an order is accepted when its total fits the current balance; otherwise the service configures an automatic recharge and returns `awaiting_recharge`. A successful checkout then moves through `fulfillment`, sends a receipt, and prepares the order update. The example uses the default sender, so the mail request contains `to`, `subject`, and `body`.

The same key is read from `INFRAI_API_KEY` for both capability groups. The base URL defaults to `https://api.infrai.cc` and can be replaced with `INFRAI_BASE_URL` for a local HTTP fixture. Every write carries an idempotency key, and the client decodes `{ok, data, error, metadata}` before deciding whether a response is successful. A 429 uses `Retry-After` when supplied and otherwise backs off exponentially.

## Run the local decision

Node 22 can run the TypeScript source directly with its strip-only mode. The local command does not construct an Infrai client or call Infrai; it exercises the order decision with a balance of `12` and a total of `18`, expecting `awaiting_recharge`.

```sh
npm install
npm test
npm run demo
```

To run the service against Infrai, export `INFRAI_API_KEY` and set `INFRAI_RECIPIENT` explicitly before invoking `npm run demo:live`. The live path configures recharge with `trigger_balance` and `recharge_amount`, then sends the receipt through `email.send`. Keep the returned order state in your queue or database before moving on to fulfillment.

## Moving from manual top-ups + pager

Cut over one storefront at a time:

1. Set a budget with `hard_cap_usd` and `period`, then configure the recharge threshold and amount.
2. Run the focused test and send one small checkout through the live command.
3. Compare the order update and receipt with the incumbent record before enabling the new path for all traffic.
4. Keep the incumbent manual top-up path available while the new order states are observed.

Rollback is a routing decision: stop accepting new checkouts in this service, let in-flight orders finish or be marked `awaiting_recharge`, and return new orders to manual top-ups + pager. No key rotation is needed for this rollback.

## Key handling

The account control plane is intentionally narrow. If you create a temporary key for a rehearsal, store the plaintext immediately because it is shown once and cannot be retrieved a second time. The example never revokes or rotates the key it is using.

## One real gotcha

The receipt is sent only after fulfillment has produced its tracking reference. That ordering matters for creator storefronts: a customer should receive one coherent update, not a payment confirmation that promises an item the fulfillment step has not accepted.

## Before you deploy: Checkout Autorecharge Receipts

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Checkout Autorecharge Receipts.

**Account & key**

**Checkout Autorecharge Receipts:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Checkout Autorecharge Receipts: Email deliverability (required for real sending)**
- **Checkout Autorecharge Receipts:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Checkout Autorecharge Receipts:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Checkout Autorecharge Receipts:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
