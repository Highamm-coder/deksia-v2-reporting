/**
 * Tracker tools (read-only). Trackers are the tracking numbers (source or
 * session/keyword pools) that route calls. Creating/updating trackers involves
 * complex call-flow and source configuration and is intentionally omitted here.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callrailRequest, resolveAccountId } from "../services/client.js";
import { formatList, formatSingle, runTool } from "../services/format.js";
import {
  accountIdField,
  fieldsShape,
  paginationShape,
  responseFormatField,
  ResponseFormat,
  searchShape,
  sortShape,
} from "../schemas/common.js";

const TRACKER_FIELDS = [
  { label: "Name", key: "name" },
  { label: "ID", key: "id" },
  { label: "Type", key: "type" },
  { label: "Status", key: "status" },
  { label: "Destination", key: "destination_number" },
  { label: "Tracking numbers", key: "tracking_numbers" },
  { label: "SMS enabled", key: "sms_enabled" },
  { label: "Company", key: "company.name" },
  { label: "Company ID", key: "company.id" },
  { label: "Created", key: "created_at" },
  { label: "Disabled at", key: "disabled_at" },
];

const listTrackersShape = {
  account_id: accountIdField,
  company_id: z
    .string()
    .optional()
    .describe("Limit to trackers belonging to a single company ID."),
  type: z.enum(["session", "source"]).optional().describe("Filter by tracker type."),
  status: z.enum(["active", "disabled"]).optional().describe("Filter by tracker status."),
  ...searchShape,
  ...sortShape,
  ...fieldsShape,
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListTrackersArgs = z.infer<z.ZodObject<typeof listTrackersShape>>;

const getTrackerShape = {
  account_id: accountIdField,
  tracker_id: z.string().min(1).describe("The tracker ID (e.g. 'TRK8154748ae6...')."),
  ...fieldsShape,
  response_format: responseFormatField,
} as const;
type GetTrackerArgs = z.infer<z.ZodObject<typeof getTrackerShape>>;

export function registerTrackerTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_trackers",
    {
      title: "List CallRail Trackers",
      description: `List tracking numbers (trackers) in an account.

Args:
  - account_id (optional with env default), company_id.
  - type: session|source. status: active|disabled. search: matches name. sort: 'name'. order: asc|desc.
  - fields (string), page, per_page, response_format.

Returns: paginated trackers with id, name, type, status, destination_number, tracking_numbers, sms_enabled, company, call_flow, and source config.`,
      inputSchema: listTrackersShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListTrackersArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          type: args.type,
          status: args.status,
          search: args.search,
          sort: args.sort,
          order: args.order,
          fields: args.fields,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/trackers.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "trackers",
          format: args.response_format,
          title: "Trackers",
          fieldSpecs: TRACKER_FIELDS,
          titleKey: "name",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_get_tracker",
    {
      title: "Get a CallRail Tracker",
      description: `Retrieve a single tracker (tracking number) by ID.

Args: account_id (optional with env default), tracker_id (required), fields (string), response_format.
Returns: the tracker object with its routing (call_flow), source config, and tracking numbers.`,
      inputSchema: getTrackerShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: GetTrackerArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/trackers/${args.tracker_id}.json`,
          { params: { fields: args.fields } },
        );
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: `Tracker ${args.tracker_id}`,
          fieldSpecs: TRACKER_FIELDS,
        });
      });
    },
  );
}
