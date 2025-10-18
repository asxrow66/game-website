// api/admin/admin-chat.js
// Secure admin-only chat proxy with model selection.
// Requires: OPENAI_API_KEY, ADMIN_SECRET

export const config = { runtime: "edge" }; // fast & stream-friendly on Vercel

export default async function handler(req) {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }

    const adminSecret = req.headers.get("x-admin-secret") || "";
    if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return new Response("Missing OPENAI_API_KEY", { status: 500 });
    }

    const { model, messages, system } = await req.json();

    // Build OpenAI chat payload
    const chatMessages = [];
    if (system && String(system).trim()) {
      chatMessages.push({ role: "system", content: String(system).trim() });
    }
    (messages || []).forEach(m => {
      if (m && m.role && m.content != null) chatMessages.push({ role: m.role, content: m.content });
    });

    const payload = {
      model: model || "gpt-4o-mini-2024-07-18",
      stream: true,
      messages: chatMessages
    };

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!openaiRes.ok || !openaiRes.body) {
      const txt = await openaiRes.text().catch(() => "");
      return new Response(`Upstream error: ${openaiRes.status} ${txt}`, { status: 502 });
    }

    // Convert SSE stream to plain text stream by extracting delta.content chunks
    const stream = new ReadableStream({
      async start(controller) {
        const reader = openaiRes.body.getReader();
        const decoder = new TextDecoder();
        try {
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE messages are separated by \n\n and prefixed with "data: "
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";

            for (const part of parts) {
              const line = part.trim();
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "[DONE]") { controller.close(); return; }
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(new TextEncoder().encode(delta));
              } catch {}
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      }
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate"
      }
    });
  } catch (err) {
    return new Response("Server error", { status: 500 });
  }
}