/**
 * Account tools. Accounts are CallRail's top-level object; every other
 * resource is scoped beneath an account.
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

const ACCOUNT_FIELDS = [
  { label: "Name", key: "name" },
  { label: "ID", key: "id" },
  { label: "Numeric ID", key: "numeric_id" },
  { label: "Outbound recording enabled", key: "outbound_recording_enabled" },
  { label: "HIPAA account", key: "hipaa_account" },
];

const listAccountsShape = {
  ...sortShape,
  ...searchShape,
  ...fieldsShape,
  hipaa_account: z
    .boolean()
    .optional()
    .describe("Filter to only HIPAA (true) or only non-HIPAA (false) accounts."),
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListAccountsArgs = z.infer<z.ZodObject<typeof listAccountsShape>>;

const getAccountShape = {
  account_id: accountIdField,
  ...fieldsShape,
  response_format: responseFormatField,
} as const;
type GetAccountArgs = z.infer<z.ZodObject<typeof getAccountShape>>;

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_accounts",
    {
      title: "List CallRail Accounts",
      description: `List all CallRail accounts the API key can access.

Accounts are the top-level object in CallRail. Use this first to discover account IDs needed by every other tool. The API key only sees accounts its user can see in the CallRail UI.

Args:
  - sort ('name'): sort field. order ('asc'|'desc').
  - search (string): matches account name.
  - hipaa_account (boolean): filter HIPAA / non-HIPAA accounts.
  - fields (string): add 'numeric_id' to include the 9-digit numeric account ID.
  - page, per_page: pagination.
  - response_format ('markdown'|'json').

Returns: paginated list with each account's id, name, outbound_recording_enabled, hipaa_account (and numeric_id if requested).`,
      inputSchema: listAccountsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListAccountsArgs) => {
      return runTool(async () => {
        const params = {
          sort: args.sort,
          order: args.order,
          search: args.search,
          fields: args.fields,
          hipaa_account: args.hipaa_account,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>("/a.json", { params });
        return formatList({
          data,
          collectionKey: "accounts",
          format: args.response_format,
          title: "CallRail Accounts",
          fieldSpecs: ACCOUNT_FIELDS,
          titleKey: "name",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_get_account",
    {
      title: "Get a CallRail Account",
      description: `Retrieve a single CallRail account by ID.

Args:
  - account_id (string): the account ID (optional if CALLRAIL_ACCOUNT_ID is set).
  - fields (string): add 'numeric_id' to include the numeric account ID.
  - response_format ('markdown'|'json').

Returns: the account's id, name, outbound_recording_enabled, hipaa_account.`,
      inputSchema: getAccountShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: GetAccountArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const data = await callrailRequest<Record<string, unknown>>(`/a/${accountId}.json`, {
          params: { fields: args.fields },
        });
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: `Account ${accountId}`,
          fieldSpecs: ACCOUNT_FIELDS,
        });
      });
    },
  );
}
