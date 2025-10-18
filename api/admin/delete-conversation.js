import db from "../../db.js";

export default async function handler(req, res) {
  const secret = req.headers["x-admin-secret"] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).send("Forbidden");

  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE");
    return res.status(405).send("Method not allowed");
  }

  const conversationId = req.query.conversationId || (req.body && req.body.conversationId);
  if (!conversationId) return res.status(400).send("conversationId required");

  try {
    const r = await db.query(
      `DELETE FROM conversations WHERE id = $1 RETURNING id`,
      [conversationId]
    );
    if (!r.rowCount) return res.status(404).send("Not found");
    // messages are removed automatically via ON DELETE CASCADE
    return res.status(204).end();
  } catch (e) {
    console.error("admin delete-conversation:", e);
    return res.status(500).send("Server error");
  }
}