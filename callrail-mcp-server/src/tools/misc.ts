/**
 * Miscellaneous read tools that do not warrant their own file:
 * integrations, outbound caller IDs, and per-call page views.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callrailRequest, resolveAccountId } from "../services/client.js";
import { formatList, runTool } from "../services/format.js";
import {
  accountIdField,
  paginationShape,
  responseFormatField,
} from "../schemas/common.js";

const INTEGRATION_FIELDS = [
  { label: "Type", key: "type" },
  { label: "State", key: "state" },
  { label: "Config", key: "config" },
  { label: "ID", key: "id" },
];

const CALLER_ID_FIELDS = [
  { label: "Phone number", key: "phone_number" },
  { label: "Name", key: "name" },
  { label: "Verified", key: "verified" },
  { label: "Created at", key: "created_at" },
  { label: "ID", key: "id" },
];

const PAGE_VIEW_FIELDS = [
  { label: "Page URL", key: "page_url" },
  { label: "Referrer URL", key: "referrer_url" },
  { label: "Viewed at", key: "created_at" },
];

const listIntegrationsShape = {
  account_id: accountIdField,
  company_id: z
    .string()
    .optional()
    .describe("Limit to integrations configured for a single company ID."),
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListIntegrationsArgs = z.infer<z.ZodObject<typeof listIntegrationsShape>>;

const listCallerIdsShape = {
  account_id: accountIdField,
  company_id: z
    .string()
    .optional()
    .describe("Limit to outbound caller IDs for a single company ID."),
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListCallerIdsArgs = z.infer<z.ZodObject<typeof listCallerIdsShape>>;

const pageViewsShape = {
  account_id: accountIdField,
  call_id: z.string().min(1).describe("The call ID whose visitor page-view history to retrieve."),
  time_zone: z
    .string()
    .optional()
    .describe("IANA time zone for interpreting view timestamps (e.g. 'America/New_York')."),
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type PageViewsArgs = z.infer<z.ZodObject<typeof pageViewsShape>>;

export function registerMiscTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_integrations",
    {
      title: "List CallRail Integrations",
      description: `List third-party integrations configured on an account (e.g. Google Analytics, CRMs, webhooks).

Args: account_id (optional with env default), company_id, page, per_page, response_format.
Returns: paginated integrations with type, state, and configuration.`,
      inputSchema: listIntegrationsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListIntegrationsArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/integrations.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "integrations",
          format: args.response_format,
          title: "Integrations",
          fieldSpecs: INTEGRATION_FIELDS,
          titleKey: "type",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_list_outbound_caller_ids",
    {
      title: "List CallRail Outbound Caller IDs",
      description: `List the verified caller IDs available for placing outbound calls. Use one of these phone numbers as the caller_id when creating an outbound call.

Args: account_id (optional with env default), company_id, page, per_page, response_format.
Returns: paginated caller IDs with phone number, name, and verification state.`,
      inputSchema: listCallerIdsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListCallerIdsArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/caller_ids.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "caller_ids",
          format: args.response_format,
          title: "Outbound Caller IDs",
          fieldSpecs: CALLER_ID_FIELDS,
          titleKey: "phone_number",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_get_call_page_views",
    {
      title: "Get CallRail Call Page Views",
      description: `Retrieve the website page-view history for the visitor session tied to a specific call. Shows the pages the caller browsed before calling, useful for attribution and intent.

Args: account_id (optional with env default), call_id (required), time_zone (optional), page, per_page, response_format.
Returns: paginated page views with URL, referrer, and timestamps for that call's session.`,
      inputSchema: pageViewsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: PageViewsArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          time_zone: args.time_zone,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/calls/${args.call_id}/page_views.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "page_views",
          format: args.response_format,
          title: `Page Views for Call ${args.call_id}`,
          fieldSpecs: PAGE_VIEW_FIELDS,
          titleKey: "page_url",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );
}
