/**
 * Reusable Zod schema fragments shared across tools.
 *
 * These are exported as raw shape objects (plain maps of field -> ZodType) so
 * they can be spread into per-tool input shapes. The MCP SDK's registerTool
 * accepts a raw shape for `inputSchema`.
 */
import { z } from "zod";
import { DEFAULT_PER_PAGE, MAX_PER_PAGE } from "../constants.js";

/** Output format for tool responses. */
export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** `response_format` field: human-readable markdown (default) or raw JSON. */
export const responseFormatField = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format: 'markdown' for a human-readable summary (default), or 'json' for the full structured payload.",
  );

/** `account_id` field, optional because it can default to CALLRAIL_ACCOUNT_ID. */
export const accountIdField = z
  .string()
  .min(1)
  .optional()
  .describe(
    "CallRail account ID (e.g. 'ACC8154748ae6bd4e278a7cddd38a662f4f' or the 9-digit numeric ID). " +
      "Optional if CALLRAIL_ACCOUNT_ID is set in the environment. Use callrail_list_accounts to find it.",
  );

/** Offset-pagination fields. */
export const paginationShape = {
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Page number to return (1-indexed). Default 1."),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(MAX_PER_PAGE)
    .default(DEFAULT_PER_PAGE)
    .describe(`Records per page (1-${MAX_PER_PAGE}). Default ${DEFAULT_PER_PAGE}.`),
} as const;

/** Sorting fields. `sort` is endpoint-specific; `order` controls direction. */
export const sortShape = {
  sort: z
    .string()
    .optional()
    .describe(
      "Field to sort by. Valid fields depend on the endpoint (see the tool description).",
    ),
  order: z
    .enum(["asc", "desc"])
    .optional()
    .describe("Sort direction. Requires `sort` to be set. One of 'asc' or 'desc'."),
} as const;

/** Free-text search field (endpoint-specific searchable columns). */
export const searchShape = {
  search: z
    .string()
    .optional()
    .describe(
      "Free-text search term. Only matches the searchable fields for this endpoint (see the tool description). A single term only.",
    ),
} as const;

/** Comma-separated field-selection field. */
export const fieldsShape = {
  fields: z
    .string()
    .optional()
    .describe(
      "Comma-separated list of additional fields to include in the response, e.g. 'company_id,company_name,source'. See the tool description for available fields.",
    ),
} as const;

export const DATE_RANGE_VALUES = [
  "recent",
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "all_time",
] as const;

/**
 * Date-filtering fields. Either use `date_range` (a standard window) OR
 * `start_date`/`end_date` (ISO 8601). `time_zone` aligns date interpretation.
 * NOTE: Communication Records older than 25 months are deleted; requesting
 * older data (including `all_time`) returns an error.
 */
export const dateShape = {
  date_range: z
    .enum(DATE_RANGE_VALUES)
    .optional()
    .describe(
      "Standard date window. One of: recent (default, prior 30 days incl. today), today, yesterday, " +
        "last_7_days, last_30_days, this_month, last_month, this_year, last_year, all_time. " +
        "Ignored if start_date/end_date are provided.",
    ),
  start_date: z
    .string()
    .optional()
    .describe(
      "Start of a custom date range, ISO 8601 (e.g. '2026-01-01' or '2026-01-01T09:00'). Inclusive. Use with end_date.",
    ),
  end_date: z
    .string()
    .optional()
    .describe(
      "End of a custom date range, ISO 8601 (e.g. '2026-01-31'). Inclusive (treated as 23:59:59 if no time given). Use with start_date.",
    ),
  time_zone: z
    .string()
    .optional()
    .describe(
      "IANA time zone for interpreting dates (e.g. 'America/New_York'). Defaults to the account's configured time zone.",
    ),
} as const;
