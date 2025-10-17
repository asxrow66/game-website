import db from "../../db.js";
export default async function handler(req, res) {
  const secret = req.headers["x-admin-secret"] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).send("Forbidden");
  const { conversationId } = req.query;
  if (!conversationId) return res.status(400).send("conversationId required");
  const { rows } = await db.query(
    `SELECT role, content, created_at, metadata
     FROM messages WHERE conversation_id=$1 ORDER BY created_at`, [conversationId]);
  res.json({ messages: rows });
}
