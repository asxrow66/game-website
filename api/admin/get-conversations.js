import db from "../../db.js";
export default async function handler(req, res) {
  const secret = req.headers["x-admin-secret"] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).send("Forbidden");
  const { rows } = await db.query(
    `SELECT id, owner_id, title, created_at, last_updated
     FROM conversations ORDER BY last_updated DESC LIMIT 500`);
  res.json({ conversations: rows });
}
