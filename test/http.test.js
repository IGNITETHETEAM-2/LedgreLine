import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/database.js";
import { createRequestHandler } from "../src/http.js";

function createMemoryRepository() {
  let currency = "INR";
  const transactions = [];

  return {
    async getState() {
      return {
        version: 1,
        currency,
        transactions: [...transactions].sort((left, right) =>
          right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
        ),
      };
    },
    async setCurrency(value) {
      currency = value;
      return currency;
    },
    async createTransaction(value) {
      const transaction = { id: randomUUID(), ...value };
      transactions.push(transaction);
      return transaction;
    },
    async updateTransaction(id, value) {
      const index = transactions.findIndex((transaction) => transaction.id === id);
      if (index === -1) {
        return null;
      }
      transactions[index] = { id, ...value };
      return transactions[index];
    },
    async deleteTransaction(id) {
      const index = transactions.findIndex((transaction) => transaction.id === id);
      if (index === -1) {
        return false;
      }
      transactions.splice(index, 1);
      return true;
    },
  };
}

async function withServer(run) {
  const server = createServer(createRequestHandler(createMemoryRepository(), {
    error() {},
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const validInput = {
  description: "Test entry",
  type: "expense",
  category: "Other",
  amount: 12.5,
  date: "2026-11-05",
  note: "",
};

test("requires a configured PostgreSQL connection string", () => {
  assert.throws(() => createDatabase(""), /DATABASE_URL is required/);
});

test("serves application files but not server-side files", async () => {
  await withServer(async (baseUrl) => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Public shared demo/);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");

    const secret = await fetch(`${baseUrl}/package.json`);
    assert.equal(secret.status, 404);
  });
});

test("creates, reads, updates, and deletes shared transactions", async () => {
  await withServer(async (baseUrl) => {
    const createdResponse = await fetch(`${baseUrl}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validInput),
    });
    assert.equal(createdResponse.status, 201);
    const { transaction } = await createdResponse.json();
    assert.match(transaction.id, /^[0-9a-f-]{36}$/i);
    assert.equal(transaction.description, "Test entry");

    const stateResponse = await fetch(`${baseUrl}/api/state`);
    assert.deepEqual((await stateResponse.json()).transactions, [transaction]);

    const updateResponse = await fetch(`${baseUrl}/api/transactions/${transaction.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validInput, description: "Updated entry" }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).transaction.description, "Updated entry");

    const deleteResponse = await fetch(`${baseUrl}/api/transactions/${transaction.id}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 204);
    assert.deepEqual((await (await fetch(`${baseUrl}/api/state`)).json()).transactions, []);
  });
});

test("validates request bodies and persists currency preference", async () => {
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validInput, amount: -1 }),
    });
    assert.equal(invalid.status, 400);

    const wrongType = await fetch(`${baseUrl}/api/currency`, {
      method: "PATCH",
      headers: { "Content-Type": "text/plain" },
      body: '{"currency":"USD"}',
    });
    assert.equal(wrongType.status, 415);

    const currency = await fetch(`${baseUrl}/api/currency`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency: "USD" }),
    });
    assert.equal(currency.status, 200);
    assert.equal((await currency.json()).currency, "USD");
    assert.equal((await (await fetch(`${baseUrl}/api/state`)).json()).currency, "USD");
  });
});

test("rejects malformed JSON and returns readiness health", async () => {
  await withServer(async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/api/currency`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{invalid",
    });
    assert.equal(malformed.status, 400);

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
  });
});
