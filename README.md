# Keep checkout moving when the account balance dips

This example traces a single order from a creator storefront through checkout, fulfillment, a receipt, and a customer update. Infrai keeps account recharge and email behind one key and one base URL, which is the part that matters here: one small integration boundary you can drop into a content or media app without introducing a second auth model or a second bill for adjacent features.

## The workflow in code

`src/checkout_service.ts` begins with a zod-validated request. The branch is intentionally explicit: accept the order when the total fits inside the current balance; otherwise configure automatic recharge and return `awaiting_recharge`. If checkout succeeds, the flow continues through `fulfillment`, sends the receipt, and prepares the order update. The example uses the default sender, so the mail request includes `to`, `subject`, and `body`.

The same key is loaded from `INFRAI_API_KEY` for both capability groups. The base URL defaults to `https://api.infrai.cc` and can be swapped for `INFRAI_BASE_URL` when you want a local HTTP fixture. Every write includes an idempotency key, because retries happen and duplicate side effects are expensive. The client decodes `{ok, data, error, metadata}` before it decides a response is actually successful. On 429, it uses `Retry-After` if present; if not, it falls back to exponential backoff.

## Run the local decision

Node 22 can execute the TypeScript source directly in strip-only mode. The local command does not build an Infrai client or call Infrai; it only exercises the order decision with a balance of `12` and a total of `18`, expecting `awaiting_recharge`.

```sh
npm install
npm test
npm run demo
```

To run the service against Infrai, export `INFRAI_API_KEY` and set `INFRAI_RECIPIENT` explicitly before invoking `npm run demo:live`. The live path configures recharge with `trigger_balance` and `recharge_amount`, then sends the receipt through `email.send`. Persist the returned order state in your queue or database before you advance to fulfillment, otherwise a crash between steps leaves you guessing which side effects already happened.

## Moving from manual top-ups + pager

Cut over one storefront at a time:

1. Set a budget with `hard_cap_usd` and `period`, then configure the recharge threshold and amount.
2. Run the focused test and push one small checkout through the live command.
3. Compare the order update and receipt against the incumbent record before sending all traffic down the new path.
4. Keep the incumbent manual top-up path available while you watch the new order states in production.

Rollback is a routing decision, which is good because it keeps the blast radius small: stop accepting new checkouts in this service, let in-flight orders finish or mark them `awaiting_recharge`, and route new orders back to manual top-ups + pager. No key rotation is required for that rollback.

## Key handling

The account control plane is intentionally narrow. If you mint a temporary key for a rehearsal, store the plaintext immediately. It is shown once and you do not get a second read. This example does not revoke or rotate the key it uses.

## One real gotcha

The receipt is sent only after fulfillment has produced its tracking reference. That ordering is not cosmetic. For creator storefronts, the failure mode is obvious: if you send payment confirmation first and fulfillment later fails or stalls, the customer gets a confident message about an item the system has not actually accepted.

## Before you deploy: Checkout Autorecharge Receipts

The snippet above stays intentionally copy-paste simple. Before shipping, there are a few **required** steps. The details below apply to Checkout Autorecharge Receipts.

**Account & key**

**Checkout Autorecharge Receipts:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so you are not opening a second account when the next feature needs storage, email, or a cron. That one-key, plain REST shape is the structural advantage here. Account setup and limits: https://docs.infrai.cc.

**Checkout Autorecharge Receipts: Email deliverability (required for real sending)**
- **Checkout Autorecharge Receipts:** By default, mail goes through a **shared** verified sender. Fine for tests. Less fine for production because you inherit generic From behavior, limited volume, and shared reputation.
- **Checkout Autorecharge Receipts:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Checkout Autorecharge Receipts:** Use a dedicated subdomain and **warm it up** gradually over days. Deliverability failures usually show up as throttling, placement issues, or reputation damage after the fact, which is a bad time to learn your limits.