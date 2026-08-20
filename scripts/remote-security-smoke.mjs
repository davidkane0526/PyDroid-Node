import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { REMOTE_SECURITY_POLICY, RemoteAccessGuard, RemoteTokenStore } = require(path.join(root, "desktop/services/remote-security.cjs"));
let now = 1_000_000;
const clock = () => now;
const guard = new RemoteAccessGuard({ now: clock });

for (let index = 1; index < REMOTE_SECURITY_POLICY.pairMaxFailures; index += 1) {
  const result = guard.recordPairFailure("192.168.1.20");
  assert.equal(result.locked, false, `pair attempt ${index} should not lock early`);
}
const locked = guard.recordPairFailure("192.168.1.20");
assert.equal(locked.locked, true, "fifth failed PIN should enter cooldown");
assert.equal(guard.checkPair("192.168.1.20").allowed, false, "pairing must remain blocked during cooldown");
now += REMOTE_SECURITY_POLICY.pairCooldownMs;
assert.equal(guard.checkPair("192.168.1.20").allowed, true, "pairing must recover after cooldown");

guard.reset();
for (let index = 0; index < REMOTE_SECURITY_POLICY.apiMaxRequests; index += 1) assert.equal(guard.consumeApi("client", false).allowed, true);
assert.equal(guard.consumeApi("client", false).allowed, false, "general API limit must reject overflow");
guard.reset();
for (let index = 0; index < REMOTE_SECURITY_POLICY.expensiveApiMaxRequests; index += 1) assert.equal(guard.consumeApi("client", true).allowed, true);
assert.equal(guard.consumeApi("client", true).allowed, false, "expensive API limit must reject overflow");

now = 5_000_000;
const tokenStore = new RemoteTokenStore({ now: clock, randomBytes: (size) => Buffer.alloc(size, tokenStore.tokens.size + 1) });
const token = tokenStore.issue("192.168.1.20");
assert.equal(tokenStore.validate(token, "192.168.1.20"), true, "issued token must validate for the paired client");
assert.equal(tokenStore.validate(token, "192.168.1.21"), false, "token must be bound to the paired client address");
now += REMOTE_SECURITY_POLICY.tokenTtlMs + 1;
assert.equal(tokenStore.validate(token, "192.168.1.20"), false, "expired token must be rejected");

const desktopServer = readFileSync(path.join(root, "desktop/services/remote-server.cjs"), "utf8");
const androidServer = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/RemoteWorkflowServer.java"), "utf8");
const androidGuard = readFileSync(path.join(root, "android/app/src/main/java/com/dk/pydroidflow/RemoteAccessGuard.java"), "utf8");
const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
const types = readFileSync(path.join(root, "src/platform/types.ts"), "utf8");

function readJavaNumericConstant(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `Android ${name} constant must exist`);
  const expression = match[1].replace(/_/g, "").replace(/L\b/g, "").trim();
  assert.match(expression, /^[0-9+*()\s-]+$/, `Android ${name} must remain a simple numeric expression`);
  return Function(`"use strict"; return (${expression});`)();
}

for (const [name, expected] of Object.entries({
  PAIR_MAX_FAILURES: REMOTE_SECURITY_POLICY.pairMaxFailures,
  PAIR_WINDOW_MS: REMOTE_SECURITY_POLICY.pairWindowMs,
  PAIR_COOLDOWN_MS: REMOTE_SECURITY_POLICY.pairCooldownMs,
  TOKEN_TTL_MS: REMOTE_SECURITY_POLICY.tokenTtlMs,
  MAX_ACTIVE_TOKENS: REMOTE_SECURITY_POLICY.maxActiveTokens,
  API_WINDOW_MS: REMOTE_SECURITY_POLICY.apiWindowMs,
  API_MAX_REQUESTS: REMOTE_SECURITY_POLICY.apiMaxRequests,
  EXPENSIVE_API_WINDOW_MS: REMOTE_SECURITY_POLICY.expensiveApiWindowMs,
  EXPENSIVE_API_MAX_REQUESTS: REMOTE_SECURITY_POLICY.expensiveApiMaxRequests,
})) {
  assert.equal(readJavaNumericConstant(androidGuard, name), expected, `Android ${name} must match Desktop policy`);
}
assert.match(desktopServer, /MAX_PAIR_BODY_BYTES/, "Desktop unauthenticated pairing body must have a small dedicated limit");
assert.match(androidServer, /MAX_PAIR_BODY_BYTES/, "Android unauthenticated pairing body must have a small dedicated limit");
assert.doesNotMatch(androidServer, /Access-Control-Allow-Origin:\s*\*/, "Android Remote Web must not expose authenticated APIs to arbitrary browser origins");
assert.match(androidServer, /setInstanceFollowRedirects\(false\)/, "Android Agent proxy must not forward host credentials across HTTP redirects");
assert.match(desktopServer, /Retry-After/, "Desktop Remote Web must return Retry-After when throttled");
assert.match(androidServer, /Retry-After/, "Android Remote Web must return Retry-After when throttled");
assert.match(desktopServer, /RemoteTokenStore/, "Desktop must use expiring per-pair session tokens");
assert.match(androidServer, /issueToken\(clientKey\)/, "Android must issue a fresh token after successful pairing");
assert.doesNotMatch(desktopServer, /agentApiKey\s*:/, "Desktop app configuration must never serialize an Agent API key");
assert.doesNotMatch(androidServer, /put\("agentApiKey"/, "Android app configuration must never serialize an Agent API key");
assert.match(androidServer, /agentProxyAvailable/, "Android app configuration should expose only Agent proxy availability");
assert.match(androidServer, /\/api\/agent-proxy/, "Android must provide a host Agent proxy endpoint");
assert.match(androidServer, /AgentSecretStore\.load\(context\)/, "Android Agent proxy must resolve the secret only inside the host");
assert.match(app, /apiKeyManagedByHost=\{remoteBrowser && remoteAgentProxyAvailable\}/, "Remote Web Agent UI must not request/display the host raw API key when proxying");
assert.match(types, /agentProxyAvailable: boolean/, "Remote configuration contract must expose proxy availability, not a secret");
assert.doesNotMatch(types, /RemoteAppConfiguration[^\n]*agentApiKey/, "Remote configuration type must not contain the Agent API key");

console.log("Remote security smoke passed.");
