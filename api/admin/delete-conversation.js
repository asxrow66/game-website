// api/admin/delete-conversation.js
// Delete a conversation and its messages (POST).
// Supports CORS preflight (OPTIONS) so browser fetches with custom headers succeed.

import db from "../../db.js"; // your DB helper (must expose .query SQL method)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
  "Access-Control-Max-Age": "86400",
};

function sendText(res, status, text) {
  res.status(status).set(CORS_HEADERS).send(String(text));
}

function sendJSON(res, status, obj) {
  res.status(status).set({ "Content-Type": "application/json", ...CORS_HEADERS }).send(JSON.stringify(obj));
}

async function parseJsonBody(req) {
  // If a framework parsed body already, use it
  if (req.body && typeof req.body === "object") return req.body;
  // Otherwise read raw
  return await new Promise((resolve, reject) => {
    let acc = "";
    req.on("data", (chunk) => (acc += chunk));
    req.on("end", () => {
      if (!acc) return resolve({});
      try {
        resolve(JSON.parse(acc));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  try {
    // Preflight CORS response
    if (req.method === "OPTIONS") {
      return res.status(204).set(CORS_HEADERS).send("");
    }

    // Only accept POST for delete action
    if (req.method !== "POST") {
      console.warn("delete-conversation: method not allowed:", req.method);
      return sendText(res, 405, "Method not allowed");
    }

    // Admin secret check
    const headerSecret = (req.headers["x-admin-secret"] || "").toString().trim();
    const envSecret = (process.env.ADMIN_SECRET || "").toString().trim();
    if (!envSecret || headerSecret !== envSecret) {
      console.warn("delete-conversation: bad admin secret");
      return sendText(res, 403, "Forbidden: bad ADMIN_SECRET");
    }

    // Parse body safely
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      console.error("delete-conversation: body parse error", err);
      return sendText(res, 400, "Bad JSON body");
    }

    const conversationId = (body && (body.conversationId || body.id)) || (req.query && req.query.conversationId);
    if (!conversationId) {
      return sendText(res, 400, "Missing conversationId");
    }

    // Verify exists
    const { rows } = await db.query("SELECT id FROM conversations WHERE id = $1", [conversationId]);
    if (!rows || rows.length === 0) {
      return sendText(res, 404, "Conversation not found");
    }

    // Delete messages then conversation inside transaction
    try {
      await db.query("BEGIN");
      await db.query("DELETE FROM messages WHERE conversation_id = $1", [conversationId]);
      await db.query("DELETE FROM conversations WHERE id = $1", [conversationId]);
      await db.query("COMMIT");
    } catch (err) {
      try { await db.query("ROLLBACK"); } catch (e) { /* ignore */ }
      console.error("delete-conversation: db delete failed", err);
      return sendText(res, 500, "DB delete failed: " + (err.message || err));
    }

    return sendJSON(res, 200, { ok: true, conversationId });
  } catch (err) {
    console.error("delete-conversation: unhandled error", err);
    return sendText(res, 500, "Server error: " + (err.message || String(err)));
  }
}
