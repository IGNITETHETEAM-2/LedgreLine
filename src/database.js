import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ledger_users (
    id UUID PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP'))
  );
  CREATE TABLE IF NOT EXISTS ledger_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES ledger_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ledger_sessions_expiry_idx
    ON ledger_sessions (expires_at);
  CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES ledger_users(id) ON DELETE CASCADE,
    description VARCHAR(80) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category TEXT NOT NULL,
    amount NUMERIC(11, 2) NOT NULL CHECK (amount > 0),
    transaction_date DATE NOT NULL,
    note VARCHAR(280) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES ledger_users(id) ON DELETE CASCADE;
  CREATE INDEX IF NOT EXISTS transactions_user_date_idx
    ON transactions (user_id, transaction_date DESC, created_at DESC);
`;

export function createDatabase(connectionString) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to start LedgerLine.");
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  return {
    async initialize() {
      await pool.query(SCHEMA);
      await pool.query("DELETE FROM ledger_sessions WHERE expires_at <= NOW()");
    },

    async health() {
      await pool.query("SELECT 1");
    },

    async createUser(user) {
      const result = await pool.query(
        `INSERT INTO ledger_users (id, email, password_salt, password_hash, currency)
         VALUES ($1, $2, $3, $4, 'INR')
         RETURNING id, email`,
        [randomUUID(), user.email, user.passwordSalt, user.passwordHash],
      );
      return result.rows[0];
    },

    async getUserByEmail(email) {
      const result = await pool.query(
        `SELECT id, email, password_salt AS "passwordSalt", password_hash AS "passwordHash"
         FROM ledger_users WHERE email = $1`,
        [email],
      );
      return result.rows[0] ?? null;
    },

    async createSession(userId, tokenHash, expiresAt) {
      await pool.query(
        `INSERT INTO ledger_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [tokenHash, userId, expiresAt],
      );
    },

    async getSessionUser(tokenHash) {
      const result = await pool.query(
        `SELECT users.id, users.email
         FROM ledger_sessions AS sessions
         JOIN ledger_users AS users ON users.id = sessions.user_id
         WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
        [tokenHash],
      );
      return result.rows[0] ?? null;
    },

    async deleteSession(tokenHash) {
      await pool.query("DELETE FROM ledger_sessions WHERE token_hash = $1", [tokenHash]);
    },

    async getState(userId) {
      const [preferences, rows] = await Promise.all([
        pool.query("SELECT currency FROM ledger_users WHERE id = $1", [userId]),
        pool.query(`
          SELECT
            id,
            description,
            type,
            category,
            amount::float8 AS amount,
            to_char(transaction_date, 'YYYY-MM-DD') AS date,
            note
          FROM transactions WHERE user_id = $1
          ORDER BY transaction_date DESC, created_at DESC, id DESC
        `, [userId]),
      ]);

      if (preferences.rowCount !== 1) {
        throw new Error("The authenticated user could not be found.");
      }

      return {
        version: 1,
        currency: preferences.rows[0].currency,
        transactions: rows.rows,
      };
    },

    async setCurrency(userId, currency) {
      const result = await pool.query(
        `UPDATE ledger_users SET currency = $2 WHERE id = $1 RETURNING currency`,
        [userId, currency],
      );
      if (result.rowCount !== 1) {
        throw new Error("The authenticated user could not be found.");
      }
      return result.rows[0].currency;
    },

    async createTransaction(userId, value) {
      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO transactions
          (id, user_id, description, type, category, amount, transaction_date, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
          id,
          description,
          type,
          category,
          amount::float8 AS amount,
          to_char(transaction_date, 'YYYY-MM-DD') AS date,
          note`,
        [
          id,
          userId,
          value.description,
          value.type,
          value.category,
          value.amount,
          value.date,
          value.note,
        ],
      );
      return result.rows[0];
    },

    async updateTransaction(userId, id, value) {
      const result = await pool.query(
        `UPDATE transactions
         SET description = $2, type = $3, category = $4, amount = $5,
             transaction_date = $6, note = $7
         WHERE id = $1 AND user_id = $8
         RETURNING
          id,
          description,
          type,
          category,
          amount::float8 AS amount,
          to_char(transaction_date, 'YYYY-MM-DD') AS date,
          note`,
        [
          id,
          value.description,
          value.type,
          value.category,
          value.amount,
          value.date,
          value.note,
          userId,
        ],
      );
      return result.rows[0] ?? null;
    },

    async deleteTransaction(userId, id) {
      const result = await pool.query(
        "DELETE FROM transactions WHERE id = $1 AND user_id = $2",
        [id, userId],
      );
      return result.rowCount > 0;
    },

    async close() {
      await pool.end();
    },
  };
}
