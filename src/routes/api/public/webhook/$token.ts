// TradingView (and any external strategy) alert receiver.
//
// The URL token identifies the account; the payload is validated, stored and
// queued as `pending`. Nothing is executed here — the engine reviews every
// external signal against the AI verdict and the risk engine before acting.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const SignalSchema = z.object({
  action: z.enum(["buy", "sell", "close", "close_all"]),
  symbol: z.string().max(20).default("XAUUSD"),
  price: z.number().finite().optional(),
  stop_loss: z.number().finite().optional(),
  take_profit: z.number().finite().optional(),
  lot_size: z.number().min(0.01).max(100).optional(),
  comment: z.string().max(200).optional(),
  source: z.string().max(40).default("tradingview"),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/webhook/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const token = String(params.token ?? "");
        if (token.length < 16) return json({ error: "invalid token" }, 401);

        const raw = await request.text();
        if (raw.length > 8_000) return json({ error: "payload too large" }, 413);

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          // TradingView plain-text alerts: "buy XAUUSD 2345.5"
          const [action, symbol, price] = raw.trim().split(/\s+/);
          parsedBody = { action: (action ?? "").toLowerCase(), symbol: symbol ?? "XAUUSD", price: price ? Number(price) : undefined };
        }

        const parsed = SignalSchema.safeParse(parsedBody);
        if (!parsed.success) {
          return json({ error: "invalid signal", issues: parsed.error.issues.slice(0, 5) }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: owner } = await supabaseAdmin
          .from("user_settings")
          .select("user_id, webhook_enabled")
          .eq("webhook_token", token)
          .maybeSingle();

        // Same response for unknown and disabled tokens — no enumeration.
        if (!owner || !owner.webhook_enabled) return json({ error: "invalid token" }, 401);

        const s = parsed.data;
        const { error } = await supabaseAdmin.from("webhook_signals").insert({
          user_id: owner.user_id,
          source: s.source,
          action: s.action,
          symbol: s.symbol.toUpperCase(),
          price: s.price ?? null,
          stop_loss: s.stop_loss ?? null,
          take_profit: s.take_profit ?? null,
          lot_size: s.lot_size ?? null,
          comment: s.comment ?? null,
          status: "pending",
          raw: (typeof parsedBody === "object" ? parsedBody : { raw }) as any,
        });
        if (error) return json({ error: "could not store signal" }, 500);

        return json({ ok: true, queued: true });
      },
      GET: async () => json({ ok: true, service: "GoldMind AI signal webhook" }),
    },
  },
});
