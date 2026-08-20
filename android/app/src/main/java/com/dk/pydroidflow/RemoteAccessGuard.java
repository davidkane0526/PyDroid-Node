package com.dk.pydroidflow;

import java.security.SecureRandom;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/** Pure-Java Remote Web pairing/rate/token guard shared by the Android host server. */
final class RemoteAccessGuard {
    static final int PAIR_MAX_FAILURES = 5;
    static final long PAIR_WINDOW_MS = 60_000L;
    static final long PAIR_COOLDOWN_MS = 60_000L;
    static final long TOKEN_TTL_MS = 12L * 60L * 60L * 1000L;
    static final int MAX_ACTIVE_TOKENS = 32;
    static final long API_WINDOW_MS = 60_000L;
    static final int API_MAX_REQUESTS = 240;
    static final long EXPENSIVE_API_WINDOW_MS = 60_000L;
    static final int EXPENSIVE_API_MAX_REQUESTS = 30;

    interface Clock { long now(); }

    static final class Decision {
        final boolean allowed;
        final int retryAfterSeconds;
        final int remaining;
        Decision(boolean allowed, int retryAfterSeconds, int remaining) {
            this.allowed = allowed;
            this.retryAfterSeconds = retryAfterSeconds;
            this.remaining = remaining;
        }
    }

    private static final class PairState {
        long windowStart;
        int failures;
        long lockedUntil;
    }

    private static final class WindowState {
        long windowStart;
        int count;
    }

    private static final class TokenState {
        final String clientKey;
        final long expiresAt;
        TokenState(String clientKey, long expiresAt) { this.clientKey = clientKey; this.expiresAt = expiresAt; }
    }

    private final Clock clock;
    private final SecureRandom random;
    private final Map<String, PairState> pairStates = new LinkedHashMap<>();
    private final Map<String, WindowState> apiStates = new LinkedHashMap<>();
    private final LinkedHashMap<String, TokenState> tokens = new LinkedHashMap<>();

    RemoteAccessGuard() { this(System::currentTimeMillis, new SecureRandom()); }
    RemoteAccessGuard(Clock clock, SecureRandom random) { this.clock = clock; this.random = random; }

    synchronized void reset() {
        pairStates.clear();
        apiStates.clear();
        tokens.clear();
    }

    synchronized Decision checkPair(String rawClientKey) {
        String key = key(rawClientKey);
        long now = clock.now();
        PairState state = pairStates.get(key);
        if (state == null) return new Decision(true, 0, PAIR_MAX_FAILURES);
        if (state.lockedUntil > now) return new Decision(false, retrySeconds(state.lockedUntil - now), 0);
        if (now - state.windowStart >= PAIR_WINDOW_MS) pairStates.remove(key);
        return new Decision(true, 0, Math.max(0, PAIR_MAX_FAILURES - state.failures));
    }

    synchronized Decision recordPairFailure(String rawClientKey) {
        String key = key(rawClientKey);
        long now = clock.now();
        PairState state = pairStates.get(key);
        if (state == null || now - state.windowStart >= PAIR_WINDOW_MS || (state.lockedUntil <= now && state.failures >= PAIR_MAX_FAILURES)) {
            state = new PairState();
            state.windowStart = now;
        }
        state.failures += 1;
        if (state.failures >= PAIR_MAX_FAILURES) state.lockedUntil = now + PAIR_COOLDOWN_MS;
        pairStates.put(key, state);
        boolean locked = state.lockedUntil > now;
        return new Decision(!locked, locked ? retrySeconds(state.lockedUntil - now) : 0, Math.max(0, PAIR_MAX_FAILURES - state.failures));
    }

    synchronized void recordPairSuccess(String rawClientKey) { pairStates.remove(key(rawClientKey)); }

    synchronized Decision consumeApi(String rawClientKey, boolean expensive) {
        String mapKey = (expensive ? "expensive:" : "general:") + key(rawClientKey);
        long now = clock.now();
        long windowMs = expensive ? EXPENSIVE_API_WINDOW_MS : API_WINDOW_MS;
        int maxRequests = expensive ? EXPENSIVE_API_MAX_REQUESTS : API_MAX_REQUESTS;
        WindowState state = apiStates.get(mapKey);
        if (state == null || now - state.windowStart >= windowMs) {
            state = new WindowState();
            state.windowStart = now;
        }
        if (state.count >= maxRequests) {
            apiStates.put(mapKey, state);
            return new Decision(false, retrySeconds(windowMs - (now - state.windowStart)), 0);
        }
        state.count += 1;
        apiStates.put(mapKey, state);
        return new Decision(true, 0, Math.max(0, maxRequests - state.count));
    }

    synchronized String issueToken(String rawClientKey) {
        pruneTokens();
        while (tokens.size() >= MAX_ACTIVE_TOKENS) {
            Iterator<String> iterator = tokens.keySet().iterator();
            if (!iterator.hasNext()) break;
            tokens.remove(iterator.next());
        }
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(java.util.Locale.US, "%02x", value & 0xff));
        String token = builder.toString();
        tokens.put(token, new TokenState(key(rawClientKey), clock.now() + TOKEN_TTL_MS));
        return token;
    }

    synchronized boolean validateToken(String token, String rawClientKey) {
        pruneTokens();
        TokenState state = tokens.get(token == null ? "" : token);
        return state != null && state.expiresAt > clock.now() && state.clientKey.equals(key(rawClientKey));
    }

    private void pruneTokens() {
        long now = clock.now();
        Iterator<Map.Entry<String, TokenState>> iterator = tokens.entrySet().iterator();
        while (iterator.hasNext()) if (iterator.next().getValue().expiresAt <= now) iterator.remove();
    }

    private static String key(String raw) { return raw == null || raw.trim().isEmpty() ? "unknown" : raw.trim(); }
    private static int retrySeconds(long milliseconds) { return Math.max(1, (int) Math.ceil(Math.max(0L, milliseconds) / 1000.0)); }
}
