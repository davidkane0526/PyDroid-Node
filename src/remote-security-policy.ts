export const REMOTE_SECURITY_POLICY = Object.freeze({
  pairMaxFailures: 5,
  pairWindowMs: 60_000,
  pairCooldownMs: 60_000,
  tokenTtlMs: 12 * 60 * 60 * 1000,
  maxActiveTokens: 32,
  apiWindowMs: 60_000,
  apiMaxRequests: 240,
  expensiveApiWindowMs: 60_000,
  expensiveApiMaxRequests: 30,
});

export type RemoteSecuritySimulation = {
  pairLocksAtAttempt: number;
  pairRetryAfterSeconds: number;
  generalLimit: number;
  expensiveLimit: number;
  tokenTtlHours: number;
};

export function describeRemoteSecurityPolicy(): RemoteSecuritySimulation {
  return {
    pairLocksAtAttempt: REMOTE_SECURITY_POLICY.pairMaxFailures,
    pairRetryAfterSeconds: Math.ceil(REMOTE_SECURITY_POLICY.pairCooldownMs / 1000),
    generalLimit: REMOTE_SECURITY_POLICY.apiMaxRequests,
    expensiveLimit: REMOTE_SECURITY_POLICY.expensiveApiMaxRequests,
    tokenTtlHours: REMOTE_SECURITY_POLICY.tokenTtlMs / 3_600_000,
  };
}
