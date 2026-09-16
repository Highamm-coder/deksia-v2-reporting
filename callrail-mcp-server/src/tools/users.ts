/**
 * User tools. Users are the people with logins on the CallRail account.
 * Read-only here (create/update/delete are intentionally omitted).
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

const USER_FIELDS = [
  { label: "Name", key: "name" },
  { label: "First name", key: "first_name" },
  { label: "Last name", key: "last_name" },
  { label: "Email", key: "email" },
  { label: "Role", key: "role" },
  { label: "Companies", key: "companies" },
  { label: "Created at", key: "created_at" },
  { label: "ID", key: "id" },
];

const listUsersShape = {
  account_id: accountIdField,
  company_id: z
    .string()
    .optional()
    .describe("Limit to users assigned to a single company ID."),
  ...searchShape,
  ...sortShape,
  ...fieldsShape,
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListUsersArgs = z.infer<z.ZodObject<typeof listUsersShape>>;

const getUserShape = {
  account_id: accountIdField,
  user_id: z.string().min(1).describe("The user ID (e.g. 'USR8154748ae6bd4e278a7cddd38a662f4f')."),
  ...fieldsShape,
  response_format: responseFormatField,
} as const;
type GetUserArgs = z.infer<z.ZodObject<typeof getUserShape>>;

export function registerUserTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_users",
    {
      title: "List CallRail Users",
      description: `List users (people with logins) on an account.

Args:
  - account_id (optional with env default), company_id.
  - search (string): matches first_name, last_name, or email.
  - sort ('email' or 'created_at') with order ('asc'|'desc').
  - fields, page, per_page, response_format.

Returns: paginated users with name, email, role, and company assignments.`,
      inputSchema: listUsersShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListUsersArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          search: args.search,
          sort: args.sort,
          order: args.order,
          fields: args.fields,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/users.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "users",
          format: args.response_format,
          title: "Users",
          fieldSpecs: USER_FIELDS,
          titleKey: "name",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_get_user",
    {
      title: "Get a CallRail User",
      description: `Retrieve a single user by ID.

Args: account_id (optional with env default), user_id (required), fields, response_format.
Returns: the user object with name, email, role, and company assignments.`,
      inputSchema: getUserShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: GetUserArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/users/${args.user_id}.json`,
          { params: { fields: args.fields } },
        );
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: `User ${args.user_id}`,
          fieldSpecs: USER_FIELDS,
        });
      });
    },
  );
}
