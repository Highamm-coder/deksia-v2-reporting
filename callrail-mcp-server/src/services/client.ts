/**
 * CallRail API client.
 *
 * Centralizes authentication, query-string serialization (including CallRail's
 * `key[]=a&key[]=b` array convention), timeouts, and account-ID resolution so
 * individual tools never duplicate transport concerns.
 */
import axios from "axios";
import { API_BASE_URL, ENV, REQUEST_TIMEOUT_MS } from "../constants.js";
import { ConfigError } from "./errors.js";
import type { HttpMethod } from "../types.js";

/** Read the API key from the environment, throwing a config error if absent. */
function getApiKey(): string {
  const key = process.env[ENV.API_KEY];
  if (!key) {
    throw new ConfigError(
      `${ENV.API_KEY} is not set. Provide your CallRail API key as an environment variable.`,
    );
  }
  return key;
}

/**
 * Resolve the account ID to use for an account-scoped request.
 * Falls back to the CALLRAIL_ACCOUNT_ID environment variable, and throws a
 * clear error (pointing the agent at callrail_list_accounts) if neither exists.
 */
export function resolveAccountId(provided?: string): string {
  const accountId = (provided && provided.trim()) || process.env[ENV.ACCOUNT_ID]?.trim();
  if (!accountId) {
    throw new ConfigError(
      "No account ID available. Pass `account_id`, or set the CALLRAIL_ACCOUNT_ID " +
        "environment variable. If you don't know the account ID, call " +
        "callrail_list_accounts first.",
    );
  }
  return accountId;
}

/**
 * Serialize a params object into a CallRail-compatible query string.
 * Arrays are encoded as repeated `key[]=value` pairs; null/undefined are skipped.
 */
export function serializeParams(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(String(item))}`);
      }
    } else if (typeof value === "boolean") {
      parts.push(`${encodeURIComponent(key)}=${value ? "true" : "false"}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join("&");
}

export interface RequestOptions {
  method?: HttpMethod;
  /** Query-string parameters (objects/arrays serialized via serializeParams). */
  params?: Record<string, unknown>;
  /** JSON request body for POST/PUT. */
  data?: Record<string, unknown>;
}

/**
 * Make an authenticated request to the CallRail API.
 *
 * @param path API path relative to the v3 base, beginning with `/`
 *             (e.g. `/a/{account_id}/calls.json`).
 * @returns The parsed JSON response body, typed as T.
 */
export async function callrailRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", params, data } = options;
  const apiKey = getApiKey();

  const headers: Record<string, string> = {
    Authorization: `Token token="${apiKey}"`,
    Accept: "application/json",
  };
  if (data !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const requestFrom = process.env[ENV.REQUEST_FROM];
  if (requestFrom) {
    headers["Request-From"] = requestFrom;
  }

  const response = await axios({
    method,
    url: `${API_BASE_URL}${path}`,
    headers,
    data,
    params,
    paramsSerializer: { serialize: (p) => serializeParams(p as Record<string, unknown>) },
    timeout: REQUEST_TIMEOUT_MS,
    // CallRail returns JSON; let axios parse it and surface non-2xx as errors.
    responseType: "json",
  });

  return response.data as T;
}

/** Verify that required configuration is present. Used at startup. */
export function assertConfigured(): void {
  getApiKey();
}
