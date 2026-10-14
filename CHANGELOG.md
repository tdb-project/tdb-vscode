# Changelog

## 0.1.0

First release.

- Registers a TDB server with VS Code's MCP support.
- **TDB: Connect to Server** stores the server URL in settings and the API key in
  VS Code's secret storage. **TDB: Disconnect** removes both.
- Sends `MCP-Protocol-Version: 2025-11-25`, which VS Code negotiates but does not
  send itself.
- Status bar shows the server's version, or that it is unreachable or not connected.
