export const AUTH_SESSION_COOKIE_NAME = 'chutes_auth_session';
export const OAUTH_STATE_COOKIE_NAME = 'chutes_oauth_state';
export const ANON_SESSION_COOKIE_NAME = 'sessionId';

// Keep app auth cookies effectively permanent after a successful sign-in.
// Browsers may cap this lower (Chrome currently caps at 400 days), and the
// server-side session expiry is slid forward on active use.
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;
