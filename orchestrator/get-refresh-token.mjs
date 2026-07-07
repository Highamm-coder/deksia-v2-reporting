#!/usr/bin/env node
// One-time helper: get a Google OAuth refresh token for the daily sync.
//
// Run it ONCE, locally, signed into the Google account that already has access to
// your GA4 properties + the Ledger sheet. It prints a refresh token you paste into
// the GitHub secret GOOGLE_OAUTH_REFRESH_TOKEN. You never need to run it again
// unless the token is revoked.
//
// Prereq: a Google Cloud OAuth client of type "Desktop app" (see HEADLESS-SETUP.md).
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=xxx GOOGLE_OAUTH_CLIENT_SECRET=yyy \
//     node orchestrator/get-refresh-token.mjs
//
// It opens a local URL, you approve in the browser, and it captures the token.

import http from "node:http";
import { spawn } from "node:child_process";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET env vars first.");
  process.exit(1);
}

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
].join(" ");

const PORT = 4599;
const REDIRECT = `http://localhost:${PORT}`;

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPES,
  access_type: "offline",   // ask for a refresh token
  prompt: "consent",        // force a refresh token even on re-auth
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  if (!code) { res.writeHead(400).end("No code"); return; }
  try {
    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT, grant_type: "authorization_code",
      }),
    }).then((r) => r.json());
    res.writeHead(200, { "Content-Type": "text/html" });
    if (tok.refresh_token) {
      res.end("<h2>Success. Refresh token captured — return to your terminal.</h2>");
      console.log("\n=== GOOGLE_OAUTH_REFRESH_TOKEN (paste into the GitHub secret) ===\n");
      console.log(tok.refresh_token);
      console.log("\n================================================================\n");
    } else {
      res.end("<h2>No refresh token returned. See terminal.</h2>");
      console.error("No refresh_token in response:", JSON.stringify(tok, null, 2));
      console.error("If you've authorized before, revoke prior access at https://myaccount.google.com/permissions and retry.");
    }
  } catch (e) {
    res.writeHead(500).end("Error: " + e.message);
    console.error(e);
  } finally {
    setTimeout(() => { server.close(); process.exit(0); }, 500);
  }
});

server.listen(PORT, () => {
  console.log("\nOpen this URL, and sign in as the Google account that can see all your GA4 properties:\n");
  console.log(authUrl + "\n");
  // best-effort auto-open (macOS 'open', Linux 'xdg-open')
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [authUrl], { stdio: "ignore", detached: true }).on("error", () => {});
});
