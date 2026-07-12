/**
 * Test-only failure injection for atomic-write rollback tests.
 *
 * Production behavior: no handler is ever installed, so `failpoint()` is a
 * no-op. There is deliberately NO query-parameter or environment-variable
 * switch — the only way to trigger a failure is for test code running in the
 * same process to install a handler via `setFailpointHandler` (dependency
 * injection). Route code marks named points inside its database transaction;
 * a test handler that throws at a given point proves the whole transaction
 * rolls back.
 */

export type FailpointHandler = (name: string) => void;

let handler: FailpointHandler | null = null;

/** Install (or clear with null) the process-wide failpoint handler. Tests only. */
export function setFailpointHandler(next: FailpointHandler | null): void {
  handler = next;
}

/** Marks a named point in an atomic action. No-op unless a test handler is installed. */
export function failpoint(name: string): void {
  if (handler) handler(name);
}
