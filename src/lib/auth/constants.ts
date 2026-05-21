export const AUTH_SESSION_COOKIE_NAME = 'chutes_auth_session';
export const OAUTH_STATE_COOKIE_NAME = 'chutes_oauth_state';
export const ANON_SESSION_COOKIE_NAME = 'sessionId';
export const COOKIE_SESSION_PREFIX = 'cc5_';

// Keep app auth cookies effectively permanent after a successful sign-in.
// Browsers may cap this lower (Chrome currently caps at 400 days), and the
// server-side session expiry is slid forward on active use.
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

// Fallback cookie sessions contain encrypted access/refresh tokens directly.
// Keep those shorter-lived than normal DB-backed session-id cookies.
export const AUTH_FALLBACK_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function getAuthSessionCookieMaxAge(cookieValue: string) {
  return cookieValue.startsWith(COOKIE_SESSION_PREFIX)
    ? AUTH_FALLBACK_SESSION_MAX_AGE_SECONDS
    : AUTH_SESSION_MAX_AGE_SECONDS;
}
