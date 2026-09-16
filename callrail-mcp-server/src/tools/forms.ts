/**
 * Form submission tools. Covers listing captured form submissions and the
 * aggregate form summary (read-only reporting).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callrailRequest, resolveAccountId } from "../services/client.js";
import { formatList, renderTable, runTool, toolResult } from "../services/format.js";
import {
  accountIdField,
  dateShape,
  fieldsShape,
  paginationShape,
  responseFormatField,
  ResponseFormat,
  sortShape,
} from "../schemas/common.js";

const FORM_FIELDS = [
  { label: "Customer", key: "customer_name" },
  { label: "Customer phone", key: "customer_phone_number" },
  { label: "Submitted", key: "submitted_at" },
  { label: "Form URL", key: "form_url" },
  { label: "Landing page", key: "landing_page_url" },
  { label: "Source", key: "source" },
  { label: "Lead status", key: "lead_status" },
  { label: "First form", key: "first_form" },
  { label: "Form data", key: "form_data" },
  { label: "Tags", key: "tags" },
  { label: "Company ID", key: "company_id" },
  { label: "ID", key: "id" },
];

const listFormsShape = {
  account_id: accountIdField,
  company_id: z.string().optional().describe("Limit to form submissions for a single company ID."),
  ...dateShape,
  person_lead: z
    .boolean()
    .optional()
    .describe("If true, only return form submissions that have a lead associated with them."),
  lead_status: z
    .enum(["good_lead", "not_a_lead", "not_scored"])
    .optional()
    .describe("Filter by lead status."),
  tags: z
    .array(z.string())
    .optional()
    .describe("Only return form submissions tagged with ANY of these tags."),
  ...sortShape,
  ...fieldsShape,
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListFormsArgs = z.infer<z.ZodObject<typeof listFormsShape>>;

const formSummaryShape = {
  account_id: accountIdField,
  company_id: z.string().optional().describe("Limit the summary to a single company ID."),
  group_by: z
    .string()
    .optional()
    .describe(
      "Group the form summary by a dimension, e.g. 'source', 'campaign', 'referrer', 'landing_page', 'keywords', or 'company'.",
    ),
  fields: z
    .string()
    .optional()
    .describe(
      "Comma-separated summary metrics: total_forms, first_forms, leads. Defaults to total_forms.",
    ),
  ...dateShape,
  response_format: responseFormatField,
} as const;
type FormSummaryArgs = z.infer<z.ZodObject<typeof formSummaryShape>>;

export function registerFormTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_form_submissions",
    {
      title: "List CallRail Form Submissions",
      description: `List captured web form submissions in an account.

Args:
  - account_id (optional with env default), company_id.
  - Date filter: date_range OR start_date/end_date, plus time_zone.
  - person_lead (bool): only submissions with an associated lead.
  - lead_status: good_lead|not_a_lead|not_scored. tags: array (OR match).
  - sort: submitted_at|form_url (created_at deprecated). order: asc|desc.
  - fields (string): add 'milestones' for attribution data.
  - page, per_page, response_format.

Returns: paginated form submissions including form_data, submitted_at, source, lead_status, landing_page_url, and customer details.`,
      inputSchema: listFormsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListFormsArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          date_range: args.date_range,
          start_date: args.start_date,
          end_date: args.end_date,
          time_zone: args.time_zone,
          person_lead: args.person_lead,
          lead_status: args.lead_status,
          tags: args.tags,
          sort: args.sort,
          order: args.order,
          fields: args.fields,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/form_submissions.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "form_submissions",
          format: args.response_format,
          title: "Form Submissions",
          fieldSpecs: FORM_FIELDS,
          titleKey: "customer_name",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_get_form_summary",
    {
      title: "Summarize CallRail Form Submissions",
      description: `Return aggregate form-submission metrics for an account or company, optionally grouped by a marketing dimension.

Args:
  - account_id (optional with env default), company_id.
  - group_by (string): e.g. source, campaign, referrer, landing_page, keywords, company.
  - fields (string): total_forms, first_forms, leads (defaults to total_forms).
  - Date filter: date_range OR start_date/end_date, plus time_zone.
  - response_format ('markdown'|'json').

Returns: total_results plus, when group_by is set, grouped_results with the requested metrics per group.`,
      inputSchema: formSummaryShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: FormSummaryArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          group_by: args.group_by,
          fields: args.fields,
          date_range: args.date_range,
          start_date: args.start_date,
          end_date: args.end_date,
          time_zone: args.time_zone,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/forms/summary.json`,
          { params },
        );
        const format = args.response_format ?? ResponseFormat.MARKDOWN;
        if (format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(data, null, 2), data);
        }
        const lines: string[] = ["# Form Summary", ""];
        const totals = data.total_results as Record<string, unknown> | undefined;
        if (totals) {
          lines.push("## Totals");
          for (const [k, v] of Object.entries(totals)) lines.push(`- **${k}**: ${String(v)}`);
        }
        const rows = Array.isArray(data.grouped_results)
          ? (data.grouped_results as Record<string, unknown>[])
          : [];
        if (rows.length) {
          const keys = new Set<string>();
          for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
          keys.delete("key");
          const columns = [
            { label: "Group", key: "key" },
            ...Array.from(keys).map((k) => ({ label: k, key: k })),
          ];
          lines.push("", "## Breakdown", renderTable(rows, columns));
        }
        return toolResult(lines.join("\n"), data);
      });
    },
  );
}
