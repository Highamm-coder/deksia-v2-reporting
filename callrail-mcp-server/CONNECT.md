# Connecting the CallRail MCP server to Claude Code

The server is already built (`dist/index.js`) and smoke-tested. Two steps remain — both involve
your CallRail API key, so you do them (Claude never handles the secret).

## 1. Get a CallRail API key
CallRail app → **Account settings → API Keys** → create a key. It inherits that user's permissions,
so use a user that can see every client company you want to report on.

## 2. Register the server with Claude Code (pick ONE method)

**A. CLI (recommended — `--scope user` makes it available in every project):**
```bash
claude mcp add callrail --scope user \
  --env CALLRAIL_API_KEY=YOUR_CALLRAIL_API_KEY \
  -- node "/Users/matthewhigham/Documents/Documents - Matthew’s MacBook Air/Ai/CallRail MCP/callrail-mcp-server/dist/index.js"
```

**B. JSON config** (`~/.claude.json` mcpServers, or Claude Desktop's `claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "callrail": {
      "command": "node",
      "args": ["/Users/matthewhigham/Documents/Documents - Matthew’s MacBook Air/Ai/CallRail MCP/callrail-mcp-server/dist/index.js"],
      "env": { "CALLRAIL_API_KEY": "YOUR_CALLRAIL_API_KEY" }
    }
  }
}
```

**C. `.env` file** (already created here from `.env.example`): edit the `CALLRAIL_API_KEY=` line.
The env var in the client config (A/B) takes precedence over `.env` if both are set.

Optional: set `CALLRAIL_ACCOUNT_ID` once known (likely one master account for all Deksia clients)
so tools can omit `account_id`.

## 3. Restart the Claude Code session
A newly-registered MCP server's `callrail_*` tools only load on a fresh session. After restart,
ask Claude to **"bootstrap CallRail IDs"** — it will run `callrail_list_accounts` →
`callrail_list_companies` and fill the **CallRail Account ID / Company ID** columns in
`_Reporting Config` by matching company names to client tabs. Then the MQL / calls / form-fill
goal rows light up in the dashboard.

## Notes
- `.env` is git-ignored — never commit the key.
- Rebuild after any source change: `npm run build`.
- Rate limits: ~1,000 req/hr (lower for SMS/outbound); data older than 25 months is unavailable.
- The reporting skill uses only read + summary tools (`callrail_get_call_summary`,
  `callrail_get_form_summary`, `callrail_list_accounts`, `callrail_list_companies`).

## Running as a persistent HTTP service (current setup)

The server now loads `.env` (via `dotenv`), so the API key only needs to live in `.env`
(line must read `CALLRAIL_API_KEY=ctrk_…` — the `CALLRAIL_API_KEY=` label is required).

**Start it (detached, survives the session; not reboot):**
```bash
cd "/Users/matthewhigham/Documents/Documents - Matthew’s MacBook Air/Ai/CallRail MCP/callrail-mcp-server"
nohup env TRANSPORT=http PORT=3000 node dist/index.js > callrail-mcp.out.log 2>&1 & disown
```
**Check it's up:** `lsof -nP -iTCP:3000 -sTCP:LISTEN` (expect a `node` LISTEN line), or
`curl -s -X POST http://localhost:3000/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'`
**Stop it:** `lsof -ti:3000 | xargs kill`
**After a reboot** it won't auto-start — re-run the start command (or ask to set up a launchd auto-start service for hands-off persistence).

**Register with Claude Code (one-time), then restart the session:**
```bash
claude mcp remove callrail            # remove the old stdio entry (add -s user if it was user-scoped)
claude mcp add --transport http callrail http://localhost:3000/mcp --scope user
claude mcp list                       # verify "callrail" → http://localhost:3000/mcp
```
The `callrail_*` tools load on the next session start.
