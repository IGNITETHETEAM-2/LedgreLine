import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateSummary,
  filterTransactions,
  getLocalDate,
  validateState,
  validateTransaction,
} from "../src/ledger.js";

const transactions = [
  {
    id: "income-1",
    description: "Monthly salary",
    type: "income",
    category: "Salary",
    amount: 2500,
    date: "2026-03-10",
    note: "March",
  },
  {
    id: "expense-1",
    description: "Groceries",
    type: "expense",
    category: "Food & dining",
    amount: 125.45,
    date: "2026-03-12",
    note: "",
  },
  {
    id: "expense-2",
    description: "Bus pass",
    type: "expense",
    category: "Transport",
    amount: 20,
    date: "2026-02-01",
    note: "",
  },
];

test("validates and normalizes a transaction", () => {
  const result = validateTransaction({
    description: "  Coffee  ",
    type: "expense",
    category: "Food & dining",
    amount: "3.5",
    date: "2026-04-15",
    note: "  With a friend  ",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    description: "Coffee",
    type: "expense",
    category: "Food & dining",
    amount: 3.5,
    date: "2026-04-15",
    note: "With a friend",
  });
});

test("rejects invalid amounts and impossible dates", () => {
  const result = validateTransaction({
    description: "Bad entry",
    type: "expense",
    category: "Other",
    amount: "0",
    date: "2026-02-30",
    note: "",
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.amount);
  assert.ok(result.errors.date);
});

test("calculates totals without floating point drift", () => {
  assert.deepEqual(
    calculateSummary([
      { type: "income", amount: 0.1 },
      { type: "income", amount: 0.2 },
      { type: "expense", amount: 0.1 },
    ]),
    { income: 0.3, expenses: 0.1, balance: 0.2, count: 3 },
  );
});

test("filters and sorts without changing the source array", () => {
  const source = [...transactions];
  const filtered = filterTransactions(source, { query: "food", type: "expense" });
  assert.deepEqual(
    filtered.map((transaction) => transaction.id),
    ["expense-1"],
  );
  assert.deepEqual(source, transactions);
  assert.deepEqual(
    filterTransactions(transactions).map((transaction) => transaction.id),
    ["expense-1", "income-1", "expense-2"],
  );
});

test("validates shared database state and rejects duplicate transaction IDs", () => {
  const state = {
    version: 1,
    currency: "USD",
    transactions: [transactions[0]],
  };
  assert.deepEqual(validateState(state), state);

  const duplicateState = { ...state, transactions: [transactions[0], transactions[0]] };
  assert.throws(
    () => validateState(duplicateState),
    /invalid transaction ID/,
  );
});

test("formats a local calendar date without converting it to UTC", () => {
  assert.match(getLocalDate(new Date(2026, 0, 2, 23, 30)), /^2026-01-02$/);
});
