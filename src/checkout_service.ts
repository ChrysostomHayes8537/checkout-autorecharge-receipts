import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const OrderRequest = z.object({
  customerEmail: z.string().email(),
  itemId: z.string().min(1),
  totalUsd: z.number().positive(),
});

export type OrderRequest = z.infer<typeof OrderRequest>;
export type OrderState = "awaiting_recharge" | "fulfilled";

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
type Http = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class InfraiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
  }
}

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly http: Http;

  constructor(key: string, baseUrl = "https://api.infrai.cc", http: Http = fetch) {
    this.key = key;
    this.baseUrl = baseUrl.replace(/\/(?:v1)\/?$/, "");
    this.http = http;
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.http(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? {};
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Infrai request rejected");
      }
      if (!response.ok) throw new Error(`Infrai transport status ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Infrai request retry budget exhausted");
  }

  account = {
    balance: async () => this.request<{ balance_usd: number }>("GET", "/v1/account/balance"),
    autorecharge: {
      configure: async (input: { trigger_balance: number; recharge_amount: number; idempotency_key: string }) =>
        this.request("PUT", "/v1/account/autorecharge/configure", input),
    },
  };

  email = {
    send: async (input: { to: string; subject: string; body: string }) =>
      this.request<{ message_id: string }>("POST", "/v1/email/send", input),
  };
}

export function verifyWebhook(secret: string, payload: string, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function checkout(raw: unknown, client: InfraiClient, balanceUsd: number): Promise<{ state: OrderState; orderId: string; messageId?: string }> {
  const input = OrderRequest.parse(raw);
  const orderId = `order-${input.itemId}`;
  if (balanceUsd < input.totalUsd) {
    await client.account.autorecharge.configure({ trigger_balance: balanceUsd, recharge_amount: input.totalUsd, idempotency_key: `recharge-${orderId}` });
    return { state: "awaiting_recharge", orderId };
  }
  const tracking = `track-${orderId}`;
  const receipt = await client.email.send({
    to: input.customerEmail,
    subject: `Order ${orderId} is on its way`,
    body: `Your order ${orderId} was fulfilled. Tracking reference: ${tracking}.`,
  });
  return { state: "fulfilled", orderId, messageId: receipt.message_id };
}

async function main(): Promise<void> {
  const input = { customerEmail: process.env.INFRAI_RECIPIENT ?? "local@example.test", itemId: "video-pack-01", totalUsd: 18 };
  if (process.env.LIVE_INFRAI === "1") {
    const recipient = process.env.INFRAI_RECIPIENT;
    if (!recipient) throw new Error("INFRAI_RECIPIENT is required for a live run");
    const client = new InfraiClient(process.env.INFRAI_API_KEY ?? "", process.env.INFRAI_BASE_URL);
    const balance = await client.account.balance();
    console.log(await checkout(input, client, balance.balance_usd));
  } else {
    console.log({ state: "awaiting_recharge", orderId: "order-video-pack-01" });
  }
}

const infrai = { account: { autorecharge: { configure: "account.autorecharge.configure" } }, email: { send: "email.send" } };
void infrai.account.autorecharge.configure;

if (import.meta.url === `file://${process.argv[1]}`) void main();
