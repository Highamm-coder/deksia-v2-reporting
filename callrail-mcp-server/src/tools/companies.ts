/**
 * Company tools. Companies live within an account and own trackers, calls,
 * forms, and conversations.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callrailRequest, resolveAccountId } from "../services/client.js";
import { formatList, formatSingle, runTool, toolResult } from "../services/format.js";
import {
  accountIdField,
  fieldsShape,
  paginationShape,
  responseFormatField,
  ResponseFormat,
  searchShape,
  sortShape,
} from "../schemas/common.js";

const COMPANY_FIELDS = [
  { label: "Name", key: "name" },
  { label: "ID", key: "id" },
  { label: "Status", key: "status" },
  { label: "Time zone", key: "time_zone" },
  { label: "DNI active", key: "dni_active" },
  { label: "Script URL", key: "script_url" },
  { label: "Lead scoring", key: "lead_scoring_enabled" },
  { label: "Form capture", key: "form_capture" },
  { label: "Created", key: "created_at" },
  { label: "Disabled at", key: "disabled_at" },
];

const listCompaniesShape = {
  account_id: accountIdField,
  status: z
    .enum(["active", "disabled"])
    .optional()
    .describe("Filter by company status."),
  ...searchShape,
  ...sortShape,
  ...fieldsShape,
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListCompaniesArgs = z.infer<z.ZodObject<typeof listCompaniesShape>>;

const getCompanyShape = {
  account_id: accountIdField,
  company_id: z.string().min(1).describe("The company ID (e.g. 'COM8154748ae6...')."),
  ...fieldsShape,
  response_format: responseFormatField,
} as const;
type GetCompanyArgs = z.infer<z.ZodObject<typeof getCompanyShape>>;

const createCompanyShape = {
  account_id: accountIdField,
  name: z.string().min(1).describe("Company name."),
  time_zone: z
    .string()
    .optional()
    .describe("IANA time zone for the company (e.g. 'America/New_York'). Defaults applied if omitted."),
  response_format: responseFormatField,
} as const;
type CreateCompanyArgs = z.infer<z.ZodObject<typeof createCompanyShape>>;

const updateCompanyShape = {
  account_id: accountIdField,
  company_id: z.string().min(1).describe("The company ID to update."),
  name: z.string().optional().describe("New company name."),
  time_zone: z.string().optional().describe("New IANA time zone for the company."),
  response_format: responseFormatField,
} as const;
type UpdateCompanyArgs = z.infer<z.ZodObject<typeof updateCompanyShape>>;

export function registerCompanyTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_companies",
    {
      title: "List CallRail Companies",
      description: `List companies within an account.

Args:
  - account_id (optional with env default).
  - status: active|disabled. search: matches name. sort: 'name'. order: asc|desc.
  - fields (string): add e.g. 'verified_caller_ids'.
  - page, per_page, response_format.

Returns: paginated companies with id, name, status, time_zone, dni_active, script_url, and more.`,
      inputSchema: listCompaniesShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListCompaniesArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          status: args.status,
          search: args.search,
          sort: args.sort,
          order: args.order,
          fields: args.fields,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/companies.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "companies",
          format: args.response_format,
          title: "Companies",
          fieldSpecs: COMPANY_FIELDS,
          titleKey: "name",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_get_company",
    {
      title: "Get a CallRail Company",
      description: `Retrieve a single company by ID.

Args: account_id (optional with env default), company_id (required), fields (string), response_format.
Returns: the company object (id, name, status, time_zone, DNI/script settings, etc.).`,
      inputSchema: getCompanyShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: GetCompanyArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/companies/${args.company_id}.json`,
          { params: { fields: args.fields } },
        );
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: `Company ${args.company_id}`,
          fieldSpecs: COMPANY_FIELDS,
        });
      });
    },
  );

  server.registerTool(
    "callrail_create_company",
    {
      title: "Create a CallRail Company",
      description: `Create a new company within an account.

Args: account_id (optional with env default), name (required), time_zone (optional IANA tz), response_format.
Returns: the newly created company object, including its id and tracking script_url.`,
      inputSchema: createCompanyShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args: CreateCompanyArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const body: Record<string, unknown> = { name: args.name };
        if (args.time_zone !== undefined) body.time_zone = args.time_zone;
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/companies.json`,
          { method: "POST", data: body },
        );
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: "Company created",
          fieldSpecs: COMPANY_FIELDS,
        });
      });
    },
  );

  server.registerTool(
    "callrail_update_company",
    {
      title: "Update a CallRail Company",
      description: `Update a company's name and/or time zone.

Args: account_id (optional with env default), company_id (required), name (optional), time_zone (optional), response_format.
Returns: the updated company object.`,
      inputSchema: updateCompanyShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: UpdateCompanyArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.time_zone !== undefined) body.time_zone = args.time_zone;
        if (Object.keys(body).length === 0) {
          return toolResult("Error: Provide at least one of name or time_zone to update.");
        }
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/companies/${args.company_id}.json`,
          { method: "PUT", data: body },
        );
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: `Updated company ${args.company_id}`,
          fieldSpecs: COMPANY_FIELDS,
        });
      });
    },
  );
}
