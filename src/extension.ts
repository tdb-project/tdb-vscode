import * as vscode from "vscode";

const API_KEY_SECRET = "tdb.apiKey";

export function activate(context: vscode.ExtensionContext): void {
  const changed = new vscode.EventEmitter<void>();

  context.subscriptions.push(
    changed,
    vscode.lm.registerMcpServerDefinitionProvider("tdb.mcp", {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => {
        const url = serverUrl();
        return url
          ? [new vscode.McpHttpServerDefinition("The Data-Bridge (TDB)", vscode.Uri.parse(`${url}/v1/mcp`))]
          : [];
      },
      resolveMcpServerDefinition: async (server) => {
        const key = (await context.secrets.get(API_KEY_SECRET)) ?? (await promptForKey(context));
        if (!key || !(server instanceof vscode.McpHttpServerDefinition)) {
          return undefined;
        }
        server.headers = { ...server.headers, Authorization: `Bearer ${key}` };
        return server;
      },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tdb.serverUrl")) {
        changed.fire();
      }
    }),
    context.secrets.onDidChange((e) => {
      if (e.key === API_KEY_SECRET) {
        changed.fire();
      }
    }),
    vscode.commands.registerCommand("tdb.connect", (url?: string, key?: string) => connect(context, url, key)),
  );
}

function serverUrl(): string {
  return vscode.workspace.getConfiguration("tdb").get<string>("serverUrl", "").trim().replace(/\/+$/, "");
}

async function connect(context: vscode.ExtensionContext, url?: string, key?: string): Promise<void> {
  url ??= await vscode.window.showInputBox({
    title: "TDB: Connect to Server",
    prompt: "Base URL of the TDB server",
    value: serverUrl() || "http://localhost:8000",
    ignoreFocusOut: true,
    validateInput: (v) => (/^https?:\/\/[^\s/]+/.test(v.trim()) ? undefined : "Enter an http:// or https:// URL"),
  });
  if (!url) {
    return;
  }
  key ??= await promptForKey(context);
  if (!key) {
    return;
  }
  await context.secrets.store(API_KEY_SECRET, key);
  await vscode.workspace
    .getConfiguration("tdb")
    .update("serverUrl", url.trim().replace(/\/+$/, ""), vscode.ConfigurationTarget.Global);
}

async function promptForKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const key = (
    await vscode.window.showInputBox({
      title: "TDB API key",
      prompt: "Stored in VS Code's secret storage, never in settings",
      password: true,
      ignoreFocusOut: true,
    })
  )?.trim();
  if (key) {
    await context.secrets.store(API_KEY_SECRET, key);
  }
  return key || undefined;
}
