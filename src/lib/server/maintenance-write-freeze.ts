/**
 * Deployment-controlled maintenance brake. It is deliberately off unless the
 * host explicitly sets the exact value `true`; it is not client-configurable.
 */
export function maintenanceWriteFreezeEnabled() {
  return process.env.STAKEMATE_MAINTENANCE_WRITE_FREEZE === "true";
}

export class MaintenanceWriteFreezeError extends Error {
  readonly code = "MAINTENANCE_WRITE_FREEZE_ACTIVE" as const;
  constructor(readonly operation: string) {
    super("Application writes are temporarily unavailable for database maintenance.");
    this.name = "MaintenanceWriteFreezeError";
  }
}

/** Call immediately before every application-owned mutation or external writer. */
export function assertApplicationWritesAllowed(operation: string) {
  if (maintenanceWriteFreezeEnabled()) throw new MaintenanceWriteFreezeError(operation);
}

/** Deliberately minimal public-safe shape for a future read-only health endpoint. */
export function maintenanceWriteFreezeStatus() {
  return { applicationWritesFrozen: maintenanceWriteFreezeEnabled() } as const;
}
