/**
 * Tag tools. Tags label calls, form submissions, and conversations. They live
 * either at the company level or the account level.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callrailRequest, resolveAccountId } from "../services/client.js";
import { formatList, formatSingle, runTool } from "../services/format.js";
import {
  accountIdField,
  paginationShape,
  responseFormatField,
  ResponseFormat,
} from "../schemas/common.js";

const TAG_FIELDS = [
  { label: "Name", key: "name" },
  { label: "Tag level", key: "tag_level" },
  { label: "Color", key: "color" },
  { label: "Background color", key: "background_color" },
  { label: "Status", key: "status" },
  { label: "Company ID", key: "company_id" },
  { label: "Created at", key: "created_at" },
  { label: "ID", key: "id" },
];

const listTagsShape = {
  account_id: accountIdField,
  company_id: z
    .string()
    .optional()
    .describe("Limit to tags belonging to a single company ID (company-level tags)."),
  status: z
    .enum(["enabled", "disabled"])
    .optional()
    .describe("Filter by tag status: 'enabled' or 'disabled'."),
  tag_level: z
    .enum(["company", "account"])
    .optional()
    .describe("Filter by tag level: 'company' (scoped to one company) or 'account' (shared across the account)."),
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListTagsArgs = z.infer<z.ZodObject<typeof listTagsShape>>;

const createTagShape = {
  account_id: accountIdField,
  name: z.string().min(1).describe("The tag name (required), e.g. 'Qualified Lead'."),
  company_id: z
    .string()
    .optional()
    .describe(
      "Company ID to scope the tag to. Required for a company-level tag; omit for an account-level tag. " +
        "Do not combine with tag_level='account'.",
    ),
  color: z
    .string()
    .optional()
    .describe(
      "Tag color keyword, e.g. 'gray1', 'blue1', 'green1', 'red1', 'orange1', 'purple1'. Defaults to a system color if omitted.",
    ),
  tag_level: z
    .enum(["company", "account"])
    .optional()
    .describe(
      "Tag level: 'company' (default when company_id is set) or 'account' (shared). Use 'account' WITHOUT company_id for an account-wide tag.",
    ),
  response_format: responseFormatField,
} as const;
type CreateTagArgs = z.infer<z.ZodObject<typeof createTagShape>>;

export function registerTagTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_tags",
    {
      title: "List CallRail Tags",
      description: `List tags defined in an account. Tags can be applied to calls, form submissions, and text conversations.

Args:
  - account_id (optional with env default), company_id.
  - status ('enabled'|'disabled'), tag_level ('company'|'account').
  - page, per_page, response_format.

Returns: paginated tags with name, color, level, status, and company association.`,
      inputSchema: listTagsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListTagsArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          status: args.status,
          tag_level: args.tag_level,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/tags.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "tags",
          format: args.response_format,
          title: "Tags",
          fieldSpecs: TAG_FIELDS,
          titleKey: "name",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_create_tag",
    {
      title: "Create a CallRail Tag",
      description: `Create a new tag, either scoped to a company or shared across the account.

Args:
  - account_id (optional with env default).
  - name (required).
  - company_id (set for a company-level tag; omit for account-level).
  - color (optional keyword, e.g. 'blue1').
  - tag_level ('company'|'account'). Use 'account' without company_id for an account-wide tag.
  - response_format.

Returns: the created tag object.`,
      inputSchema: createTagShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args: CreateTagArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const body: Record<string, unknown> = { name: args.name };
        if (args.company_id !== undefined) body.company_id = args.company_id;
        if (args.color !== undefined) body.color = args.color;
        if (args.tag_level !== undefined) body.tag_level = args.tag_level;
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/tags.json`,
          { method: "POST", data: body },
        );
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: "Tag created",
          fieldSpecs: TAG_FIELDS,
        });
      });
    },
  );
}
