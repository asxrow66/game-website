import db from "../db.js";
export default async function handler(req, res) {
  const anonId = req.headers["x-anon-id"] || req.query.anonId;
  const conversationId = req.query.conversationId;
  if (!anonId || !conversationId) return res.status(400).send("anonId and conversationId required");

  try {
    const { rowCount } = await db.query(
      `SELECT 1 FROM conversations WHERE id=$1 AND owner_id=$2`, [conversationId, anonId]);
    if (!rowCount) return res.status(403).send("Forbidden");

    const { rows } = await db.query(
      `SELECT role, content, created_at, metadata
       FROM messages WHERE conversation_id=$1 ORDER BY created_at`, [conversationId]);
    res.json({ messages: rows });
  } catch (e) {
    console.error("messages:", e);
    res.status(500).send("Server error");
  }
}
