// db.js
import pg from "pg";
const { Pool } = pg;

// Create a connection pool to your Postgres database (Neon works great)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Neon
});

// Export a simple query helper
export default {
  query: (text, params) => pool.query(text, params),
};