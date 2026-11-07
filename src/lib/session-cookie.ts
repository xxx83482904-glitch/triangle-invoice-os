// Sessions don't expire: the token has no expiry and the cookie is renewed on every visit (proxy.ts).
// Browsers cap cookie lifetimes at about 400 days, so only someone who stays away that long signs in again.
// Signing out, or an administrator disabling the account, still ends the session at once (getCurrentUser checks the user).
export const SESSION_COOKIE_NAME = "triangle-session";
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
