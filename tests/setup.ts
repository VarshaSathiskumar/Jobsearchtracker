import { randomBytes } from "node:crypto";

process.env.ALLOWED_EMAIL = "owner@example.com";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AUTH_SECRET = randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.APP_URL = "http://localhost:3000";
process.env.SYNC_LIST_PAGE_SIZE = "5";
process.env.AGENT_BATCH_SIZE = "3";
process.env.AGENT_BATCHES_PER_STEP = "2";

// Structured logs are noisy in test output. Set DEBUG_TESTS=1 to see them.
if (!process.env.DEBUG_TESTS) {
  console.warn = () => {};
  console.log = () => {};
}
