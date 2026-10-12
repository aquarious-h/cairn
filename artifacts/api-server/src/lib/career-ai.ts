type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { title?: string; uri?: string };
      }>;
    };
  }>;
};

export class AIRequestError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 502 | 503,
  ) {
    super(message);
    this.name = "AIRequestError";
  }
}

export type GroundedSource = { title: string; uri: string };

const GEMINI_MODEL = "gemini-3.8-flash";
const REQUEST_TIMEOUT_MS = 18_000;
const TOTAL_REQUEST_BUDGET_MS = 54_000;
const GEMINI_MAX_OUTPUT_TOKENS = 65_536;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  return JSON.parse(unfenced) as unknown;
}

function getText(payload: GeminiResponse): string {
  return (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function getGroundedSources(payload: GeminiResponse): GroundedSource[] {
  const sources = (payload.candidates ?? []).flatMap((candidate) =>
    (candidate.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) => {
      const uri = chunk.web?.uri;
      if (!uri || !/^https?:\/\//i.test(uri)) return [];
      return [{ title: chunk.web?.title?.trim() || "Web source", uri }];
    }),
  );
  return [...new Map(sources.map((source) => [source.uri, source])).values()];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateGeminiJson(
  instruction: string,
  userData: unknown,
  options: { webSearch?: boolean; temperature?: number } = {},
): Promise<{ value: unknown; sources: GroundedSource[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AIRequestError(
      "Gemini is not configured. Add GEMINI_API_KEY to the server environment to enable AI features.",
      503,
    );
  }
  if (options.webSearch) {
    throw new AIRequestError(
      "Live web search grounding is not available with the Gemini Free Tier model.",
      503,
    );
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const startedAt = Date.now();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remainingMs = TOTAL_REQUEST_BUDGET_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) break;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instruction }] },
          contents: [{
            role: "user",
            parts: [{ text: JSON.stringify(userData) }],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          },
          ...(options.webSearch ? { tools: [{ google_search: {} }] } : {}),
        }),
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs)),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new AIRequestError(
            "Gemini Free Tier quota is exhausted or this project is rate-limited. Wait for quota to reset or check its Google AI Studio limits.",
            429,
          );
        }
        if (response.status >= 500) {
          if (attempt < 2 && Date.now() - startedAt < TOTAL_REQUEST_BUDGET_MS - 1_000) {
            await wait(350 * 2 ** attempt);
            continue;
          }
          throw new AIRequestError("The AI service is temporarily unavailable.", 502);
        }
        if (response.status === 401 || response.status === 403) {
          throw new AIRequestError("The configured Gemini key is invalid or does not have access.", 503);
        }
        throw new AIRequestError("The AI service rejected the request.", 502);
      }

      const rawPayload: unknown = await response.json();
      if (!isRecord(rawPayload)) {
        throw new AIRequestError("The AI service returned an invalid response.", 502);
      }
      const payload = rawPayload as GeminiResponse;
      if (payload.candidates?.some((candidate) => candidate.finishReason === "MAX_TOKENS")) {
        throw new AIRequestError(
          "Gemini reached its output token limit.",
          502,
        );
      }
      const text = getText(payload);
      if (!text) throw new AIRequestError("The AI service returned no response.", 502);

      try {
        return { value: parseJsonText(text), sources: getGroundedSources(payload) };
      } catch {
        if (attempt < 2) {
          await wait(350 * 2 ** attempt);
          continue;
        }
        throw new AIRequestError("The AI service returned an invalid structured response.", 502);
      }
    } catch (error) {
      if (error instanceof AIRequestError) throw error;
      if (attempt < 2 && Date.now() - startedAt < TOTAL_REQUEST_BUDGET_MS - 1_000) {
        await wait(350 * 2 ** attempt);
        continue;
      }
      throw new AIRequestError("The AI service could not be reached.", 502);
    }
  }

  throw new AIRequestError("The AI service could not complete the request.", 502);
}

export async function generateCareerJson(
  instruction: string,
  userData: unknown,
  options: { webSearch?: boolean; temperature?: number } = {},
): Promise<{ value: unknown; sources: GroundedSource[] }> {
  return generateGeminiJson(instruction, userData, options);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function asTextList(value: unknown, maxItems: number): string[] {
  return asArray(value)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}
