/**
 * Network predicates shared by the local console and the DSH plugin host.
 *
 * Both surfaces answer the same question — "is this request's Host header
 * something we are willing to serve?" — so the parsing rule lives here once.
 * A hardening fix to the parser then lands on both entry points instead of
 * only the surface that happened to be edited.
 */

// Brackets are stripped by hostnameOf(), so the bare "::1" form is the only
// IPv6 loopback that can ever reach this set.
export const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Normalise a Host/authority header to a bare lowercase hostname.
 *
 * Returns "" for anything that is not a plain authority: embedded credentials,
 * a path, query or fragment, a backslash (some proxies treat it as a path
 * separator), or a value the URL parser rejects. Callers must treat "" as
 * untrusted and fail closed.
 */
export function hostnameOf(authority) {
  if (!authority || /[/?#@\\]/.test(authority)) return "";
  try {
    const u = new URL(`http://${authority}`);
    if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) return "";
    return u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}
