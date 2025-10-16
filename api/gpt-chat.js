// File: api/gpt-chat.js
// Hardened to only allow chat completions via gpt-4o-mini

const ALLOWED_MODEL = "gpt-4o-mini";
const MAX_TOKENS = 600;          // clamp output
const MAX_MSGS = 20;             // last 20 messages
const MAX_CHARS = 4000;          // basic size limit per message

function isSameOrigin(req) {
  // Vercel provides these headers; this blocks cross-site use
  const origin = req.headers.origin || "";
  const host = req.headers.host || req.headers["x-forwarded-host"] || "";
  try {
    if (!origin) return true; // direct curl/etc.
    const o = new URL(origin);
    return o.host === host;
  } catch { return false; }
}

export default async function handler(req, res) {
  // Method allowlist
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method not allowed");
  }

  if (!isSameOrigin(req)) {
    return res.status(403).send("Forbidden");
  }

  // Content-type check
  const ct = req.headers["content-type"] || "";
  if (!ct.includes("application/json")) {
    return res.status(400).send("Bad request");
  }

  let body;
  try {
    body = req.body ?? JSON.parse(await new Promise((r) => {
      let data=""; req.on("data", c => data+=c); req.on("end", () => r(data));
    }));
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  // Validate and sanitize messages
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-MAX_MSGS) : null;
  if (!messages || !messages.every(m => m && typeof m.role === "string" && typeof m.content === "string")) {
    return res.status(400).send("messages must be an array of {role, content} strings");
  }
  for (const m of messages) {
    if (m.content.length > MAX_CHARS) {
      return res.status(400).send("message too long");
    }
  }

  // Require API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).send("Server misconfig: missing OPENAI_API_KEY");

  try {
    // >>> Chat-only call (no proxying to other endpoints)
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ALLOWED_MODEL,         // hard-enforced
        messages,
        max_tokens: MAX_TOKENS,       // clamp output cost
        temperature: 0.7,
        stream: true,                 // streaming only
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      // Do not leak upstream text to end users in prod; log server-side instead
      res.status(upstream.status).send("Upstream error");
      console.error("OpenAI upstream error:", upstream.status, text);
      return;
    }

    // Stream back to client
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (err) {
    console.error("Server error:", err);
    res.status(502).send("Upstream unavailable");
  }
}
