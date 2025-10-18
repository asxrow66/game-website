// api/admin/storage.js
import db from "../../db.js";

export default async function handler(req, res) {
  try {
    // ✅ Validate secret
    const secret = req.headers["x-admin-secret"];
    if (secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // ✅ Get total database size
    const sizeQuery = `
      SELECT
        pg_database_size(current_database()) AS db_size;
    `;
    const result = await db.query(sizeQuery);
    const used_bytes = parseInt(result.rows[0].db_size, 10);
    const used_mb = +(used_bytes / (1024 * 1024)).toFixed(2);

    // ✅ Check for optional quota
    const quota_mb = process.env.STORAGE_QUOTA_MB
      ? parseFloat(process.env.STORAGE_QUOTA_MB)
      : null;

    const percent_used = quota_mb
      ? Math.min(100, (used_mb / quota_mb) * 100)
      : null;

    const remaining_mb = quota_mb
      ? Math.max(0, quota_mb - used_mb).toFixed(2)
      : null;

    res.json({
      used_bytes,
      used_mb,
      quota_mb,
      remaining_mb,
      percent_used,
    });
  } catch (err) {
    console.error("Error fetching storage:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}