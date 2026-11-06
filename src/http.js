import { readFile, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "./auth.js";
import { CURRENCY_CODES, validateTransaction } from "./ledger.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_BODY_BYTES = 16 * 1024;
const SESSION_COOKIE = "ledgerline_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/src/app.js", "src/app.js"],
  ["/src/ledger.js", "src/ledger.js"],
]);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

export function createRequestHandler(repository, logger = console) {
  return async (request, response) => {
    setSecurityHeaders(response);

    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      sendJson(response, 400, { error: "Invalid request URL." });
      return;
    }

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url.pathname, repository);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end("Method not allowed");
        return;
      }

      await handleStatic(request, response, url.pathname);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }

      logger.error("Request failed:", error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: "The request could not be completed." });
      } else {
        response.destroy();
      }
    }
  };
}

async function handleApi(request, response, pathname, repository) {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin && !isSameOrigin(origin, request.headers.host)) {
      throw new HttpError(403, "Cross-origin requests are not allowed.");
    }
  }

  if (pathname === "/api/health") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET" });
      return;
    }
    await repository.health();
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (pathname === "/api/register") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "POST" });
      return;
    }

    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const password = validatePassword(body.password, true);
    if (!isValidEmail(email)) {
      throw new HttpError(400, "Enter a valid email address.");
    }
    if (password !== null) {
      throw new HttpError(400, password);
    }

    const credentials = await hashPassword(body.password);
    let user;
    try {
      user = await repository.createUser({
        email,
        passwordSalt: credentials.salt,
        passwordHash: credentials.hash,
      });
    } catch (error) {
      if (error.code === "23505") {
        throw new HttpError(409, "An account with this email already exists.");
      }
      throw error;
    }
    await startSession(request, response, repository, user);
    sendJson(response, 201, { user: publicUser(user) });
    return;
  }

  if (pathname === "/api/login") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "POST" });
      return;
    }

    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email) || typeof body.password !== "string" || body.password.length > 128) {
      throw new HttpError(401, "Email or password is incorrect.");
    }
    const user = await repository.getUserByEmail(email);
    const valid = user
      ? await verifyPassword(body.password, user.passwordSalt, user.passwordHash)
      : await verifyPassword(body.password, "00000000000000000000000000000000", "00".repeat(64));
    if (!user || !valid) {
      throw new HttpError(401, "Email or password is incorrect.");
    }
    await startSession(request, response, repository, user);
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (pathname === "/api/session") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET" });
      return;
    }
    const user = await getCurrentUser(request, repository);
    sendJson(response, 200, { user: user ? publicUser(user) : null });
    return;
  }

  if (pathname === "/api/logout") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "POST" });
      return;
    }
    const token = getSessionToken(request);
    if (token) {
      await repository.deleteSession(hashSessionToken(token));
    }
    clearSessionCookie(request, response);
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  const user = await requireUser(request, repository);
  if (pathname === "/api/state") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET" });
      return;
    }
    sendJson(response, 200, await repository.getState(user.id));
    return;
  }

  if (pathname === "/api/currency") {
    if (request.method !== "PATCH") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "PATCH" });
      return;
    }
    const body = await readJson(request);
    if (!CURRENCY_CODES.includes(body.currency)) {
      throw new HttpError(400, "Choose a supported currency.");
    }
    sendJson(response, 200, { currency: await repository.setCurrency(user.id, body.currency) });
    return;
  }

  if (pathname === "/api/transactions") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "POST" });
      return;
    }
    const result = validateTransaction(await readJson(request));
    if (!result.ok) {
      throw new HttpError(400, Object.values(result.errors)[0]);
    }
    sendJson(response, 201, {
      transaction: await repository.createTransaction(user.id, result.value),
    });
    return;
  }

  const match = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (!match || !UUID_PATTERN.test(match[1])) {
    throw new HttpError(404, "Not found.");
  }

  if (request.method === "PUT") {
    const result = validateTransaction(await readJson(request));
    if (!result.ok) {
      throw new HttpError(400, Object.values(result.errors)[0]);
    }
    const transaction = await repository.updateTransaction(user.id, match[1], result.value);
    if (!transaction) {
      throw new HttpError(404, "Transaction not found.");
    }
    sendJson(response, 200, { transaction });
    return;
  }

  if (request.method === "DELETE") {
    const deleted = await repository.deleteTransaction(user.id, match[1]);
    if (!deleted) {
      throw new HttpError(404, "Transaction not found.");
    }
    response.writeHead(204);
    response.end();
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." }, { Allow: "PUT, DELETE" });
}

function isSameOrigin(origin, host) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function startSession(request, response, repository, user) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await repository.createSession(user.id, hashSessionToken(token), expiresAt);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
      SESSION_DURATION_MS / 1000
    }${secure}`,
  );
}

function clearSessionCookie(request, response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

async function getCurrentUser(request, repository) {
  const token = getSessionToken(request);
  return token ? repository.getSessionUser(hashSessionToken(token)) : null;
}

async function requireUser(request, repository) {
  const user = await getCurrentUser(request, repository);
  if (!user) {
    throw new HttpError(401, "Sign in to access your ledger.");
  }
  return user;
}

function getSessionToken(request) {
  const cookie = request.headers.cookie ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function publicUser(user) {
  return { id: user.id, email: user.email };
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password, registration = false) {
  if (typeof password !== "string") {
    return "Enter a password.";
  }
  if (registration && password.length < 8) {
    return "Use a password with at least 8 characters.";
  }
  if (password.length > 128) {
    return "Password must be 128 characters or fewer.";
  }
  return null;
}

async function handleStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end("Invalid request path");
    return;
  }

  const relativePath = publicFiles.get(decodedPath);
  if (!relativePath) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const filePath = resolve(root, relativePath);
  const resolvedRelativePath = relative(root, filePath);
  if (
    resolvedRelativePath === ".." ||
    resolvedRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(resolvedRelativePath)
  ) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const details = await stat(filePath);
  if (!details.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const body = await readFile(filePath);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": body.length,
    "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request body is too large.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Expected an object.");
    }
    return body;
  } catch {
    throw new HttpError(400, "Request body must be a valid JSON object.");
  }
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
