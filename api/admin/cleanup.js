// api/admin/cleanup.js
// Deletes conversations older than a cutoff interval.
// - Cron (x-vercel-cron header) ALWAYS uses 14 days.
// - Manual admin calls can override using:
//     GET  /api/admin/cleanup?cutoff=14d
//     POST /api/admin/cleanup  { "cutoff": "14d" }
// Also supports legacy `days` (number of days).

import db from "../../db.js";

// Accepts strings like "14d", "12h", "9m", "6s" (single unit)
function parseCutoffString(raw) {
  if (raw == null) return null;
  const str = String(raw).trim().toLowerCase();

  // Legacy numeric-only => interpret as days
  if (/^\d+$/.test(str)) {
    return { intervalText: `${str} days`, label: `${str}d` };
  }

  const m = str.match(/^(\d+)\s*([dhms])$/);
  if (!m) return null;

  const n = parseInt(m[1], 10);
  const unit = m[2]; // d,h,m,s

  if (!Number.isFinite(n) || n < 1) return null;

  const unitMap = {
    d: { interval: "days", label: "d" },
    h: { interval: "hours", label: "h" },
    m: { interval: "minutes", label: "m" },
    s: { interval: "seconds", label: "s" },
  };
  const u = unitMap[unit];
  if (!u) return null;

  return { intervalText: `${n} ${u.interval}`, label: `${n}${u.label}` };
}

function isAuthorized(req) {
  const fromCron = !!req.headers["x-vercel-cron"];
  const secret = req.headers["x-admin-secret"] || req.query.secret;
  const okSecret = secret && secret === process.env.ADMIN_SECRET;
  return fromCron || okSecret;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(403).send("Forbidden");

  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method not allowed");
  }

  try {
    // Default: cron always uses 14 days
    let cutoff = { intervalText: "14 days", label: "14d" };

    // Manual override allowed only if NOT cron
    if (!req.headers["x-vercel-cron"]) {
      let rawCutoff = null;

      if (req.method === "GET") {
        rawCutoff = req.query.cutoff ?? req.query.days; // days still supported
      } else {
        const body = req.body || {};
        rawCutoff = body.cutoff ?? body.days;
      }

      const parsed = parseCutoffString(rawCutoff);
      if (parsed) cutoff = parsed;
    }

    const { rows } = await db.query(
      `WITH deleted AS (
         DELETE FROM conversations
          WHERE last_updated < now() - ($1)::interval
          RETURNING id
       )
       SELECT count(*)::int AS count FROM deleted`,
      [cutoff.intervalText]
    );

    const count = rows?.[0]?.count ?? 0;
    return res.status(200).json({
      deleted: count,
      cutoff_label: cutoff.label,
      cutoff_interval: cutoff.intervalText
    });
  } catch (e) {
    console.error("admin cleanup:", e);
    return res.status(500).send("Server error");
  }
}