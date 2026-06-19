/**
 * Response formatting helpers.
 *
 * Provides a consistent way to turn CallRail payloads into either compact
 * markdown (default, human-readable) or full JSON, with automatic truncation
 * of oversized list responses. Keeps every tool's formatting logic DRY.
 */
import { CHARACTER_LIMIT } from "../constants.js";
import { ResponseFormat } from "../schemas/common.js";
import { toErrorText } from "./errors.js";
import type { CallRailRecord, NormalizedListOutput } from "../types.js";

/** A field to render in markdown: a display label and a (possibly dotted) key path. */
export interface FieldSpec {
  label: string;
  key: string;
}

/**
 * The standard MCP tool result shape with structured content attached.
 * The index signature keeps it structurally assignable to the SDK's
 * CallToolResult type (which carries `[x: string]: unknown`).
 */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/** Build a standard text-plus-structured tool result. */
export function toolResult(text: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured !== undefined ? { structuredContent: structured } : {}),
  };
}

/** Build an error tool result (text only). */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Read a possibly-dotted key path from an object. */
function getVal(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, obj);
}

/** Render a scalar/array/object value as a short markdown-safe string. */
function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return value.map((v) => String(v)).join(", ");
    }
    return `${value.length} item(s)`;
  }
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

/** Render one record as a markdown bullet list using the given field specs. */
function renderRecord(rec: CallRailRecord, specs?: FieldSpec[]): string {
  const lines: string[] = [];
  if (specs && specs.length) {
    for (const spec of specs) {
      const v = getVal(rec, spec.key);
      if (v === undefined || v === null || v === "") continue;
      lines.push(`- **${spec.label}**: ${formatScalar(v)}`);
    }
  } else {
    // Generic fallback: render all top-level scalar/array fields.
    for (const [k, v] of Object.entries(rec)) {
      if (v === undefined || v === null || v === "") continue;
      if (typeof v === "object" && !Array.isArray(v)) continue;
      lines.push(`- **${k}**: ${formatScalar(v)}`);
    }
  }
  return lines.length ? lines.join("\n") : "_(no populated fields)_";
}

/** Render an array of objects as a markdown table. */
export function renderTable(rows: CallRailRecord[], columns: FieldSpec[]): string {
  if (!rows.length) return "_(no rows)_";
  const header = `| ${columns.map((c) => c.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map(
      (row) =>
        `| ${columns
          .map((c) => {
            const v = getVal(row, c.key);
            return v === undefined || v === null ? "" : formatScalar(v);
          })
          .join(" | ")} |`,
    )
    .join("\n");
  return [header, divider, body].join("\n");
}

interface ListMeta {
  page: number | null;
  per_page: number | null;
  total_pages: number | null;
  total_records: number | null;
}

/** Top-level envelope keys that are never the record collection. */
const META_KEYS = new Set([
  "page",
  "per_page",
  "total_pages",
  "total_records",
  "total_results",
]);

/**
 * Locate the record array in a CallRail list response.
 *
 * Prefers the expected key. If that key is absent or not an array (for example
 * because the API names the collection differently than expected), it falls
 * back to the first top-level array property that is not a pagination/meta
 * field. This means a key mismatch degrades to "rendered under a different
 * name" rather than the far worse "silently shows zero records on a 200 OK".
 */
function resolveCollection(
  data: Record<string, unknown>,
  expectedKey: string,
): { records: CallRailRecord[]; actualKey: string; fellBack: boolean } {
  if (Array.isArray(data[expectedKey])) {
    return { records: data[expectedKey] as CallRailRecord[], actualKey: expectedKey, fellBack: false };
  }
  for (const [key, value] of Object.entries(data)) {
    if (META_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      return { records: value as CallRailRecord[], actualKey: key, fellBack: true };
    }
  }
  return { records: [], actualKey: expectedKey, fellBack: false };
}

/** Top-level non-meta, non-array properties (e.g. a `lead` summary object). */
function siblingObjects(
  data: Record<string, unknown>,
  arrayKey: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === arrayKey || META_KEYS.has(key)) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = value;
    }
  }
  return out;
}

function buildStructured(
  records: CallRailRecord[],
  collectionKey: string,
  meta: ListMeta,
  siblings?: Record<string, unknown>,
): NormalizedListOutput {
  const hasMore =
    meta.total_pages != null && meta.page != null
      ? meta.page < meta.total_pages
      : meta.per_page != null
        ? records.length >= meta.per_page
        : false;
  return {
    total_records: meta.total_records,
    page: meta.page,
    per_page: meta.per_page,
    total_pages: meta.total_pages,
    count: records.length,
    has_more: hasMore,
    ...(hasMore && meta.page != null ? { next_page: meta.page + 1 } : {}),
    ...(siblings && Object.keys(siblings).length ? siblings : {}),
    [collectionKey]: records,
  };
}

export interface FormatListArgs {
  data: Record<string, unknown>;
  collectionKey: string;
  format: ResponseFormat;
  title: string;
  /** Field specs for the markdown rendering of each record. */
  fieldSpecs?: FieldSpec[];
  /** Key used as the markdown heading for each record (e.g. 'name'). */
  titleKey?: string;
  /** Key shown in parentheses after the heading (e.g. 'id'). */
  idKey?: string;
  /** Page/per_page actually requested, used as a fallback if absent from the payload. */
  requestedPage?: number;
  requestedPerPage?: number;
}

/**
 * Format a CallRail collection response, truncating the record array if the
 * JSON payload would exceed CHARACTER_LIMIT.
 */
export function formatList(args: FormatListArgs): ToolResult {
  const { data, collectionKey, format, title, fieldSpecs, titleKey, idKey } = args;
  const { records: allRecords, actualKey, fellBack } = resolveCollection(data, collectionKey);
  const outKey = fellBack ? actualKey : collectionKey;
  const siblings = siblingObjects(data, outKey);

  const meta: ListMeta = {
    page: (data.page as number | undefined) ?? args.requestedPage ?? null,
    per_page: (data.per_page as number | undefined) ?? args.requestedPerPage ?? null,
    total_pages: (data.total_pages as number | undefined) ?? null,
    total_records: (data.total_records as number | undefined) ?? null,
  };

  // Truncate records until the JSON payload fits within CHARACTER_LIMIT.
  let working = allRecords;
  let truncated = false;
  let structured = buildStructured(working, outKey, meta, siblings);
  while (JSON.stringify(structured).length > CHARACTER_LIMIT && working.length > 1) {
    working = working.slice(0, Math.max(1, Math.floor(working.length / 2)));
    truncated = true;
    structured = buildStructured(working, outKey, meta, siblings);
  }
  if (truncated) {
    structured.truncated = true;
    structured.truncation_message =
      `Response truncated from ${allRecords.length} to ${working.length} records to fit the size limit. ` +
      `Request a smaller per_page, add filters, or use the 'fields' parameter to reduce payload size.`;
  }

  let text: string;
  if (format === ResponseFormat.JSON) {
    text = JSON.stringify(structured, null, 2);
  } else {
    const lines: string[] = [`# ${title}`, ""];
    const countLine =
      `Showing ${working.length}` +
      (meta.total_records != null ? ` of ${meta.total_records}` : "") +
      ` record(s)` +
      (meta.page != null
        ? ` — page ${meta.page}${meta.total_pages != null ? ` of ${meta.total_pages}` : ""}`
        : "") +
      ".";
    lines.push(countLine);
    if (structured.has_more) {
      lines.push(`_More results available — request page ${(meta.page ?? 1) + 1}._`);
    }
    if (truncated) {
      lines.push(`_${structured.truncation_message}_`);
    }
    if (!working.length) {
      const hadAnyArray = Object.entries(data).some(
        ([k, v]) => !META_KEYS.has(k) && Array.isArray(v),
      );
      const objectKeys = Object.keys(siblings);
      if (!hadAnyArray && objectKeys.length) {
        // Response was a single object, not a list. Surface it rather than
        // claiming "no records", which would be misleading on a 200 OK.
        lines.push(
          "",
          "This response contained an object rather than a list. Full payload:",
          "",
          "```json",
          JSON.stringify(siblings, null, 2),
          "```",
        );
      } else {
        lines.push("", "No records found for these parameters.");
      }
    } else {
      for (const rec of working) {
        const heading = titleKey ? getVal(rec, titleKey) : undefined;
        const id = idKey ? getVal(rec, idKey) : undefined;
        const headingText =
          (heading != null && heading !== "" ? String(heading) : "(record)") +
          (id != null && id !== "" ? ` (${String(id)})` : "");
        lines.push("", `## ${headingText}`, renderRecord(rec, fieldSpecs));
      }
    }
    text = lines.join("\n");
  }

  return toolResult(text, structured);
}

export interface FormatSingleArgs {
  data: Record<string, unknown>;
  format: ResponseFormat;
  title: string;
  fieldSpecs?: FieldSpec[];
}

/** Format a single CallRail object as markdown or JSON. */
export function formatSingle(args: FormatSingleArgs): ToolResult {
  const { data, format, title, fieldSpecs } = args;
  if (format === ResponseFormat.JSON) {
    return toolResult(JSON.stringify(data, null, 2), data);
  }
  const text = [`# ${title}`, "", renderRecord(data as CallRailRecord, fieldSpecs)].join("\n");
  return toolResult(text, data);
}

/**
 * Run a tool handler body, converting any thrown error into a clean error
 * result. Keeps every tool's try/catch identical and DRY.
 */
export async function runTool(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResult(toErrorText(error));
  }
}
