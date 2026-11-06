import {
  CATEGORIES,
  CURRENCY_CODES,
  INITIAL_STATE,
  calculateSummary,
  filterTransactions,
  formatMoney,
  getLocalDate,
  validateState,
  validateTransaction,
} from "./ledger.js";

const elements = {
  add: document.querySelector("#add-transaction"),
  appShell: document.querySelector("#app-shell"),
  appMessage: document.querySelector("#app-message"),
  appMessageText: document.querySelector("#app-message-text"),
  amount: document.querySelector("#amount"),
  authCopy: document.querySelector("#auth-copy"),
  authEmail: document.querySelector("#auth-email"),
  authError: document.querySelector("#auth-error"),
  authForm: document.querySelector("#auth-form"),
  authPassword: document.querySelector("#auth-password"),
  authScreen: document.querySelector("#auth-screen"),
  authSubmit: document.querySelector("#auth-submit"),
  authSwitchCopy: document.querySelector("#auth-switch-copy"),
  authTitle: document.querySelector("#auth-title"),
  authToggle: document.querySelector("#auth-mode-toggle"),
  accountEmail: document.querySelector("#account-email"),
  balance: document.querySelector("#balance-total"),
  category: document.querySelector("#category"),
  closeDialog: document.querySelector("#close-dialog"),
  currency: document.querySelector("#currency"),
  date: document.querySelector("#date"),
  description: document.querySelector("#description"),
  dialog: document.querySelector("#transaction-dialog"),
  dialogTitle: document.querySelector("#dialog-title"),
  emptyAdd: document.querySelector("#empty-add"),
  emptyCopy: document.querySelector("#empty-copy"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  expense: document.querySelector("#expense-total"),
  form: document.querySelector("#transaction-form"),
  formError: document.querySelector("#form-error"),
  income: document.querySelector("#income-total"),
  note: document.querySelector("#note"),
  retry: document.querySelector("#retry-load"),
  rows: document.querySelector("#transaction-rows"),
  search: document.querySelector("#search"),
  signOut: document.querySelector("#sign-out"),
  transactionCount: document.querySelector("#transaction-count"),
  transactionType: document.querySelector("#transaction-type"),
  typeFilter: document.querySelector("#type-filter"),
};

let state = { ...INITIAL_STATE, transactions: [] };
let editingId = null;
let storageReady = false;
let authMode = "register";

setControlsDisabled(true);
void checkSession();

elements.authForm.addEventListener("submit", onAuthSubmit);
elements.authToggle.addEventListener("click", toggleAuthMode);
elements.signOut.addEventListener("click", () => void signOut());
elements.add.addEventListener("click", () => openDialog());
elements.emptyAdd.addEventListener("click", () => openDialog());
elements.closeDialog.addEventListener("click", closeDialog);
document.querySelector("#cancel-dialog").addEventListener("click", closeDialog);
elements.transactionType.addEventListener("change", populateCategories);
elements.form.addEventListener("submit", onSubmit);
elements.search.addEventListener("input", renderTransactions);
elements.typeFilter.addEventListener("change", renderTransactions);
elements.currency.addEventListener("change", onCurrencyChange);
elements.retry.addEventListener("click", () => void initialize());

async function checkSession() {
  try {
    const result = await requestJson("/api/session");
    if (result.user) {
      showApplication(result.user);
      await initialize();
    } else {
      showAuthentication();
    }
  } catch (error) {
    showAuthentication();
    showAuthError(`Could not check your sign-in: ${error.message}`);
  }
}

async function onAuthSubmit(event) {
  event.preventDefault();
  elements.authError.hidden = true;
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  if (!email || !password) {
    showAuthError("Enter your email and password.");
    return;
  }

  setAuthBusy(true);
  try {
    const action = authMode === "register" ? "register" : "login";
    const result = await requestJson(`/api/${action}`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    elements.authPassword.value = "";
    showApplication(result.user);
    await initialize();
  } catch (error) {
    showAuthError(error.message);
  } finally {
    setAuthBusy(false);
  }
}

function toggleAuthMode() {
  authMode = authMode === "register" ? "login" : "register";
  const registering = authMode === "register";
  elements.authTitle.textContent = registering ? "Create your account" : "Welcome back";
  elements.authCopy.textContent = registering
    ? "Sign up to start your private personal ledger."
    : "Log in to continue to your personal ledger.";
  elements.authSubmit.textContent = registering ? "Create account" : "Log in";
  elements.authSwitchCopy.textContent = registering
    ? "Already have an account?"
    : "New to LedgerLine?";
  elements.authToggle.textContent = registering ? "Log in" : "Sign up";
  elements.authPassword.autocomplete = registering ? "new-password" : "current-password";
  elements.authPassword.placeholder = registering
    ? "At least 8 characters"
    : "Enter your password";
  elements.authError.hidden = true;
}

function setAuthBusy(busy) {
  elements.authSubmit.disabled = busy;
  elements.authToggle.disabled = busy;
  elements.authEmail.disabled = busy;
  elements.authPassword.disabled = busy;
  elements.authSubmit.textContent = busy
    ? "Please wait..."
    : authMode === "register"
      ? "Create account"
      : "Log in";
}

function showAuthentication() {
  elements.appShell.hidden = true;
  elements.authScreen.hidden = false;
  elements.authEmail.focus();
}

function showApplication(user) {
  elements.authScreen.hidden = true;
  elements.appShell.hidden = false;
  elements.accountEmail.textContent = user.email;
}

function showAuthError(message) {
  elements.authError.textContent = message;
  elements.authError.hidden = false;
}

async function signOut() {
  elements.signOut.disabled = true;
  try {
    await requestJson("/api/logout", { method: "POST" });
    state = { ...INITIAL_STATE, transactions: [] };
    storageReady = false;
    elements.authForm.reset();
    authMode = "login";
    toggleAuthMode();
    showAuthentication();
  } catch (error) {
    showMessage(`Could not sign out: ${error.message}`);
  } finally {
    elements.signOut.disabled = false;
  }
}

async function initialize() {
  setControlsDisabled(true);
  showMessage("Connecting to your private ledger...", "info", 0);

  try {
    state = validateState(await requestJson("/api/state"));
    storageReady = true;
    elements.currency.value = state.currency;
    populateCategories();
    setControlsDisabled(false);
    elements.appMessage.hidden = true;
    render();
  } catch (error) {
    storageReady = false;
    elements.emptyTitle.textContent = "Could not connect to the database";
    elements.emptyCopy.textContent = "Retry the connection to load your ledger.";
    elements.emptyAdd.hidden = true;
    showMessage(`Could not load your ledger: ${error.message}`, "error", 0, true);
  }
}

function setControlsDisabled(disabled) {
  elements.add.disabled = disabled;
  elements.emptyAdd.disabled = disabled;
  elements.currency.disabled = disabled;
}

function populateCategories(selectedCategory) {
  const previous = selectedCategory ?? elements.category.value;
  elements.category.replaceChildren();

  for (const category of CATEGORIES) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.category.append(option);
  }

  if (previous && CATEGORIES.includes(previous)) {
    elements.category.value = previous;
  }
}

function openDialog(transaction = null) {
  if (!storageReady) {
    return;
  }
  editingId = transaction?.id ?? null;
  elements.form.reset();
  elements.dialogTitle.textContent = editingId ? "Edit transaction" : "Add transaction";
  elements.description.value = transaction?.description ?? "";
  elements.transactionType.value = transaction?.type ?? "expense";
  populateCategories(transaction?.category);
  elements.amount.value = transaction?.amount ?? "";
  elements.date.value = transaction?.date ?? getLocalDate();
  elements.note.value = transaction?.note ?? "";
  elements.formError.hidden = true;
  elements.formError.textContent = "";
  elements.dialog.showModal();
  elements.description.focus();
}

function closeDialog() {
  elements.dialog.close();
}

async function onSubmit(event) {
  event.preventDefault();
  if (!storageReady) {
    return;
  }

  const result = validateTransaction({
    description: elements.description.value,
    type: elements.transactionType.value,
    category: elements.category.value,
    amount: elements.amount.value,
    date: elements.date.value,
    note: elements.note.value,
  });

  if (!result.ok) {
    showFormError(Object.values(result.errors)[0]);
    return;
  }

  try {
    const editing = editingId !== null;
    const path = editing
      ? `/api/transactions/${encodeURIComponent(editingId)}`
      : "/api/transactions";
    const resultBody = await requestJson(path, {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(result.value),
    });
    const transaction = resultBody.transaction;
    state = {
      ...state,
      transactions: editing
        ? state.transactions.map((item) =>
            item.id === transaction.id ? transaction : item,
          )
        : [transaction, ...state.transactions],
    };
    closeDialog();
    render();
    showMessage(editing ? "Transaction updated." : "Transaction added.", "success");
  } catch (error) {
    showFormError(`Could not save your transaction: ${error.message}`);
  }
}

async function onCurrencyChange() {
  if (!storageReady || !CURRENCY_CODES.includes(elements.currency.value)) {
    elements.currency.value = state.currency;
    return;
  }

  const currency = elements.currency.value;
  elements.currency.disabled = true;
  try {
    const result = await requestJson("/api/currency", {
      method: "PATCH",
      body: JSON.stringify({ currency }),
    });
    state = { ...state, currency: result.currency };
    render();
  } catch (error) {
    elements.currency.value = state.currency;
    showMessage(`Could not save currency preference: ${error.message}`);
  } finally {
    elements.currency.disabled = false;
  }
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  let result;
  try {
    result = response.status === 204 ? {} : await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(result.error ?? `Request failed (${response.status}).`);
  }
  return result;
}

function render() {
  const summary = calculateSummary(state.transactions);
  elements.balance.textContent = formatMoney(summary.balance, state.currency);
  elements.income.textContent = formatMoney(summary.income, state.currency);
  elements.expense.textContent = formatMoney(summary.expenses, state.currency);
  elements.transactionCount.textContent = `${summary.count} ${
    summary.count === 1 ? "entry" : "entries"
  }`;
  renderTransactions();
}

function renderTransactions() {
  const filtered = filterTransactions(state.transactions, {
    query: elements.search.value,
    type: elements.typeFilter.value,
  });

  elements.rows.replaceChildren();
  for (const transaction of filtered) {
    elements.rows.append(createRow(transaction));
  }

  const hasMatches = filtered.length > 0;
  elements.emptyState.hidden = hasMatches;
  if (!hasMatches) {
    const hasTransactions = state.transactions.length > 0;
    elements.emptyTitle.textContent = hasTransactions ? "No matching transactions" : "No transactions yet";
    elements.emptyCopy.textContent = hasTransactions
      ? "Try changing the search or type filter."
      : "Add your first entry to start keeping track.";
    elements.emptyAdd.hidden = hasTransactions || !storageReady;
  }
}

function createRow(transaction) {
  const row = document.createElement("tr");
  appendCell(row, formatDate(transaction.date));
  appendCell(row, transaction.description, "description-cell");
  appendCell(row, transaction.category, "category-cell");

  const typeCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `type-badge ${transaction.type}`;
  badge.textContent = transaction.type === "income" ? "Income" : "Expense";
  typeCell.append(badge);
  row.append(typeCell);

  const amountCell = document.createElement("td");
  amountCell.className = `amount-cell ${transaction.type}`;
  amountCell.textContent = `${transaction.type === "income" ? "+" : "−"}${formatMoney(
    transaction.amount,
    state.currency,
  )}`;
  row.append(amountCell);

  const actionCell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(
    createActionButton("Edit", () => openDialog(transaction)),
    createActionButton(
      "Delete",
      () => void deleteTransaction(transaction),
      "text-button delete",
    ),
  );
  actionCell.append(actions);
  row.append(actionCell);
  return row;
}

function appendCell(row, text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  row.append(cell);
}

function createActionButton(label, action, className = "text-button") {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

async function deleteTransaction(transaction) {
  if (!window.confirm(`Delete "${transaction.description}"? This cannot be undone.`)) {
    return;
  }

  try {
    await requestJson(`/api/transactions/${encodeURIComponent(transaction.id)}`, {
      method: "DELETE",
    });
    state = {
      ...state,
      transactions: state.transactions.filter((item) => item.id !== transaction.id),
    };
    render();
    showMessage("Transaction deleted.", "success");
  } catch (error) {
    showMessage(`Could not delete the transaction: ${error.message}`);
  }
}

function showFormError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = false;
}

function showMessage(message, kind = "error", duration = 5000, canRetry = false) {
  elements.appMessageText.textContent = message;
  elements.appMessage.className = `app-message ${kind}-message`;
  elements.appMessage.hidden = false;
  elements.retry.hidden = !canRetry;
  window.clearTimeout(showMessage.timeoutId);
  if (duration > 0) {
    showMessage.timeoutId = window.setTimeout(() => {
      elements.appMessage.hidden = true;
    }, duration);
  }
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
