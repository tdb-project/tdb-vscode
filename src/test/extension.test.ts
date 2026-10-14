import * as assert from "node:assert";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";
import type { TdbExtensionApi } from "../extension";

type Seen = { method: string | undefined; headers: http.IncomingHttpHeaders };

// Answers just enough MCP for VS Code to start a server, and records the
// headers of every request so the tests can check what VS Code sent.
async function startFakeTdb(): Promise<{ url: string; seen: Seen[]; close(): void }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const json = (status: number, payload?: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(payload === undefined ? undefined : JSON.stringify(payload));
      };
      if (req.method === "GET" && req.url === "/") {
        return json(200, { product: "The Data-Bridge", version: "9.9.9" });
      }
      if (req.method !== "POST") {
        return json(405);
      }
      const msg = JSON.parse(body) as { id?: number; method?: string };
      seen.push({ method: msg.method, headers: req.headers });
      if (msg.id === undefined) {
        return json(202);
      }
      const result =
        msg.method === "initialize"
          ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake-tdb", version: "0" } }
          : msg.method === "tools/list"
            ? { tools: [{ name: "fake_tool", description: "fake", inputSchema: { type: "object" } }] }
            : {};
      json(200, { jsonrpc: "2.0", id: msg.id, result });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

async function waitFor(condition: () => boolean | Promise<boolean>, message: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(message());
}

suite("extension", () => {
  let api: TdbExtensionApi;
  let fake: Awaited<ReturnType<typeof startFakeTdb>>;

  suiteSetup(async () => {
    console.log(`VS Code ${vscode.version}`);
    api = await vscode.extensions.getExtension<TdbExtensionApi>("tdb-project.tdb-vscode")!.activate();
    fake = await startFakeTdb();
  });
  suiteTeardown(() => fake.close());
  teardown(() => vscode.commands.executeCommand("tdb.disconnect"));

  test("VS Code connects with the stored key, the pinned protocol version and no Origin", async () => {
    await vscode.commands.executeCommand("tdb.connect", fake.url, "k-test-123");
    const initialize = () => fake.seen.find((s) => s.method === "initialize");
    await waitFor(
      async () => {
        await vscode.commands.executeCommand("workbench.mcp.startServer", "*", { autoTrustChanges: true });
        return initialize() !== undefined;
      },
      () => `VS Code never sent initialize; saw ${JSON.stringify(fake.seen.map((s) => s.method))}`,
    );
    const headers = initialize()!.headers;
    assert.strictEqual(headers.authorization, "Bearer k-test-123");
    assert.strictEqual(headers["mcp-protocol-version"], "2025-11-25");
    assert.strictEqual(headers.origin, undefined);
  });

  test("disconnect removes the key and the server URL", async () => {
    await vscode.commands.executeCommand("tdb.connect", fake.url, "k-test-123");
    assert.strictEqual(await api.hasApiKey(), true);

    await vscode.commands.executeCommand("tdb.disconnect");
    assert.strictEqual(await api.hasApiKey(), false);
    assert.strictEqual(vscode.workspace.getConfiguration("tdb").get("serverUrl"), "");
  });

  test("status bar: not connected, reachable with version, unreachable", async () => {
    await waitFor(
      () => api.statusText() === "$(plug) TDB",
      () => `not-connected status was ${api.statusText()}`,
    );

    await vscode.commands.executeCommand("tdb.connect", fake.url, "k-test-123");
    await waitFor(
      () => api.statusText() === "$(database) TDB 9.9.9",
      () => `reachable status was ${api.statusText()}`,
    );

    await vscode.commands.executeCommand("tdb.connect", "http://127.0.0.1:1", "k-test-123");
    await waitFor(
      () => api.statusText() === "$(warning) TDB",
      () => `unreachable status was ${api.statusText()}`,
    );
  });
});
