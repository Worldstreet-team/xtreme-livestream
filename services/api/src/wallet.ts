import { config } from "./config.js";

/**
 * Server-to-server client for the central WorldStreet wallet service.
 * Auth is the service-principal token (X-Wallet-Service-Token) — it can act
 * for any user, which is exactly why it lives HERE and never in a client app.
 * Spends are USD-only; every amount is integer cents. Same integration shape
 * as worldshop-server's wallet provider.
 */

export type WalletResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export type WalletCharge = {
  id: string;
  amountMinor: number;
  currency: string;
  description: string;
  createdAt: string;
};

export type WalletCurrencyBalance = {
  availableMinor: number;
  lockedMinor: number;
  available: number;
  locked: number;
};

export function isWalletConfigured(): boolean {
  return Boolean(config.WALLET_API_URL && config.WALLET_SERVICE_TOKEN);
}

async function walletCall<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; idempotencyKey?: string } = {},
): Promise<WalletResult<T>> {
  if (!isWalletConfigured()) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Wallet gifting is not configured" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Wallet-Service-Token": config.WALLET_SERVICE_TOKEN,
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let json: (Record<string, unknown> & { ok?: boolean; code?: string; error?: string }) | null;
  try {
    const init: RequestInit = { method, headers };
    if (opts.body != null) init.body = JSON.stringify(opts.body);
    const res = await fetch(`${config.WALLET_API_URL.replace(/\/+$/, "")}${path}`, init);
    json = (await res.json().catch(() => null)) as typeof json;
  } catch (err) {
    return { ok: false, code: "UNREACHABLE", message: (err as Error).message };
  }

  if (!json || json.ok !== true) {
    return {
      ok: false,
      code: json?.code || "UNKNOWN",
      message: json?.error || "Wallet service request failed",
    };
  }
  return { ok: true, data: json as unknown as T };
}

/**
 * Debit the sender's USD balance and, in the same wallet-side transaction,
 * credit the recipient's balance with `recipientAmountUsdMinor`. The
 * difference (our commission) is booked as platform revenue by the wallet.
 * Idempotent per idempotencyKey.
 */
export function chargeWalletWithSplit(params: {
  spenderClerkUserId: string;
  recipientClerkUserId: string;
  amountUsdMinor: number;
  recipientAmountUsdMinor: number;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<WalletResult<{ charge: WalletCharge }>> {
  return walletCall(
    "POST",
    `/v1/wallet/${encodeURIComponent(params.spenderClerkUserId)}/charges`,
    {
      idempotencyKey: params.idempotencyKey,
      body: {
        amountMinor: params.amountUsdMinor,
        currency: "USD",
        recipientUserId: params.recipientClerkUserId,
        recipientAmountMinor: params.recipientAmountUsdMinor,
        description: params.description,
        metadata: params.metadata ?? {},
      },
    },
  );
}

/**
 * The user's spendable USD balance — what they can actually gift with.
 * `availableMinor` excludes funds locked by pending holds.
 */
export function getWalletUsdBalance(
  clerkUserId: string,
): Promise<WalletResult<{ balances: { USD: WalletCurrencyBalance } }>> {
  return walletCall(
    "GET",
    `/v1/wallet/${encodeURIComponent(clerkUserId)}/balances`,
  );
}

/** Compensation path: refund a charge when our own bookkeeping fails after it. */
export function refundWalletCharge(params: {
  clerkUserId: string;
  chargeId: string;
  reason: string;
}): Promise<WalletResult<unknown>> {
  return walletCall(
    "POST",
    `/v1/wallet/${encodeURIComponent(params.clerkUserId)}/charges/${encodeURIComponent(params.chargeId)}/refund`,
    { body: { reason: params.reason } },
  );
}
