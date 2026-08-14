// Scheduled autopilot tick.
//
// Runs the *same* decision pipeline the browser engine runs, once per minute,
// for every user who has hands-off execution enabled — so trades keep being
// opened, managed and closed with no tab open.
//
// Auth is a shared secret header, mirroring the webhook route: no user session
// exists when pg_cron calls this.

import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/cron/tick")({
  server: {
    handlers: {
      GET: async () => json({ ok: true, service: "GoldMind AI autopilot tick" }),

      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        if (!secret) return json({ error: "not configured" }, 503);
        const provided = request.headers.get("x-cron-secret") ?? "";
        // Timing-safe: compare digests so neither length nor content leaks.
        const { createHash, timingSafeEqual } = await import("crypto");
        const a = createHash("sha256").update(provided).digest();
        const b = createHash("sha256").update(secret).digest();
        if (!timingSafeEqual(a, b)) {
          return json({ error: "unauthorised" }, 401);
        }


        const { runScheduledTick } = await import("@/lib/services/tick.server");
        try {
          const result = await runScheduledTick();
          return json({ ok: true, ...result });
        } catch (e: any) {
          console.error("cron tick failed", e);
          return json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, 500);
        }
      },
    },
  },
});
