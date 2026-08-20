const crypto = require("node:crypto");

const REMOTE_SECURITY_POLICY = Object.freeze({
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

function retryAfterSeconds(milliseconds) {
  return Math.max(1, Math.ceil(Math.max(0, milliseconds) / 1000));
}

class RemoteAccessGuard {
  constructor({ now = () => Date.now(), policy = REMOTE_SECURITY_POLICY } = {}) {
    this.now = now;
    this.policy = policy;
    this.pairFailures = new Map();
    this.apiWindows = new Map();
  }

  reset() {
    this.pairFailures.clear();
    this.apiWindows.clear();
  }

  checkPair(clientKey) {
    const key = String(clientKey || "unknown");
    const current = this.now();
    const state = this.pairFailures.get(key);
    if (!state) return { allowed: true, retryAfterSeconds: 0 };
    if (state.lockedUntil > current) return { allowed: false, retryAfterSeconds: retryAfterSeconds(state.lockedUntil - current) };
    if (current - state.windowStart >= this.policy.pairWindowMs) this.pairFailures.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordPairFailure(clientKey) {
    const key = String(clientKey || "unknown");
    const current = this.now();
    let state = this.pairFailures.get(key);
    if (!state || current - state.windowStart >= this.policy.pairWindowMs || state.lockedUntil <= current && state.failures >= this.policy.pairMaxFailures) {
      state = { windowStart: current, failures: 0, lockedUntil: 0 };
    }
    state.failures += 1;
    if (state.failures >= this.policy.pairMaxFailures) state.lockedUntil = current + this.policy.pairCooldownMs;
    this.pairFailures.set(key, state);
    const locked = state.lockedUntil > current;
    return { locked, retryAfterSeconds: locked ? retryAfterSeconds(state.lockedUntil - current) : 0, failures: state.failures };
  }

  recordPairSuccess(clientKey) {
    this.pairFailures.delete(String(clientKey || "unknown"));
  }

  consumeApi(clientKey, expensive = false) {
    const key = `${expensive ? "expensive" : "general"}:${String(clientKey || "unknown")}`;
    const current = this.now();
    const windowMs = expensive ? this.policy.expensiveApiWindowMs : this.policy.apiWindowMs;
    const maxRequests = expensive ? this.policy.expensiveApiMaxRequests : this.policy.apiMaxRequests;
    let state = this.apiWindows.get(key);
    if (!state || current - state.windowStart >= windowMs) state = { windowStart: current, count: 0 };
    if (state.count >= maxRequests) {
      this.apiWindows.set(key, state);
      return { allowed: false, retryAfterSeconds: retryAfterSeconds(windowMs - (current - state.windowStart)) };
    }
    state.count += 1;
    this.apiWindows.set(key, state);
    return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, maxRequests - state.count) };
  }
}

class RemoteTokenStore {
  constructor({ now = () => Date.now(), policy = REMOTE_SECURITY_POLICY, randomBytes = crypto.randomBytes } = {}) {
    this.now = now;
    this.policy = policy;
    this.randomBytes = randomBytes;
    this.tokens = new Map();
  }

  clear() { this.tokens.clear(); }

  prune() {
    const current = this.now();
    for (const [token, metadata] of this.tokens) if (metadata.expiresAt <= current) this.tokens.delete(token);
    while (this.tokens.size > this.policy.maxActiveTokens) this.tokens.delete(this.tokens.keys().next().value);
  }

  issue(clientKey) {
    this.prune();
    while (this.tokens.size >= this.policy.maxActiveTokens) this.tokens.delete(this.tokens.keys().next().value);
    const token = this.randomBytes(24).toString("hex");
    this.tokens.set(token, { clientKey: String(clientKey || "unknown"), expiresAt: this.now() + this.policy.tokenTtlMs });
    return token;
  }

  validate(token, clientKey) {
    this.prune();
    const metadata = this.tokens.get(String(token || ""));
    if (!metadata) return false;
    if (metadata.clientKey !== String(clientKey || "unknown")) return false;
    return metadata.expiresAt > this.now();
  }
}

module.exports = { REMOTE_SECURITY_POLICY, RemoteAccessGuard, RemoteTokenStore };
