// api/gpt-chat.js — streams GPT-4o mini with optional web search,
// saves chats to Postgres (Neon), and now auto-generates concise titles
// for the conversation from the first user message.

import db from "../db.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 700;

/* ---------------- CORS ---------------- */
const ALLOWED_ORIGINS = new Set([
  "https://www.gatewaychurchtx.com",
  "https://gatewaychurchtx.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

function applyCors(req, res) {
  const origin = req.headers.origin || "null";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, X-Anon-Id");
}

/* ------------- DB helpers ------------- */
async function createConversation(title, ownerId) {
  const r = await db.query(
    `INSERT INTO conversations(title, owner_id) VALUES ($1,$2) RETURNING id`,
    [title || null, ownerId || null]
  );
  return r.rows[0].id;
}
async function assertOwner(conversationId, ownerId) {
  const r = await db.query(
    `SELECT 1 FROM conversations WHERE id = $1 AND owner_id = $2`,
    [conversationId, ownerId]
  );
  return !!r.rowCount;
}
async function saveMessage(conversationId, role, content, metadata = {}) {
  await db.query(
    `INSERT INTO messages(conversation_id, role, content, metadata)
     VALUES ($1,$2,$3,$4)`,
    [conversationId, role, content, metadata]
  );
  await db.query(`UPDATE conversations SET last_updated = now() WHERE id = $1`, [conversationId]);
}

/* ------------- Title helpers ------------- */
// Generate a short, clean title (3–7 words) from the first user message
async function generateTitle(apiKey, userFirstMessage) {
  const prompt = `Make a short chat title (3–7 words) for this user's first message.
- No trailing punctuation
- No quotes
- Clear and concise

Message: """${String(userFirstMessage).slice(0, 600)}"""`;

  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 24
    })
  });
  if (!r.ok) return null;
  const j = await r.json();
  const t = j?.choices?.[0]?.message?.content?.trim();
  if (!t) return null;
  return t.replace(/^["“”']|["“”']$/g, "").replace(/\.$/, "");
}

async function updateConversationTitle(conversationId, title) {
  try {
    await db.query(
      `UPDATE conversations
         SET title = $2, last_updated = now()
       WHERE id = $1
         AND (title IS NULL OR title = '' OR title = 'New chat')`,
      [conversationId, title]
    );
  } catch (e) {
    console.error("title update failed:", e);
  }
}

/* ------------- Web search ------------- */
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
      include_images: false,
      include_raw_content: false,
    }),
  });
  if (!r.ok) throw new Error(`Tavily error ${r.status}`);
  return r.json();
}
function toDomain(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

/* ------------- Handler ------------- */
export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).send("Method not allowed");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).send("Missing OPENAI_API_KEY");

  // Parse JSON body
  let body;
  try {
    body = req.body ?? JSON.parse(await new Promise((resolve) => {
      let data = ""; req.on("data", c => data += c); req.on("end", () => resolve(data));
    }));
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  const useWeb = !!body?.useWeb;
  const anonId = body?.anonId || req.headers["x-anon-id"] || null;
  let conversationId = body?.conversationId || null;
  if (!messages) return res.status(400).send("messages must be an array");

  // First user message (for title generation)
  const firstUserMsg = (messages.find(m => m.role === "user")?.content || "").trim();

  // Conversation ownership / creation
  if (conversationId) {
    const ok = await assertOwner(conversationId, anonId);
    if (!ok) return res.status(403).send("Forbidden");
  } else {
    // placeholder title; will be replaced by generated title later
    conversationId = await createConversation("New chat", anonId);
  }
  res.setHeader("X-Conversation-Id", conversationId);

  // Save incoming user messages
  for (const m of messages.filter(m => m.role === "user")) {
    try {
      await saveMessage(conversationId, "user", String(m.content).slice(0, 10000), { webUsed: useWeb });
    } catch (e) {
      console.error("save user msg error:", e);
    }
  }

  // Build prompt, maybe with web sources
  let enhancedMessages = messages;
  let webSources = [];
  if (useWeb) {
    try {
      const last = String(messages[messages.length - 1]?.content || "").trim();
      const results = await webSearch(last);
      webSources = (results?.results || []).slice(0, 5).map(r => ({
        title: r.title || toDomain(r.url),
        url: r.url,
        site: toDomain(r.url),
      }));
      const itemsForPrompt = webSources
        .map((r, i) => `[[${i + 1}]] ${r.title}\nURL: ${r.url}`)
        .join("\n\n");

      const sys =
`You are a helpful assistant with web context. Use ONLY the sources below to answer.
Cite sources inline like [1], [2] that match the list. Include relevant URLs.
If sources don't answer the question, say you couldn't find enough info.

Sources:
${itemsForPrompt || "No results."}`;

      enhancedMessages = [{ role: "system", content: sys }, ...messages];
      res.setHeader("X-Web-Used", "1");
      res.setHeader("X-Web-Sources", Buffer.from(JSON.stringify(webSources)).toString("base64"));
    } catch (err) {
      console.error("Web search error:", err);
      enhancedMessages = [
        ...messages,
        { role: "system", content: "Web search failed; answer without browsing and say so politely." },
      ];
      res.setHeader("X-Web-Used", "0");
    }
  } else {
    res.setHeader("X-Web-Used", "0");
  }

  // OpenAI call (stream)
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

  // Stream back only delta.content
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Transfer-Encoding", "chunked");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  const finalize = async () => {
    // Save assistant message
    if (reply) {
      try {
        await saveMessage(conversationId, "assistant", reply.slice(0, 100000), { model: MODEL, webUsed: useWeb });
      } catch (e) {
        console.error("save assistant msg error:", e);
      }
    }
    // Generate and set the title once per conversation
    if (firstUserMsg && conversationId) {
      try {
        const title = await generateTitle(apiKey, firstUserMsg);
        if (title) await updateConversationTitle(conversationId, title);
      } catch (e) {
        console.error("title gen error:", e);
      }
    }
  };

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
            await finalize();
            res.end();
            return;
          }

          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              reply += delta;
              res.write(delta);
            }
          } catch {
            // ignore keep-alives / non-JSON
          }
        }
      }
    }
  } catch (e) {
    console.error("Streaming parse error:", e);
    try { res.write("\n"); } catch {}
  } finally {
    await finalize();
    res.end();
  }
}
