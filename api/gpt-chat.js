// api/gpt-chat.js
const ALLOWED_MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method not allowed");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).send("Missing OPENAI_API_KEY");

  let messages = [];
  try {
    messages = req.body?.messages;
    if (!Array.isArray(messages)) throw new Error("messages must be an array");
  } catch {
    return res.status(400).send("Bad request: messages must be an array");
  }

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ALLOWED_MODEL,
        messages,
        temperature: 0.7,
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const t = await upstream.text().catch(() => "");
      console.error("OpenAI upstream:", upstream.status, t);
      return res.status(502).send("Upstream error");
    }

    // Prepare streaming text back to the client
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by \n\n
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);

        // Each line in the frame can be "data: ..."
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim(); // after "data:"
          if (payload === "[DONE]") {
            res.end();
            return;
          }

          try {
            const json = JSON.parse(payload);
            const choice = json?.choices?.[0];
            const deltaText = choice?.delta?.content ?? "";
            if (deltaText) res.write(deltaText);
          } catch (e) {
            // Non-JSON keep-alives or event types we don't care about
            // console.debug("Non-JSON SSE line:", payload);
          }
        }
      }
    }

    res.end();
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).send("Internal error");
  }
}
