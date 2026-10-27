# Changelog

## 0.1.3

- **Security:** the server version VS Code stores and shows for TDB was derived from
  the server URL and API key with a plain SHA-256, so a short or guessable key could
  be recovered from it offline. It is now a salted scrypt hash, with the salt kept in
  VS Code's secret storage beside the key. After updating, VS Code sees the TDB server
  as changed once and reconnects; nothing needs re-entering.
- Build tooling only (not part of the installed extension): dependency updates that
  clear every open advisory, and a read-only token for CI.

## 0.1.2

- **Docs:** the README now says correctly how enterprise tool access works. Every key
  sees all seven tools; a key with an `allowed_tools` list is refused when it calls a
  tool outside it. It had said tools were governed by the key's role, which does not
  affect MCP tools. No code change.

## 0.1.1

- **Fix:** running **TDB: Connect to Server** with a new API key or a new server URL
  now takes effect straight away. Before, VS Code kept using the first URL and key
  it had connected with until it was restarted, even after **TDB: Disconnect**.
  Anyone who switches servers or rotates keys should update.

## 0.1.0

First release.

- Registers a TDB server with VS Code's MCP support.
- **TDB: Connect to Server** stores the server URL in settings and the API key in
  VS Code's secret storage. **TDB: Disconnect** removes both.
- Sends `MCP-Protocol-Version: 2025-11-25`, which VS Code negotiates but does not
  send itself.
- Status bar shows the server's version, or that it is unreachable or not connected.
