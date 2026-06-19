/**
 * Text-message (conversation) tools. CallRail exposes SMS/MMS conversations
 * under the /text-messages path. Covers listing, retrieving, and sending.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callrailRequest, resolveAccountId } from "../services/client.js";
import { formatList, formatSingle, runTool } from "../services/format.js";
import {
  accountIdField,
  dateShape,
  fieldsShape,
  paginationShape,
  responseFormatField,
  ResponseFormat,
  searchShape,
} from "../schemas/common.js";

const CONVERSATION_FIELDS = [
  { label: "Customer", key: "customer_name" },
  { label: "Customer phone", key: "customer_phone_number" },
  { label: "Current tracking #", key: "current_tracking_number" },
  { label: "Last message at", key: "last_message_at" },
  { label: "State", key: "state" },
  { label: "Lead status", key: "lead_status" },
  { label: "Source", key: "source" },
  { label: "Company ID", key: "company_id" },
  { label: "Recent messages", key: "recent_messages" },
  { label: "ID", key: "id" },
];

const listConversationsShape = {
  account_id: accountIdField,
  company_id: z.string().optional().describe("Limit to conversations for a single company ID."),
  ...dateShape,
  ...searchShape,
  ...fieldsShape,
  ...paginationShape,
  response_format: responseFormatField,
} as const;
type ListConversationsArgs = z.infer<z.ZodObject<typeof listConversationsShape>>;

const getConversationShape = {
  account_id: accountIdField,
  conversation_id: z.string().min(1).describe("The conversation ID (e.g. 'KZaGR')."),
  ...fieldsShape,
  response_format: responseFormatField,
} as const;
type GetConversationArgs = z.infer<z.ZodObject<typeof getConversationShape>>;

const sendTextShape = {
  account_id: accountIdField,
  company_id: z.string().min(1).describe("Company ID the message is sent from (required)."),
  customer_phone_number: z
    .string()
    .min(1)
    .describe("Recipient customer phone number in E.164 format, e.g. '+14044442233'."),
  tracking_number: z
    .string()
    .min(1)
    .describe("SMS-enabled tracking number to send from, in E.164 format, e.g. '+17703334455'."),
  content: z.string().min(1).describe("The text message body. Include opt-out language where appropriate."),
  media_url: z
    .string()
    .url()
    .optional()
    .describe("Publicly accessible media URL to send as an MMS attachment (optional)."),
  response_format: responseFormatField,
} as const;
type SendTextArgs = z.infer<z.ZodObject<typeof sendTextShape>>;

export function registerConversationTools(server: McpServer): void {
  server.registerTool(
    "callrail_list_conversations",
    {
      title: "List CallRail Text Conversations",
      description: `List SMS/MMS text-message conversations in an account, newest first. Each conversation includes up to two of its most recent messages.

Args:
  - account_id (optional with env default), company_id.
  - Date filter: date_range OR start_date/end_date, plus time_zone.
  - search (string): matches customer_phone_number or customer_name.
  - fields (string): add 'lead_status' and/or 'source'.
  - page, per_page, response_format.

Returns: paginated conversations with customer/tracking numbers, state, last_message_at, and recent_messages.`,
      inputSchema: listConversationsShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: ListConversationsArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const params = {
          company_id: args.company_id,
          date_range: args.date_range,
          start_date: args.start_date,
          end_date: args.end_date,
          time_zone: args.time_zone,
          search: args.search,
          fields: args.fields,
          page: args.page,
          per_page: args.per_page,
        };
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/text-messages.json`,
          { params },
        );
        return formatList({
          data,
          collectionKey: "conversations",
          format: args.response_format,
          title: "Text Conversations",
          fieldSpecs: CONVERSATION_FIELDS,
          titleKey: "customer_name",
          idKey: "id",
          requestedPage: args.page,
          requestedPerPage: args.per_page,
        });
      });
    },
  );

  server.registerTool(
    "callrail_get_conversation",
    {
      title: "Get a CallRail Text Conversation",
      description: `Retrieve a single text-message conversation by ID, including its full message history.

Args: account_id (optional with env default), conversation_id (required), fields (string: 'lead_status', 'source'), response_format.
Returns: the conversation object with customer/tracking details and messages.`,
      inputSchema: getConversationShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: GetConversationArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/text-messages/${args.conversation_id}.json`,
          { params: { fields: args.fields } },
        );
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: `Conversation ${args.conversation_id}`,
          fieldSpecs: CONVERSATION_FIELDS,
        });
      });
    },
  );

  server.registerTool(
    "callrail_send_text_message",
    {
      title: "Send a CallRail Text Message",
      description: `Send an outbound SMS (or MMS, with media_url) from a tracking number to a customer. Starts a new conversation or continues an existing one.

IMPORTANT: Sends a REAL text message and is rate limited. Only person-to-person messaging is permitted — bulk/automated blasts violate CallRail's terms. You must identify who you are; if no opt-out keyword (STOP, CANCEL, UNSUBSCRIBE, QUIT, END) is present on the first message to a lead, CallRail appends opt-out instructions automatically.

Args:
  - account_id (optional with env default).
  - company_id (required), customer_phone_number (required, E.164), tracking_number (required, E.164, SMS-enabled), content (required).
  - media_url (optional): publicly accessible URL for an MMS attachment.
  - response_format ('markdown'|'json').

Returns: the message/conversation object including recent_messages.`,
      inputSchema: sendTextShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args: SendTextArgs) => {
      return runTool(async () => {
        const accountId = resolveAccountId(args.account_id);
        const body: Record<string, unknown> = {
          company_id: args.company_id,
          customer_phone_number: args.customer_phone_number,
          tracking_number: args.tracking_number,
          content: args.content,
        };
        if (args.media_url !== undefined) body.media_url = args.media_url;
        const data = await callrailRequest<Record<string, unknown>>(
          `/a/${accountId}/text-messages.json`,
          { method: "POST", data: body },
        );
        return formatSingle({
          data,
          format: args.response_format ?? ResponseFormat.MARKDOWN,
          title: "Text message sent",
          fieldSpecs: CONVERSATION_FIELDS,
        });
      });
    },
  );
}
