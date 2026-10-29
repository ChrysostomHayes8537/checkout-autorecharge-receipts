import assert from "node:assert/strict";
import test from "node:test";
import { checkout, InfraiClient, verifyWebhook } from "./checkout_service.ts";
import { createHmac } from "node:crypto";

test("a short balance pauses checkout and requests one recharge", async () => {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const client = new InfraiClient("test-key", "https://example.test/v1", async (input, init) => {
    calls.push({ method: init?.method ?? "", path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
  });
  const result = await checkout({ customerEmail: "a@b.test", itemId: "clip", totalUsd: 18 }, client, 12);
  assert.deepEqual(result, { state: "awaiting_recharge", orderId: "order-clip" });
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].path, "/v1/account/autorecharge/configure");
  assert.equal(calls[0].body.recharge_amount, 18);
});

test("the receipt signature is checked with the registered secret", () => {
  const payload = JSON.stringify({ event: "topup.succeeded" });
  const signature = createHmac("sha256", "creator-secret").update(payload).digest("hex");
  assert.equal(verifyWebhook("creator-secret", payload, signature), true);
  assert.equal(verifyWebhook("wrong-secret", payload, signature), false);
});
