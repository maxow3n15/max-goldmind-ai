// Server-only. Talks to Lovable AI Gateway (OpenAI-compatible).
const BASE = "https://ai.gateway.lovable.dev/v1";
const REQUEST_TIMEOUT_MS = 45_000;
/** Only 429 / 5xx are retryable; everything else is terminal. */
const MAX_ATTEMPTS = 3;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callChat(opts: {
  messages: ChatMessage[];
  model?: string;
  response_format?: { type: "json_object" };
  temperature?: number;
}): Promise<string> {
  const key = process.env['LOVABLE_API_KEY'];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");

  const body = JSON.stringify({
    model: opts.model ?? "google/gemini-3.6-flash",
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    ...(opts.response_format ? { response_format: opts.response_format } : {}),
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          // Lovable AI Gateway authenticates on this header, not Bearer.
          "Lovable-API-Key": key,
        },
        body,
      });
    } catch (e: any) {
      lastError =
        e?.name === "AbortError"
          ? new Error(`AI gateway request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
          : (e as Error);
      // Network-level failures are transient: back off and retry.
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits to continue.");
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(
          res.status === 429
            ? "Rate limit reached. Please wait and try again."
            : `AI gateway upstream error [${res.status}]`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await sleep(800 * attempt);
          continue;
        }
        throw lastError;
      }
      // 4xx other than 429 means the request itself is wrong — do not retry.
      throw new Error(`AI gateway error [${res.status}]: ${text.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      lastError = new Error("AI gateway returned an empty response — no analysis content received.");
      if (attempt < MAX_ATTEMPTS) {
        await sleep(400 * attempt);
        continue;
      }
      throw lastError;
    }
    return content;
  }

  throw lastError ?? new Error("AI gateway call failed");
}
