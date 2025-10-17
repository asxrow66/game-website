import db from "../db.js";

function anon(req) {
  return req.headers["x-anon-id"] || req.query.anonId || (req.body && req.body.anonId);
}

export default async function handler(req, res) {
  const anonId = anon(req);
  if (!anonId) return res.status(400).send("Missing anonId");

  try {
    if (req.method === "GET") {
      const { rows } = await db.query(
        `SELECT id, title, created_at, last_updated
         FROM conversations WHERE owner_id = $1
         ORDER BY last_updated DESC LIMIT 100`, [anonId]);
      return res.json({ conversations: rows });
    }

    if (req.method === "POST") {
      const { title } = req.body || {};
      const t = (title || "New chat").slice(0,200);
      const r = await db.query(
        `INSERT INTO conversations(title, owner_id) VALUES($1,$2)
         RETURNING id, title, created_at, last_updated`, [t, anonId]);
      return res.status(201).json(r.rows[0]);
    }

    if (req.method === "PATCH") {
      const { conversationId, title } = req.body || {};
      if (!conversationId || !title) return res.status(400).send("conversationId and title required");
      const r = await db.query(
        `UPDATE conversations SET title=$1, last_updated=now()
         WHERE id=$2 AND owner_id=$3
         RETURNING id, title, last_updated`, [title.slice(0,200), conversationId, anonId]);
      if (!r.rowCount) return res.status(404).send("Not found");
      return res.json(r.rows[0]);
    }

    if (req.method === "DELETE") {
      const { conversationId } = req.body || {};
      if (!conversationId) return res.status(400).send("conversationId required");
      const r = await db.query(
        `DELETE FROM conversations WHERE id=$1 AND owner_id=$2`, [conversationId, anonId]);
      if (!r.rowCount) return res.status(404).send("Not found");
      return res.status(204).end();
    }

    res.setHeader("Allow","GET, POST, PATCH, DELETE");
    res.status(405).send("Method not allowed");
  } catch (e) {
    console.error("conversations:", e);
    res.status(500).send("Server error");
  }
}
