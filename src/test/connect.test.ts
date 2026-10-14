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

  test("VS Code lists query_source after connecting", async () => {
    await vscode.commands.executeCommand("tdb.connect", url, key);

    const deadline = Date.now() + 30_000;
    let names: string[] = [];
    while (Date.now() < deadline) {
      await vscode.commands.executeCommand("workbench.mcp.startServer", "*", {
        autoTrustChanges: true,
        waitForLiveTools: true,
      });
      names = vscode.lm.tools.map((t) => t.name);
      const tool = names.find((n) => n.includes("query_source"));
      if (tool) {
        const result = await vscode.lm.invokeTool(tool, {
          input: { sql: "SELECT count(*) AS n FROM data" },
          toolInvocationToken: undefined,
        });
        const text = result.content
          .map((p) => (p instanceof vscode.LanguageModelTextPart ? p.value : ""))
          .join("");
        assert.match(text, /"n":\s*2/, JSON.stringify(result.content));
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.fail(`query_source never appeared; lm.tools = ${JSON.stringify(names)}`);
  });
});
