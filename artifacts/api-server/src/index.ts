import app from "./app";
import { logger } from "./lib/logger";
import { LEGACY_OWNER_SUBJECT_ENV } from "./lib/auth/resolver";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Session B-Alpha, section 10: a missing legacy-claim subject is NOT a
// startup failure and does NOT disable authentication — it only means the
// migrated legacy portfolio cannot be claimed. Fail closed on the claim,
// warn loudly at startup, keep /api/healthz operational. No secrets are
// logged.
if (!process.env[LEGACY_OWNER_SUBJECT_ENV]) {
  logger.warn(
    { missingEnvVar: LEGACY_OWNER_SUBJECT_ENV },
    "Legacy owner Clerk subject is not configured. Existing migrated Lucent portfolio cannot be claimed.",
  );
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
