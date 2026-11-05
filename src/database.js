import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ledger_preferences (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP'))
  );
  INSERT INTO ledger_preferences (singleton, currency)
  VALUES (TRUE, 'INR')
  ON CONFLICT (singleton) DO NOTHING;
  CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY,
    description VARCHAR(80) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category TEXT NOT NULL,
    amount NUMERIC(11, 2) NOT NULL CHECK (amount > 0),
    transaction_date DATE NOT NULL,
    note VARCHAR(280) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS transactions_date_idx
    ON transactions (transaction_date DESC, created_at DESC);
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
    },

    async getState() {
      const [preferences, rows] = await Promise.all([
        pool.query("SELECT currency FROM ledger_preferences WHERE singleton = TRUE"),
        pool.query(`
          SELECT
            id,
            description,
            type,
            category,
            amount::float8 AS amount,
            to_char(transaction_date, 'YYYY-MM-DD') AS date,
            note
          FROM transactions
          ORDER BY transaction_date DESC, created_at DESC, id DESC
        `),
      ]);

      if (preferences.rowCount !== 1) {
        throw new Error("Ledger preferences have not been initialized.");
      }

      return {
        version: 1,
        currency: preferences.rows[0].currency,
        transactions: rows.rows,
      };
    },

    async setCurrency(currency) {
      const result = await pool.query(
        `UPDATE ledger_preferences SET currency = $1 WHERE singleton = TRUE RETURNING currency`,
        [currency],
      );
      if (result.rowCount !== 1) {
        throw new Error("Ledger preferences have not been initialized.");
      }
      return result.rows[0].currency;
    },

    async createTransaction(value) {
      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO transactions
          (id, description, type, category, amount, transaction_date, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
          id,
          description,
          type,
          category,
          amount::float8 AS amount,
          to_char(transaction_date, 'YYYY-MM-DD') AS date,
          note`,
        [id, value.description, value.type, value.category, value.amount, value.date, value.note],
      );
      return result.rows[0];
    },

    async updateTransaction(id, value) {
      const result = await pool.query(
        `UPDATE transactions
         SET description = $2, type = $3, category = $4, amount = $5,
             transaction_date = $6, note = $7
         WHERE id = $1
         RETURNING
          id,
          description,
          type,
          category,
          amount::float8 AS amount,
          to_char(transaction_date, 'YYYY-MM-DD') AS date,
          note`,
        [id, value.description, value.type, value.category, value.amount, value.date, value.note],
      );
      return result.rows[0] ?? null;
    },

    async deleteTransaction(id) {
      const result = await pool.query("DELETE FROM transactions WHERE id = $1", [id]);
      return result.rowCount > 0;
    },

    async close() {
      await pool.end();
    },
  };
}
