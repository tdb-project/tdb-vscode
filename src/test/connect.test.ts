import * as assert from "node:assert";
import * as vscode from "vscode";

const url = process.env.TDB_TEST_URL;
const key = process.env.TDB_TEST_KEY;

suite("against a live TDB server", function () {
  suiteSetup(function () {
    if (!url || !key) {
      this.skip();
    }
  });

  teardown(() => vscode.commands.executeCommand("tdb.disconnect"));

  test("VS Code lists and calls query_source after connecting", async () => {
    await vscode.commands.executeCommand("tdb.connect", url, key);
    await assertQuerySourceWorks();
  });

  test("disconnect removes the server; reconnect works without a reload", async () => {
    await vscode.commands.executeCommand("tdb.connect", url, key);
    await assertQuerySourceWorks();

    await vscode.commands.executeCommand("tdb.disconnect");
    await waitFor(() => !findQuerySource(), "query_source still listed after disconnect");

    await vscode.commands.executeCommand("tdb.connect", url, key);
    await assertQuerySourceWorks();
  });
});

function findQuerySource(): string | undefined {
  return vscode.lm.tools.map((t) => t.name).find((n) => n.includes("query_source"));
}

async function waitFor(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.fail(`${message}; lm.tools = ${JSON.stringify(vscode.lm.tools.map((t) => t.name))}`);
}

async function assertQuerySourceWorks(): Promise<void> {
  await waitFor(async () => {
    await vscode.commands.executeCommand("workbench.mcp.startServer", "*", {
      autoTrustChanges: true,
      waitForLiveTools: true,
    });
    return findQuerySource() !== undefined;
  }, "query_source never appeared");

  const result = await vscode.lm.invokeTool(findQuerySource()!, {
    input: { sql: "SELECT count(*) AS n FROM data" },
    toolInvocationToken: undefined,
  });
  const text = result.content.map((p) => (p instanceof vscode.LanguageModelTextPart ? p.value : "")).join("");
  assert.match(text, /"n":\s*2/, JSON.stringify(result.content));
}
