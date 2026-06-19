/**
 * Lead tools. Leads are the people/entities CallRail has identified across
 * calls, texts, and form submissions. Timeline shows a lead's full activity.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callrailRequest, resolveAccountId } from "../services/client.js";
import { formatList, runTool, toolResult } from "../services/format.js";
import {
  accountIdField,
  fieldsShape,
  paginationShape,
  responseFormatField,
  ResponseFormat,
  sortShape,
} from "../schemas/common.js";

const LEAD_FIELDS = [
  { label: "Name", key: "customer_name" },
  { label: "Phone", key: "customer_phone_number" },
  { label: "Email", key: "email" },
  { label: "Lead status", key: "lead_status" },
  { label: "Source", key: "source" },
  { label: "Medium", key: "medium" },
  { label: "Campaign", key: "campaign" },
  { label: "Company", key: "company_name" },
  { label: "Interactions", key: "total_interactions" },
  { label: "Created at", key: "created_at" },
  { label: "ID", key: "id" },
];

/**
 * Render a lead timeline response. The payload is not a flat collection: it
 * has a `lead` summary object (attribution, touchpoints, tags) plus a
 * `timeline` array of heterogeneous events (call / form_submission / sms),
 * each keyed by `type` and `event_date`. We surface both.
 */
export function renderTimelineMarkdown(data: Record<string, unknown>, leadId: string): string {
  const lead = (data.lead as Record<string, unknown> | undefined) ?? {};
  const events = Array.isArray(data.timeline)
    ? (data.timeline as Record<string, unknown>[])
    : [];
  const total = data.total_records as number | undefined;
  const page = data.page as number | undefined;
  const totalPages = data.total_pages as number | undefined;

  const lines: string[] = [`# Lead ${leadId} Timeline`, ""];

  const name = lead.customer_name ?? "(unknown)";
  const phone = lead.customer_phone_number ? ` — ${lead.customer_phone_number}` : "";
  lines.push(`**Lead:** ${name}${phone}`);
  const attrParts: string[] = [];
  if (lead.source != null) attrParts.push(`source ${lead.source}`);
  if (lead.medium != null) attrParts.push(`medium ${lead.medium}`);
  if (lead.campaign != null) attrParts.push(`campaign ${lead.campaign}`);
  if (lead.total_interactions != null) attrParts.push(`${lead.total_interactions} interactions`);
  if (attrParts.length) lines.push(`**Attribution:** ${attrParts.join(", ")}.`);
  if (Array.isArray(lead.tags) && lead.tags.length) {
    const tagNames = (lead.tags as Record<string, unknown>[])
      .map((t) => t?.name)
      .filter(Boolean)
      .join(", ");
    if (tagNames) lines.push(`**Tags:** ${tagNames}.`);
  }

  lines.push("");
  const countLine =
    `Showing ${events.length}` +
    (total != null ? ` of ${total}` : "") +
    ` timeline event(s)` +
    (page != null ? ` — page ${page}${totalPages != null ? ` of ${totalPages}` : ""}` : "") +
    ".";
  lines.push(countLine);
  if (page != null && totalPages != null && page < totalPages) {
    lines.push(`_More events available — request page ${page + 1}._`);
  }

  if (!events.length) {
    lines.push("", "No timeline events found.");
    return lines.join("\n");
  }

  for (const ev of events) {
    const type = ev.type != null ? String(ev.type) : "event";
    const when = ev.event_date != null ? String(ev.event_date) : "";
    lines.push("", `## ${type}${when ? ` — ${when}` : ""}`);
    const detail: string[] = [];
    if (ev.direction != null) detail.push(`Direction: ${ev.direction}`);
    if (ev.duration != null) detail.push(`Duration: ${ev.duration}s`);
    if (ev.answered != null) detail.push(`Answered: ${ev.answered}`);
    if (ev.customer_name != null) detail.push(`Customer: ${ev.customer_name}`);
    if (ev.customer_phone_number != null) detail.push(`Phone: ${ev.customer_phone_number}`);
    if (ev.form_name != null) detail.push(`Form: ${ev.form_name}`);
    if (ev.form_url != null) detail.push(`Form URL: ${ev.form_url}`);
    if (ev.message_content != null) detail.push(`Message: ${ev.message_content}`);
    if (ev.id != null) detail.push(`ID: ${ev.id}`);
    lines.push(detail.length ? detail.map((d) => `- ${d}`).join("\n") : "_(no detail)_");
  }

  return lines.join("\n");
}

const listLeadsShape = {
  account_id: accountIdField,
  company_id: z
    .string()
    .optional()
    .describe("Limit to leads associated with a single company ID."),
  ...sortShape,
  ...fieldsShape,
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListLeadsArgs = z.infer<z.ZodObject<typeof listLeadsShape>>;

const leadTimelineShape = {
  account_id: accountIdField,
  lead_id: z.string().min(1).describe("The lead ID whose activity timeline to retrieve."),
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type LeadTimelineArgs = z.infer<z.ZodObject<typeof leadTimelineShape>>;

export function registerLeadTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_leads",
    {
      title: "List CallRail Leads",
      description: `List leads in an account. A lead aggregates a person's interactions (calls, texts, forms) and carries a lead status.

Args:
  - account_id (optional with env default), company_id.
  - sort ('created_at', 'name', or 'email') with order ('asc'|'desc').
  - fields, page, per_page, response_format.

Returns: paginated leads with contact details, lead status, and company association.`,
      inputSchema: listLeadsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListLeadsArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          sort: args.sort,
          order: args.order,
          fields: args.fields,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/leads.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "leads",
          format: args.response_format,
          title: "Leads",
          fieldSpecs: LEAD_FIELDS,
          titleKey: "customer_name",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_get_lead_timeline",
    {
      title: "Get a CallRail Lead Timeline",
      description: `Retrieve the full activity timeline for a single lead: every call, text, and form submission tied to that lead, in order.

Args: account_id (optional with env default), lead_id (required), page, per_page, response_format.
Returns: paginated timeline activities for the lead.`,
      inputSchema: leadTimelineShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: LeadTimelineArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = { page: args.page, per_page: args.per_page };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/leads/${args.lead_id}/timeline.json`,
          { params },
        );
        const format = args.response_format ?? ResponseFormat.MARKDOWN;
        if (format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(data, null, 2), data);
        }
        return toolResult(renderTimelineMarkdown(data, args.lead_id), data);
      });
    },
  );
}
