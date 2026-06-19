/**
 * Shared constants for the CallRail MCP server.
 */

/** Base URL for all CallRail v3 API requests. */
export const API_BASE_URL = "https://api.callrail.com/v3";

/**
 * Maximum size (in characters) of a single tool response payload before it is
 * truncated. Keeps large list pulls from overwhelming the model context.
 */
export const CHARACTER_LIMIT = 25000;

/** Default number of records to request per page. CallRail's own default is 100. */
export const DEFAULT_PER_PAGE = 100;

/** CallRail caps most list endpoints at 250 records per page. */
export const MAX_PER_PAGE = 250;

/** Request timeout for all outbound HTTP calls, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30000;

/** Environment variable names used to configure the server. */
export const ENV = {
  API_KEY: "CALLRAIL_API_KEY",
  ACCOUNT_ID: "CALLRAIL_ACCOUNT_ID",
  REQUEST_FROM: "CALLRAIL_REQUEST_FROM",
  TRANSPORT: "TRANSPORT",
  PORT: "PORT",
} as const;
