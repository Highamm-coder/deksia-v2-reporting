/**
 * Shared TypeScript types for the CallRail MCP server.
 *
 * CallRail's API returns objects with a large number of optional, plan-gated
 * fields, so most record shapes are intentionally loose (`Record<string, unknown>`).
 * We strongly type only the consistent pagination envelope.
 */

/** Standard offset-pagination metadata returned by collection endpoints. */
export interface OffsetPaginationMeta {
  page?: number;
  per_page?: number;
  total_pages?: number;
  total_records?: number;
}

/** A raw CallRail record. Fields vary by resource and requested `fields`. */
export type CallRailRecord = Record<string, unknown>;

/**
 * A CallRail collection response: pagination metadata plus an array stored
 * under a resource-specific key (e.g. `calls`, `companies`, `users`).
 */
export type CallRailListResponse = OffsetPaginationMeta & {
  [collectionKey: string]: unknown;
};

/** Normalized structured output we attach to list tool responses. */
export interface NormalizedListOutput {
  total_records: number | null;
  page: number | null;
  per_page: number | null;
  total_pages: number | null;
  count: number;
  has_more: boolean;
  next_page?: number;
  truncated?: boolean;
  truncation_message?: string;
  [collectionKey: string]: unknown;
}

/** HTTP methods used by the API client. */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
