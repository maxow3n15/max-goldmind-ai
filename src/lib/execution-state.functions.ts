import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getExecutionState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildExecutionState } = await import("@/lib/execution-state.server");
    return buildExecutionState(context.supabase, context.userId);
  });

export const runDemoExecutionTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { placeOrder?: boolean }) => ({ placeOrder: !!input?.placeOrder }))
  .handler(async ({ data, context }) => {
    const { runPracticeExecutionTest } = await import("@/lib/execution-state.server");
    return runPracticeExecutionTest(context.supabase, context.userId, { placeOrder: data.placeOrder });
  });
