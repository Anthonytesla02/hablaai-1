import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  language: z.string().min(2).max(40),
  known: z.array(z.object({ target: z.string().max(300), translation: z.string().max(300) })).max(200),
});

export type MixedItem = { target: string; translation: string; level: "EASY" | "MEDIUM" | "HARD" };

/** Generate 20 brand-new practice items built from words the learner already knows. */
export const generateMixedDeck = createServerFn({ method: "POST" })
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data }): Promise<{ items: MixedItem[]; error?: string }> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { items: [], error: "unavailable" };
    const known = data.known.map((k) => `${k.target} = ${k.translation}`).join("\n");
    const system = `You create ${data.language} recall drills for a beginner.
Using ONLY vocabulary and grammar from the learner's known items (plus very common function words), write 20 NEW items that do NOT copy any known item verbatim: recombine words into new phrases and short sentences.
Mix difficulty: 7 EASY (2-4 word phrases), 7 MEDIUM (short sentences), 6 HARD (longer sentences, questions, or conjugation changes).
All 20 must be unique. Reply ONLY with JSON: {"items":[{"target":string,"translation":string,"level":"EASY"|"MEDIUM"|"HARD"}]}
"target" is ${data.language}, "translation" is natural English.`;
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
        body: JSON.stringify({
          model: "google/gemini-3.8-flash",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: `Known items:\n${known}\nReturn the json.` },
          ],
        }),
      });
      if (!res.ok) return { items: [], error: res.status === 429 ? "busy" : "failed" };
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = json.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { items?: MixedItem[] };
      const knownSet = new Set(data.known.map((k) => k.target.trim().toLowerCase()));
      const seen = new Set<string>();
      const items = (parsed.items ?? []).filter((it) => {
        const key = it?.target?.trim().toLowerCase();
        if (!key || !it.translation || knownSet.has(key) || seen.has(key)) return false;
        seen.add(key);
        if (!["EASY", "MEDIUM", "HARD"].includes(it.level)) it.level = "MEDIUM";
        return true;
      });
      return { items: items.slice(0, 20) };
    } catch {
      return { items: [], error: "failed" };
    }
  });
