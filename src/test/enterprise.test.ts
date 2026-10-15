import * as assert from "node:assert";
import * as vscode from "vscode";
import type { TdbExtensionApi } from "../extension";

// Runs only against a TDB Enterprise server, which CI does not have. Each key
// is created by the caller: an admin key (TDB_API_KEYS), a managed `read` key,
// and a managed key whose allowed_tools is query_source + schema_source.
const url = process.env.TDB_ENT_URL;
const adminKey = process.env.TDB_ENT_ADMIN_KEY;
const readKey = process.env.TDB_ENT_READ_KEY;
const narrowKey = process.env.TDB_ENT_NARROW_KEY;
const expiredUrl = process.env.TDB_ENT_EXPIRED_URL;

const ENTERPRISE_TOOLS = [
  "aggregate_source",
  "filter_source",
  "list_views",
  "preview_source",
  "query_source",
  "run_view",
  "schema_source",
];

function tdbTools(): string[] {
  const names = vscode.lm.tools.map((t) => t.name);
  return ENTERPRISE_TOOLS.filter((tool) => names.some((n) => n.endsWith(tool)));
}

function toolName(tool: string): string | undefined {
  return vscode.lm.tools.map((t) => t.name).find((n) => n.endsWith(tool));
}

async function waitFor(condition: () => boolean | Promise<boolean>, message: () => string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.fail(message());
}

async function waitForTools(expected: string[]): Promise<void> {
  await waitFor(
    async () => {
      await vscode.commands.executeCommand("workbench.mcp.startServer", "*", { autoTrustChanges: true, waitForLiveTools: true });
      return JSON.stringify(tdbTools()) === JSON.stringify(expected);
    },
    () => `expected ${JSON.stringify(expected)}, VS Code lists ${JSON.stringify(tdbTools())}`,
  );
}

async function invoke(tool: string, input: object): Promise<string> {
  const result = await vscode.lm.invokeTool(toolName(tool)!, { input, toolInvocationToken: undefined });
  return result.content.map((p) => (p instanceof vscode.LanguageModelTextPart ? p.value : "")).join("");
}

suite("against TDB Enterprise", function () {
  let api: TdbExtensionApi;

  suiteSetup(async function () {
    if (!url || !adminKey || !readKey || !narrowKey) {
      this.skip();
    }
    api = await vscode.extensions.getExtension<TdbExtensionApi>("tdb-project.tdb-vscode")!.activate();
  });

  teardown(() => vscode.commands.executeCommand("tdb.disconnect"));

  test("an admin key sees all seven tools, and they answer", async () => {
    await vscode.commands.executeCommand("tdb.connect", url, adminKey);
    await waitForTools(ENTERPRISE_TOOLS);
    assert.match(await invoke("query_source", { source_name: "orders", sql: "SELECT count(*) AS n FROM data" }), /"n":\s*3/);
    assert.match(await invoke("preview_source", { source_name: "orders", limit: 2 }), /"truncated":\s*true/);
    await waitFor(
      () => api.statusText().startsWith("$(database) TDB 0.18"),
      () => `status was ${api.statusText()}`,
    );
  });

  test("a read key sees the tools its role allows", async () => {
    await vscode.commands.executeCommand("tdb.connect", url, readKey);
    await waitForTools(ENTERPRISE_TOOLS);
    assert.match(await invoke("query_source", { source_name: "orders", sql: "SELECT count(*) AS n FROM data" }), /"n":\s*3/);
  });

  test("a key narrowed by allowed_tools may call only those tools", async () => {
    // tools/list is not filtered by allowed_tools (docs/api/mcp.md); the refusal
    // comes on the call, as a tool error.
    await vscode.commands.executeCommand("tdb.connect", url, narrowKey);
    await waitForTools(ENTERPRISE_TOOLS);
    assert.match(await invoke("query_source", { source_name: "orders", sql: "SELECT count(*) AS n FROM data" }), /"n":\s*3/);
    assert.match(await invoke("preview_source", { source_name: "orders", limit: 1 }), /not permitted for this API key/);
  });

  test("switching keys with Connect, without Disconnect, uses the new key", async () => {
    await vscode.commands.executeCommand("tdb.connect", url, adminKey);
    await waitForTools(ENTERPRISE_TOOLS);
    assert.match(await invoke("preview_source", { source_name: "orders", limit: 1 }), /"rows"/);
    await vscode.commands.executeCommand("tdb.connect", url, narrowKey);
    await waitFor(
      async () => {
        await vscode.commands.executeCommand("workbench.mcp.startServer", "*", { autoTrustChanges: true, waitForLiveTools: true });
        return /not permitted for this API key/.test(await invoke("preview_source", { source_name: "orders", limit: 1 }));
      },
      () => "preview_source still answered with the old key after switching",
    );
  });

  test("an expired licence: the status bar still shows the version, and calls fail", async function () {
    if (!expiredUrl) {
      this.skip();
    }
    await vscode.commands.executeCommand("tdb.connect", expiredUrl, adminKey);
    await waitFor(
      () => api.statusText().startsWith("$(database) TDB 0.18"),
      () => `status was ${api.statusText()}`,
    );
    await vscode.commands.executeCommand("workbench.mcp.startServer", "*", { autoTrustChanges: true });
    let outcome: string;
    try {
      outcome = toolName("query_source")
        ? await invoke("query_source", { source_name: "orders", sql: "SELECT 1 AS one" })
        : "no tool listed";
    } catch (e) {
      outcome = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    console.log(`expired licence -> ${outcome.slice(0, 200)}`);
    assert.doesNotMatch(outcome, /"one":\s*1/);
  });
});
