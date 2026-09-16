/**
 * Centralized error handling for CallRail API requests.
 *
 * Converts thrown errors (mostly AxiosErrors) into clear, actionable strings
 * that guide the agent toward a fix instead of leaking internals.
 */
import axios from "axios";

/** Extract a human-readable detail string from a CallRail error body. */
function extractApiDetail(data: unknown): string | undefined {
  if (data == null) return undefined;
  const cap = (s: string): string => (s.length > 300 ? `${s.slice(0, 300)}...` : s);
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return undefined;
    // Don't leak a full HTML error page (from a proxy/CDN) into the message.
    if (trimmed.startsWith("<") || /<html/i.test(trimmed)) return undefined;
    return cap(trimmed);
  }
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // CallRail commonly returns { "error": "..." } or { "errors": [...] }.
    if (typeof obj.error === "string") return cap(obj.error);
    if (Array.isArray(obj.errors)) return cap(obj.errors.join("; "));
    if (typeof obj.message === "string") return cap(obj.message);
    try {
      return cap(JSON.stringify(obj));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Convert any thrown error into a clear, actionable message.
 * Always returns a string beginning with "Error:".
 */
export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const detail = extractApiDetail(error.response?.data);
    const suffix = detail ? ` Details: ${detail}` : "";

    switch (status) {
      case 400:
      case 422:
        return (
          `Error: CallRail rejected the request (HTTP ${status}). This usually means an ` +
          `invalid parameter, an out-of-range date, or a malformed body. ` +
          `Check date ranges (Communication Records older than 25 months are deleted) ` +
          `and that all IDs are correct.${suffix}`
        );
      case 401:
        return (
          "Error: Authentication failed (HTTP 401). The CALLRAIL_API_KEY is missing, " +
          "invalid, or expired. Verify the key in your environment and that it has not " +
          `been revoked.${suffix}`
        );
      case 403:
        return (
          "Error: Permission denied (HTTP 403). The API key's user does not have access " +
          "to this account, company, or resource. API keys only see what their user can " +
          `see in the CallRail UI.${suffix}`
        );
      case 404:
        return (
          "Error: Not found (HTTP 404). The account ID, resource ID, or endpoint is wrong. " +
          "Use callrail_list_accounts to confirm the account ID and the relevant list tool " +
          `to confirm resource IDs.${suffix}`
        );
      case 405:
        return `Error: Method not allowed (HTTP 405) for this endpoint.${suffix}`;
      case 406:
        return (
          "Error: Parameters supplied in an unacceptable format (HTTP 406). For GET requests " +
          `parameters must be in the query string.${suffix}`
        );
      case 429:
        return (
          "Error: Rate limit exceeded (HTTP 429). CallRail allows ~1,000 requests/hour and " +
          "10,000/day for general API calls. Pause and retry shortly, or narrow your query " +
          `(smaller date range, fewer pages).${suffix}`
        );
      case 500:
        return `Error: CallRail had an internal server error (HTTP 500). Retry shortly; if it persists, contact CallRail support.${suffix}`;
      case 503:
        return `Error: CallRail is temporarily unavailable (HTTP 503). Retry after a short wait.${suffix}`;
      default:
        if (status) {
          return `Error: CallRail API request failed with HTTP ${status}.${suffix}`;
        }
        if (error.code === "ECONNABORTED") {
          return "Error: The request to CallRail timed out. Try again, or reduce the amount of data requested.";
        }
        if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
          return "Error: Could not reach api.callrail.com. Check network connectivity and try again.";
        }
        return `Error: Network error contacting CallRail (${error.code ?? "unknown"}): ${error.message}`;
    }
  }
  return `Error: Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}

/** A tagged error for configuration problems we want to surface immediately. */
export class ConfigError extends Error {}

/**
 * Convert any error into user-facing text, preserving configuration error
 * messages verbatim and routing everything else through handleApiError.
 */
export function toErrorText(error: unknown): string {
  if (error instanceof ConfigError) {
    return `Error: ${error.message}`;
  }
  return handleApiError(error);
}
