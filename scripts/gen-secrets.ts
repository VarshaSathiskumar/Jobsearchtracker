import { randomBytes } from "node:crypto";

console.log(`AUTH_SECRET=${randomBytes(32).toString("base64")}`);
console.log(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
