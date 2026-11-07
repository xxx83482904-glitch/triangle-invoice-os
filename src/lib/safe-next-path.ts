// Where to go after signing in: only a same-site app path. The page itself still checks the user's permissions.
export function safeNextPath(value: string) {
  return /^\/(?![/\\])[\w\-/?=&%.]*$/.test(value) && !/^\/(login|register|api)(\/|\?|$)/.test(value) ? value : "";
}
