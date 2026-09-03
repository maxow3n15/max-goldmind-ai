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
        // The shared secret lives in managed storage, never in the repository
        // and never in the scheduled job's command text.
        const { verifyCronRequest } = await import("@/lib/cron-auth.server");
        const auth = await verifyCronRequest(request);
        if (!auth.ok) return json({ error: auth.error }, auth.status);




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
