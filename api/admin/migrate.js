import db from "../../db.js";

const SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text,
  title text,
  created_at timestamptz DEFAULT now(),
  last_updated timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,                -- 'user' | 'assistant' | 'system'
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  ip_address text,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS conv_owner_idx ON conversations(owner_id, last_updated DESC);
CREATE INDEX IF NOT EXISTS msg_conv_created_idx ON messages(conversation_id, created_at);
`;

export default async function handler(req, res) {
  const secret = req.headers["x-admin-secret"] || req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).send("Forbidden");
  try {
    await db.query(SQL);
    res.status(200).send("OK: migrations applied");
  } catch (e) {
    console.error(e);
    res.status(500).send("Migration failed");
  }
}
