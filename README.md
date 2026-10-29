# The Data-Bridge (TDB) for VS Code

Connect VS Code's agent mode to a [TDB](https://docs.tdb.jiracorp.co.in) server. Your
agent gets governed, read-only SQL over your data, and every tool call is recorded in
TDB's audit log.

The extension does one job: it registers your TDB server as an MCP server in VS Code.
It keeps your API key in VS Code's encrypted secret storage, so you never write a key
into `mcp.json` or your settings.

## Requirements

- **VS Code 1.101 or later**, desktop. VS Code for the Web (vscode.dev) is not
  supported: the browser sends an `Origin` header, and TDB refuses cross-origin
  requests.
- **A running TDB server** and an API key for it.
  - **Community edition (free):** one CSV source, the `query_source` tool. See the
    [quickstart](https://docs.tdb.jiracorp.co.in/getting-started/community/).
  - **Enterprise:** databases and seven tools. Every key sees all seven; a key with
    an `allowed_tools` list is refused when it calls a tool outside that list.
- An agent that can use MCP tools, such as GitHub Copilot in agent mode.

## Getting started

1. Open the Command Palette and run **TDB: Connect to Server**.
2. Enter the server's base URL, for example `http://localhost:8000`.
3. Enter your API key. It is stored in VS Code's secret storage.
4. In agent mode, open the tools picker. **The Data-Bridge (TDB)** is listed with its
   tools. Ask your agent a question about your data.

Use a local **Agent** chat. VS Code passes MCP servers on to **Copilot CLI** chat
sessions without their headers, and a Copilot CLI session cannot read VS Code's secret
storage, so it reaches TDB without your key and every call is refused with
`missing_api_key` (seen with VS Code 1.144). To use TDB from Copilot CLI, add it to
`~/.copilot/mcp-config.json` as described in
[IDE setup](https://docs.tdb.jiracorp.co.in/getting-started/ide-setup/#vs-code).

The status bar shows the connection: the server's version when it is reachable, a
warning when it is not, and a plug when you are not connected. Click it to connect
or change servers.

## Commands

| Command | What it does |
|---|---|
| **TDB: Connect to Server** | Sets the server URL and API key. Run it again to switch servers. |
| **TDB: Disconnect** | Deletes the stored key and clears the URL. The server disappears from VS Code. |

## Settings

| Setting | Default | Description |
|---|---|---|
| `tdb.serverUrl` | `""` | Base URL of the TDB server. Set by **TDB: Connect to Server**. |

The API key is never a setting.

There is no Lean Mode setting here. TDB's smaller results for agents
([Lean Mode](https://docs.tdb.jiracorp.co.in/api/mcp/#saving-tokens-lean-mode), about a
third fewer tokens on a 100-row answer) are set on the server: per call (*"use
lean: true"*), per API key in enterprise, or for everyone with `TDB_LEAN_MODE=on`. They
reach VS Code with no change here.

## What the extension sends

- To your TDB server only: `Authorization: Bearer <your key>` on every MCP request.
- `MCP-Protocol-Version: 2025-11-25` on every request. VS Code agrees this version
  with the server when it connects, but does not repeat it on later requests. Without
  the header, TDB would answer those requests with an older protocol, so your agent
  would miss tool titles, read-only hints and structured results. If VS Code starts
  sending its own header, its value is used instead.
- An unauthenticated `GET /` to your server every 60 seconds, for the status bar.

The extension collects no telemetry. TDB's audit log records each call with
`mcp_client` set to `Visual Studio Code/<version>`. See
[audit logging](https://docs.tdb.jiracorp.co.in/security/audit/).

## OAuth (Enterprise)

This extension authenticates with an API key or a JWT. To sign in with OAuth 2.1
instead, configure VS Code's own MCP client in `mcp.json`. It runs the OAuth flow
itself. See [IDE setup](https://docs.tdb.jiracorp.co.in/getting-started/ide-setup/).

## Other editors

The extension is also published on [Open VSX](https://open-vsx.org/extension/tdb-project/tdb-vscode).
It needs an editor that supports VS Code's MCP server provider API. For any other
MCP client, configure it by hand as described in
[IDE setup](https://docs.tdb.jiracorp.co.in/getting-started/ide-setup/).

## License

The extension is MIT licensed. TDB Community is AGPLv3. TDB Enterprise is commercial.
