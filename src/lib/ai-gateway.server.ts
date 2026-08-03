// Server-only. Talks to Lovable AI Gateway (OpenAI-compatible).
const BASE = "https://ai.gateway.lovable.dev/v1";
const REQUEST_TIMEOUT_MS = 30_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callChat(opts: {
  messages: ChatMessage[];
  model?: string;
  response_format?: { type: "json_object" };
  temperature?: number;
}): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: opts.model ?? "google/gemini-3.6-flash",
        messages: opts.messages,
        temperature: opts.temperature ?? 0.4,
        ...(opts.response_format ? { response_format: opts.response_format } : {}),
      }),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`AI gateway request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limit reached. Please wait and try again.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits to continue.");
    throw new Error(`AI gateway error [${res.status}]: ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("AI gateway returned an empty response — no analysis content received.");
  }
  return content;
}
