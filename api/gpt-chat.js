// Vercel serverless function
// - Streams plain text (SSE parsed) from OpenAI chat/completions
// - Optional web search via Tavily when body.useWeb === true
// Env required: OPENAI_API_KEY
// Env optional: TAVILY_API_KEY (required only when useWeb is true)

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 700;

async function webSearch(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Missing TAVILY_API_KEY");
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_domains: [],
      include_images: false,
      include_raw_content: false,
    }),
  });
  if (!r.ok) throw new Error(`Tavily error ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method not allowed");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).send("Missing OPENAI_API_KEY");

  // Parse body (supports both vercel body parsing and raw)
  let body;
  try {
    body = req.body ?? JSON.parse(await new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    }));
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  const useWeb = !!body?.useWeb;
  if (!messages) return res.status(400).send("messages must be an array");

  let enhancedMessages = messages;

  // If web toggle ON, fetch results and inject as system context
  if (useWeb) {
    console.log("🌐 Web search triggered");
    try {
      const last = messages[messages.length - 1];
      const query = String(last?.content || "").trim();
      console.log("🔍 Query:", query);

      const results = await webSearch(query);
      const count = results?.results?.length || 0;
      console.log("✅ Tavily returned results:", count);

      const items = (results?.results || [])
        .map(
          (r, i) =>
            `[[${i + 1}]] ${r.title}\nURL: ${r.url}\nSnippet: ${
              r.snippet || r.content || ""
            }`
        )
        .join("\n\n");

      const sys =
`You are a helpful assistant with web context. Use ONLY the sources below to answer.
Cite sources inline like [1], [2] that match the list. Include relevant URLs.
If sources don't answer the question, say you couldn't find enough info.

Sources:
${items || "No results."}`;

      enhancedMessages = [{ role: "system", content: sys }, ...messages];
      res.setHeader("X-Web-Used", "1"); // debug signal to browser Network tab
    } catch (err) {
      console.error("❌ Web search error:", err);
      // Proceed without browsing but tell the model to mention that it failed
      enhancedMessages = [
        ...messages,
        {
          role: "system",
          content:
            "Web search failed; answer without browsing and say so politely.",
        },
      ];
      res.setHeader("X-Web-Used", "0");
    }
  } else {
    res.setHeader("X-Web-Used", "0");
  }

  // Call OpenAI with streaming
  let upstream;
  try {
    upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: enhancedMessages,
        temperature: 0.4,
        stream: true,
        max_tokens: MAX_TOKENS,
      }),
    });
  } catch (e) {
    console.error("Network error to OpenAI:", e);
    return res.status(502).send("Upstream error");
  }

  if (!upstream.ok || !upstream.body) {
    const t = await upstream.text().catch(() => "");
    console.error("OpenAI upstream:", upstream.status, t);
    return res.status(502).send("Upstream error");
  }

  // Parse SSE from OpenAI and stream only delta.content to client
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Transfer-Encoding", "chunked");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);

        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            res.end();
            return;
          }

          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content ?? "";
            if (delta) res.write(delta);
          } catch {
            // ignore keep-alives / non-JSON lines
          }
        }
      }
    }
  } catch (e) {
    console.error("Streaming parse error:", e);
    try { res.write("\n"); } catch {}
  } finally {
    res.end();
  }
}
