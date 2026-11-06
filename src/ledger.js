export const CURRENCY_CODES = ["INR", "USD", "EUR", "GBP"];

export const CATEGORIES = [
  "Food & dining",
  "Transport",
  "Housing",
  "Utilities",
  "Shopping",
  "Health",
  "Education",
  "Salary",
  "Freelance",
  "Other income",
  "Other",
];

export const INITIAL_STATE = Object.freeze({
  version: 1,
  currency: "INR",
  transactions: [],
});

export function getLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function validateTransaction(input) {
  const errors = {};
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  const type = input.type;
  const category = input.category;
  const amount = Number(input.amount);
  const date = typeof input.date === "string" ? input.date : "";
  const note = typeof input.note === "string" ? input.note.trim() : "";

  if (!description) {
    errors.description = "Enter a description.";
  } else if (description.length > 80) {
    errors.description = "Description must be 80 characters or fewer.";
  }

  if (type !== "income" && type !== "expense") {
    errors.type = "Choose income or expense.";
  }

  if (!CATEGORIES.includes(category)) {
    errors.category = "Choose a listed category.";
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999.99) {
    errors.amount = "Enter an amount greater than 0 and no more than 999,999,999.99.";
  } else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
    errors.amount = "Amount can have no more than two decimal places.";
  }

  if (!isValidDate(date)) {
    errors.date = "Enter a valid date.";
  }

  if (note.length > 280) {
    errors.note = "Note must be 280 characters or fewer.";
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      description,
      type,
      category,
      amount: Math.round(amount * 100) / 100,
      date,
      note,
    },
  };
}

export function calculateSummary(transactions) {
  let income = 0;
  let expenses = 0;

  for (const transaction of transactions) {
    if (transaction.type === "income") {
      income += transaction.amount;
    } else {
      expenses += transaction.amount;
    }
  }

  return {
    income: roundMoney(income),
    expenses: roundMoney(expenses),
    balance: roundMoney(income - expenses),
    count: transactions.length,
  };
}

export function filterTransactions(transactions, { query = "", type = "all" } = {}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return transactions
    .filter((transaction) => type === "all" || transaction.type === type)
    .filter((transaction) => {
      if (!normalizedQuery) {
        return true;
      }

      return [
        transaction.description,
        transaction.category,
        transaction.note,
        transaction.date,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    })
    .sort((left, right) => {
      const byDate = right.date.localeCompare(left.date);
      return byDate || right.id.localeCompare(left.id);
    });
}

export function formatMoney(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function validateState(state) {
  if (
    !state ||
    state.version !== 1 ||
    !CURRENCY_CODES.includes(state.currency) ||
    !Array.isArray(state.transactions)
  ) {
    throw new Error("Your ledger returned an unsupported data format.");
  }

  const ids = new Set();
  const transactions = state.transactions.map((transaction) => {
    if (
      !transaction ||
      typeof transaction.id !== "string" ||
      transaction.id.length === 0 ||
      ids.has(transaction.id)
    ) {
      throw new Error("Your ledger contains an invalid transaction ID.");
    }

    const result = validateTransaction(transaction);
    if (!result.ok) {
      throw new Error("Your ledger contains an invalid transaction.");
    }

    ids.add(transaction.id);
    return { id: transaction.id, ...result.value };
  });

  return { version: 1, currency: state.currency, transactions };
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
