// api/admin/search.js
import db from "../../db.js";

export default async function handler(req, res) {
  try {
    const headerSecret = (req.headers["x-admin-secret"] || "").trim();
    const envSecret = (process.env.ADMIN_SECRET || "").trim();
    if (!envSecret || headerSecret !== envSecret) return res.status(403).send("Forbidden");

    const q = (req.query.q || (req.body && req.body.q) || "").trim();
    if (!q) return res.status(400).json({ error: "Missing q" });

    // Split query into words; AND-match across words
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 6); // cap to avoid giant SQL
    if (!terms.length) return res.json({ results: [] });

    // Build parameter arrays for ILIKE
    const likeParams = terms.map(t => `%${t}%`);

    // 1) Title hits
    const titleWhere = terms.map((_, i) => `c.title ILIKE $${i + 1}`).join(" AND ");
    const titleSql = `
      SELECT c.id, c.title, c.last_updated
      FROM conversations c
      WHERE ${titleWhere}
      ORDER BY c.last_updated DESC
      LIMIT 300
    `;
    const titleRows = (await db.query(titleSql, likeParams)).rows;

    // 2) Message hits (distinct conversations)
    const msgWhere = terms.map((_, i) => `m.content ILIKE $${i + 1}`).join(" AND ");
    const msgSql = `
      SELECT DISTINCT c.id, c.title, c.last_updated
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      WHERE ${msgWhere}
      ORDER BY c.last_updated DESC
      LIMIT 300
    `;
    const msgRows = (await db.query(msgSql, likeParams)).rows;

    // Merge results, track where it matched
    const map = new Map();
    for (const r of titleRows) {
      map.set(r.id, { ...r, match: "title" });
    }
    for (const r of msgRows) {
      if (map.has(r.id)) {
        map.set(r.id, { ...map.get(r.id), match: map.get(r.id).match === "title" ? "both" : "messages" });
      } else {
        map.set(r.id, { ...r, match: "messages" });
      }
    }

    // Sort by last_updated desc (already mostly sorted)
    const results = Array.from(map.values()).sort(
      (a, b) => new Date(b.last_updated) - new Date(a.last_updated)
    ).slice(0, 300);

    res.json({ results });
  } catch (e) {
    console.error(e);
    res.status(500).send("Search failed");
  }
}