import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import type { AuthProviderAdapter } from "./lib/auth/provider";
import { requireUser } from "./lib/auth/middleware";

/**
 * Application factory (Session B-Alpha, section 12).
 *
 * Production and tests can provide different auth providers:
 *   - production (B-Beta): the Clerk adapter + clerkVerificationMiddleware()
 *   - tests: the deterministic TestAuthProviderAdapter
 *
 * B-ALPHA STATE: when no authProvider is supplied (the current production
 * default), NO auth middleware is mounted and the app behaves exactly as it
 * did before — the unauthenticated frontend keeps working.
 *
 * B-BETA ACTIVATION POINT (documented, not active): the final production
 * composition happens HERE, between the body parsers and the /api router:
 *
 *   app.use(clerkVerificationMiddleware());          // Clerk verification
 *   app.use("/api", requireUser(clerkAdapter));       // Lucent require-user
 *   app.use("/api", router);                          // protected router
 *
 * The ONLY public exception is GET /api/healthz (handled inside
 * requireUser). No other public-route exceptions may be added.
 */
export type CreateAppOptions = Readonly<{
  authProvider?: AuthProviderAdapter;
  /** Test-only injection of the legacy-owner claim subject. */
  legacyOwnerSubject?: string | undefined;
}>;

export function createApp(options: CreateAppOptions = {}): Express {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (options.authProvider) {
    const requireUserOptions =
      "legacyOwnerSubject" in options
        ? { legacyOwnerSubject: options.legacyOwnerSubject }
        : {};
    app.use("/api", requireUser(options.authProvider, requireUserOptions));
  }

  app.use("/api", router);

  // Central error handler: atomic action routes let unexpected failures
  // propagate here AFTER their database transaction has rolled back. The
  // internal error is logged in full; the client gets a generic 500 with no
  // stack trace or database detail.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    req.log.error({ err }, "unhandled request error");
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

// B-Alpha production default: unchanged unauthenticated composition.
const app: Express = createApp();

export default app;
