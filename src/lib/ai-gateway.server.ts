// Server-only. Talks to Lovable AI Gateway (OpenAI-compatible).
const BASE = "https://ai.gateway.lovable.dev/v1";

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
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
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
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limit reached. Please wait and try again.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits to continue.");
    throw new Error(`AI gateway error [${res.status}]: ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
