import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { isOnboardingResetAllowed } from "../lib/env";

describe("isOnboardingResetAllowed", () => {
  it.each([
    ["production", false],
    ["prod", false],
    ["Production", false],
    [undefined, false],
    ["staging", false],
    ["development", true],
    ["test", true],
  ] as const)("NODE_ENV=%j -> %j", (env, allowed) => {
    expect(isOnboardingResetAllowed(env)).toBe(allowed);
  });

  it("rejects other casing/whitespace variants", () => {
    expect(isOnboardingResetAllowed("Development")).toBe(false);
    expect(isOnboardingResetAllowed("TEST")).toBe(false);
    expect(isOnboardingResetAllowed(" development ")).toBe(false);
    expect(isOnboardingResetAllowed("")).toBe(false);
  });
});

describe("POST /api/gamification/onboarding/reset gating", () => {
  let server: Server;
  let baseUrl: string;
  const originalEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    const { default: app } = await import("../app");
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  const post = () => fetch(`${baseUrl}/api/gamification/onboarding/reset`, { method: "POST" });

  it.each(["production", "prod", "Production", "staging"])(
    "returns 403 when NODE_ENV=%s",
    async (env) => {
      process.env.NODE_ENV = env;
      const res = await post();
      expect(res.status).toBe(403);
    }
  );

  it("returns 403 when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    const res = await post();
    expect(res.status).toBe(403);
  });

  it("allows the reset when NODE_ENV=development", async () => {
    process.env.NODE_ENV = "development";
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { onboardingCompleted: boolean };
    expect(body.onboardingCompleted).toBe(false);
  });

  it("allows the reset when NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    const res = await post();
    expect(res.status).toBe(200);
  });
});
