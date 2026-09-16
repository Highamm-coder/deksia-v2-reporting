# CallRail MCP Server

A self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server that wraps the [CallRail v3 REST API](https://apidocs.callrail.com/). It exposes call tracking, attribution, call and form summaries, text conversations, trackers, companies, leads, tags, and users as tools an LLM can call.

Built on the TypeScript MCP SDK. Runs over stdio (for local clients like Claude Desktop) or streamable HTTP (for a remote setup).

## Heads-up: CallRail also offers an official hosted MCP server

CallRail publishes its own remote MCP server, which needs zero maintenance on your side (no build, no hosting, no key handling beyond their OAuth flow). If you just want CallRail tools in a client and do not need to customize them, that hosted option is the lower-effort path. This project exists for when you want to run it yourself: full control over which endpoints are exposed, the ability to modify behavior, and no dependency on a third-party host.

## What you need

- Node.js 18 or newer.
- A CallRail API key. In the CallRail app: Account settings, then API Keys. The key authenticates as the user who created it and inherits that user's permissions.

## Setup

```bash
npm install
npm run build
```

Set your credentials. Either export them, or copy `.env.example` to `.env` (the file is git-ignored) and fill it in, or set them in your MCP client config (below).

```bash
export CALLRAIL_API_KEY="your_api_key_here"
export CALLRAIL_ACCOUNT_ID="optional_default_account_id"
```

`CALLRAIL_ACCOUNT_ID` is optional. If you set it, every tool can omit the `account_id` argument and falls back to this value. If you do not, call `callrail_list_accounts` first and pass the ID explicitly. Both the long token form (`ACC...`) and the 9-digit numeric ID work.

## Running

Stdio (default):

```bash
npm start
# or: node dist/index.js
```

Streamable HTTP:

```bash
TRANSPORT=http PORT=3000 node dist/index.js
# serves POST http://localhost:3000/mcp
```

### Use with Claude Desktop

Add this to your `claude_desktop_config.json` (Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "callrail": {
      "command": "node",
      "args": ["/absolute/path/to/callrail-mcp-server/dist/index.js"],
      "env": {
        "CALLRAIL_API_KEY": "your_api_key_here",
        "CALLRAIL_ACCOUNT_ID": "optional_default_account_id"
      }
    }
  }
}
```

### Inspect the tools

```bash
npm run inspect
```

This launches the MCP Inspector against the built server so you can browse and call tools by hand.

## Tools

Every tool takes an optional `response_format` (`markdown`, the default, or `json`) and, where relevant, an optional `account_id` that defaults to `CALLRAIL_ACCOUNT_ID`. List tools support offset pagination (`page`, `per_page`, max 250) and report whether more results exist.

### Accounts
- `callrail_list_accounts` — list accounts the API key can access.
- `callrail_get_account` — retrieve a single account.

### Calls
- `callrail_list_calls` — list calls with filters (company, tracker, call type, answer status, device, direction, lead status, tags, date range, search, field selection).
- `callrail_get_call` — retrieve a single call by ID.
- `callrail_get_call_summary` — aggregated call metrics grouped by source, keyword, campaign, referrer, landing page, or company.
- `callrail_get_call_timeseries` — call metrics bucketed over time.
- `callrail_create_outbound_call` — place an outbound call (US/CA only). Writes.
- `callrail_update_call` — set tags, note, value, lead status, customer name, or spam flag on a call. Writes.

### Companies
- `callrail_list_companies` — list companies (filter by status, search by name).
- `callrail_get_company` — retrieve a single company.
- `callrail_create_company` — create a company. Writes.
- `callrail_update_company` — rename a company or change its time zone. Writes.

### Trackers
- `callrail_list_trackers` — list tracking numbers (filter by company, type, status).
- `callrail_get_tracker` — retrieve a single tracker.

### Form submissions
- `callrail_list_form_submissions` — list tracked form submissions.
- `callrail_get_form_summary` — aggregated form metrics grouped by attribution dimension.

### Text conversations
- `callrail_list_conversations` — list SMS/MMS conversations.
- `callrail_get_conversation` — retrieve a conversation with full message history.
- `callrail_send_text_message` — send an SMS/MMS from a tracking number. Writes a real message; person-to-person only.

### Tags
- `callrail_list_tags` — list tags (filter by company, status, level).
- `callrail_create_tag` — create a company-level or account-level tag. Writes.

### Users
- `callrail_list_users` — list users on the account.
- `callrail_get_user` — retrieve a single user.

### Leads
- `callrail_list_leads` — list leads with status and attribution.
- `callrail_get_lead_timeline` — full activity timeline for one lead.

### Other
- `callrail_list_integrations` — list configured third-party integrations.
- `callrail_list_outbound_caller_ids` — list verified caller IDs for outbound calls.
- `callrail_get_call_page_views` — website page-view history for a call's visitor session.

## Intentionally not included

To keep the surface focused and avoid exposing high-risk or highly stateful configuration, these endpoints are deliberately omitted. Add them by following the existing tool pattern in `src/tools/` if you need them.

- Tracker create/update and message flows (complex call-flow configuration).
- Integration create/update and notification/summary-email management.
- User create, update, and delete; company disable and bulk multi-update.
- Binary call-recording download and MMS file uploads (the send tool accepts a `media_url` instead).

## How responses are shaped

Each tool returns both human-readable text and a structured payload. The list renderer is defensive: it locates the record array by its expected key but falls back to the actual array in the response if CallRail names a collection differently, so a key mismatch degrades to "rendered under another name" rather than silently showing zero records on a success. Responses that are a single object rather than a list (for example a lead timeline) are surfaced in full instead of reported as empty. Large list pulls are truncated to stay within a character budget; when that happens the response says so and suggests narrowing with filters, a smaller `per_page`, or the `fields` parameter. Errors come back as clean, actionable messages (missing config, auth failure, rate limiting, not found, validation) rather than raw stack traces, and oversized or HTML error bodies are not leaked into the message.

## Notes and limits

- CallRail deletes communication records older than 25 months. Requests for older data (including some `all_time` pulls) return an error.
- Rate limits apply (roughly 1,000 requests/hour and 10,000/day in general, lower for SMS and outbound calls). The server surfaces a clear message when you hit them.
- Date filtering accepts either a `date_range` keyword (for example `last_30_days`) or an explicit `start_date`/`end_date` pair, with an optional IANA `time_zone`.

## Project layout

```
src/
  index.ts             entry point, transport wiring, tool registration
  constants.ts         base URL, limits, env var names
  types.ts             shared response types
  schemas/common.ts    reusable Zod field fragments (pagination, dates, sort, etc.)
  services/
    client.ts          authenticated request layer and account resolution
    errors.ts          API and config error formatting
    format.ts          markdown/JSON rendering, truncation, runTool wrapper
  tools/               one file per resource group
```
