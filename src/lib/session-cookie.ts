// Sessions don't expire: the token has no expiry and the cookie is renewed on every visit (proxy.ts).
// Browsers cap cookie lifetimes at about 400 days, so only someone who stays away that long signs in again.
// Signing out, an administrator changing the password or stopping the account, or 「すべての端末からログアウト」
// ends existing sessions (getCurrentUser checks the user's access and session version).
export const SESSION_COOKIE_NAME = "triangle-session";
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
