import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/database.js";
import { createRequestHandler } from "../src/http.js";

function createMemoryRepository() {
  const users = new Map();
  const sessions = new Map();
  const currencies = new Map();
  const transactions = [];

  return {
    async health() {},
    async createUser(value) {
      if (users.has(value.email)) {
        const error = new Error("Duplicate email");
        error.code = "23505";
        throw error;
      }
      const user = { id: randomUUID(), ...value };
      users.set(user.email, user);
      currencies.set(user.id, "INR");
      return { id: user.id, email: user.email };
    },
    async getUserByEmail(email) {
      return users.get(email) ?? null;
    },
    async createSession(userId, tokenHash) {
      sessions.set(tokenHash, [...users.values()].find((user) => user.id === userId));
    },
    async getSessionUser(tokenHash) {
      const user = sessions.get(tokenHash);
      return user ? { id: user.id, email: user.email } : null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async getState(userId) {
      return {
        version: 1,
        currency: currencies.get(userId),
        transactions: transactions
          .filter((transaction) => transaction.userId === userId)
          .map(({ userId: _userId, ...transaction }) => transaction)
          .sort((left, right) =>
            right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
          ),
      };
    },
    async setCurrency(userId, value) {
      currencies.set(userId, value);
      return value;
    },
    async createTransaction(userId, value) {
      const transaction = { id: randomUUID(), userId, ...value };
      transactions.push(transaction);
      const { userId: _userId, ...result } = transaction;
      return result;
    },
    async updateTransaction(userId, id, value) {
      const index = transactions.findIndex(
        (transaction) => transaction.id === id && transaction.userId === userId,
      );
      if (index === -1) {
        return null;
      }
      transactions[index] = { id, userId, ...value };
      const { userId: _userId, ...result } = transactions[index];
      return result;
    },
    async deleteTransaction(userId, id) {
      const index = transactions.findIndex(
        (transaction) => transaction.id === id && transaction.userId === userId,
      );
      if (index === -1) {
        return false;
      }
      transactions.splice(index, 1);
      return true;
    },
  };
}

async function createAccount(baseUrl, email = "test@example.com", password = "securepass123") {
  const response = await fetch(`${baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie")?.match(/ledgerline_session=[^;]+/)?.[0];
  assert.ok(cookie);
  return cookie;
}

function authHeaders(cookie, additional = {}) {
  return { ...additional, Cookie: cookie };
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
    const pageBody = await page.text();
    assert.match(pageBody, /Create your account/);
    assert.match(pageBody, /auth-mode-toggle/);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");

    const secret = await fetch(`${baseUrl}/package.json`);
    assert.equal(secret.status, 404);
  });
});

test("requires authentication and isolates transaction data by account", async () => {
  await withServer(async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/state`);
    assert.equal(unauthenticated.status, 401);

    const firstCookie = await createAccount(baseUrl);
    const secondCookie = await createAccount(baseUrl, "other@example.com");
    const createdResponse = await fetch(`${baseUrl}/api/transactions`, {
      method: "POST",
      headers: authHeaders(firstCookie, { "Content-Type": "application/json" }),
      body: JSON.stringify(validInput),
    });
    assert.equal(createdResponse.status, 201);
    const { transaction } = await createdResponse.json();
    assert.match(transaction.id, /^[0-9a-f-]{36}$/i);
    assert.equal(transaction.description, "Test entry");

    const stateResponse = await fetch(`${baseUrl}/api/state`, {
      headers: authHeaders(firstCookie),
    });
    assert.deepEqual((await stateResponse.json()).transactions, [transaction]);

    const updateResponse = await fetch(`${baseUrl}/api/transactions/${transaction.id}`, {
      method: "PUT",
      headers: authHeaders(secondCookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({ ...validInput, description: "Updated entry" }),
    });
    assert.equal(updateResponse.status, 404);
    assert.deepEqual(
      (await (await fetch(`${baseUrl}/api/state`, { headers: authHeaders(secondCookie) })).json())
        .transactions,
      [],
    );

    const deleteResponse = await fetch(`${baseUrl}/api/transactions/${transaction.id}`, {
      method: "DELETE",
      headers: authHeaders(secondCookie),
    });
    assert.equal(deleteResponse.status, 404);

    const ownerUpdate = await fetch(`${baseUrl}/api/transactions/${transaction.id}`, {
      method: "PUT",
      headers: authHeaders(firstCookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({ ...validInput, description: "Updated entry" }),
    });
    assert.equal(ownerUpdate.status, 200);
    assert.equal((await ownerUpdate.json()).transaction.description, "Updated entry");

    const ownerDelete = await fetch(`${baseUrl}/api/transactions/${transaction.id}`, {
      method: "DELETE",
      headers: authHeaders(firstCookie),
    });
    assert.equal(ownerDelete.status, 204);
    assert.deepEqual(
      (await (await fetch(`${baseUrl}/api/state`, { headers: authHeaders(firstCookie) })).json())
        .transactions,
      [],
    );
  });
});

test("validates request bodies and persists currency preference", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await createAccount(baseUrl);
    const invalid = await fetch(`${baseUrl}/api/transactions`, {
      method: "POST",
      headers: authHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({ ...validInput, amount: -1 }),
    });
    assert.equal(invalid.status, 400);

    const wrongType = await fetch(`${baseUrl}/api/currency`, {
      method: "PATCH",
      headers: authHeaders(cookie, { "Content-Type": "text/plain" }),
      body: '{"currency":"USD"}',
    });
    assert.equal(wrongType.status, 415);

    const currency = await fetch(`${baseUrl}/api/currency`, {
      method: "PATCH",
      headers: authHeaders(cookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({ currency: "USD" }),
    });
    assert.equal(currency.status, 200);
    assert.equal((await currency.json()).currency, "USD");
    assert.equal(
      (await (await fetch(`${baseUrl}/api/state`, { headers: authHeaders(cookie) })).json())
        .currency,
      "USD",
    );
  });
});

test("rejects malformed JSON and returns readiness health", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await createAccount(baseUrl);
    const malformed = await fetch(`${baseUrl}/api/currency`, {
      method: "PATCH",
      headers: authHeaders(cookie, { "Content-Type": "application/json" }),
      body: "{invalid",
    });
    assert.equal(malformed.status, 400);

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
  });
});

test("registers, logs in, rejects duplicate or invalid credentials, and signs out", async () => {
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bad-email", password: "short" }),
    });
    assert.equal(invalid.status, 400);

    const cookie = await createAccount(baseUrl, "  User@Example.com  ");
    const duplicate = await fetch(`${baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "securepass123" }),
    });
    assert.equal(duplicate.status, 409);

    const wrongPassword = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "wrongpass123" }),
    });
    assert.equal(wrongPassword.status, 401);

    const login = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "USER@example.com", password: "securepass123" }),
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie")?.match(/ledgerline_session=[^;]+/)?.[0];
    assert.ok(loginCookie);
    const session = await fetch(`${baseUrl}/api/session`, {
      headers: authHeaders(loginCookie),
    });
    const sessionBody = await session.json();
    assert.match(sessionBody.user.id, /^[0-9a-f-]{36}$/i);
    assert.equal(sessionBody.user.email, "user@example.com");
    assert.equal(
      (await (await fetch(`${baseUrl}/api/state`, { headers: authHeaders(cookie) })).json())
        .transactions.length,
      0,
    );

    const logout = await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: authHeaders(loginCookie),
    });
    assert.equal(logout.status, 204);
    const expiredSession = await fetch(`${baseUrl}/api/session`, {
      headers: authHeaders(loginCookie),
    });
    assert.deepEqual(await expiredSession.json(), { user: null });
  });
});
