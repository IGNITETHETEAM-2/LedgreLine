import { createServer } from "node:http";
import { createDatabase } from "./src/database.js";
import { createRequestHandler } from "./src/http.js";

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const database = createDatabase(process.env.DATABASE_URL);
await database.initialize();

const server = createServer(createRequestHandler(database));
server.listen(port, host, () => {
  console.log(`LedgerLine is available on ${host}:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
