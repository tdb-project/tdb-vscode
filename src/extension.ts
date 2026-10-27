import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import * as vscode from "vscode";

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

const API_KEY_SECRET = "tdb.apiKey";
const FINGERPRINT_SALT_SECRET = "tdb.fingerprintSalt";
const STATUS_REFRESH_MS = 60_000;

// VS Code negotiates this version at initialize but never sends the header
// afterwards, so TDB would answer every later request as 2024-11-05. If VS Code
// starts sending its own header, its value overrides this one.
const MCP_PROTOCOL_VERSION = "2025-11-25";

// Returned from activate() so the tests can observe what VS Code's API does not
// expose. It reveals whether a key is stored, never the key.
export interface TdbExtensionApi {
  statusText(): string;
  hasApiKey(): Promise<boolean>;
}

export function activate(context: vscode.ExtensionContext): TdbExtensionApi {
  const changed = new vscode.EventEmitter<void>();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.show();
  const refreshStatus = () => void updateStatus(status);
  const timer = setInterval(refreshStatus, STATUS_REFRESH_MS);

  context.subscriptions.push(
    changed,
    status,
    { dispose: () => clearInterval(timer) },
    changed.event(refreshStatus),
    vscode.lm.registerMcpServerDefinitionProvider("tdb.mcp", {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: async () => {
        for (;;) {
          const url = serverUrl();
          if (!url) {
            return [];
          }
          // VS Code identifies this server by its label and keeps reusing the URL and
          // key it first resolved until `version` changes, so the version carries a
          // fingerprint of both: switching either makes it a new server. VS Code stores
          // and shows the version, and keys can be operator-chosen, so it is a salted
          // scrypt rather than a bare hash a weak key falls to.
          const key = (await context.secrets.get(API_KEY_SECRET)) ?? "";
          const fingerprint = (await scryptAsync(`${url}\n${key}`, await fingerprintSalt(context), 6)).toString("hex");
          // The scrypt takes ~100 ms. Disconnect clears the key and then the URL, each
          // firing a change, and VS Code keeps whichever call resolves last — so a call
          // that started before the URL was cleared must not return the old server.
          if (serverUrl() !== url || ((await context.secrets.get(API_KEY_SECRET)) ?? "") !== key) {
            continue;
          }
          return [
            new vscode.McpHttpServerDefinition(
              "The Data-Bridge (TDB)",
              vscode.Uri.parse(`${url}/v1/mcp`),
              { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
              fingerprint,
            ),
          ];
        }
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
    vscode.commands.registerCommand("tdb.disconnect", () => disconnect(context)),
  );
  refreshStatus();
  return {
    statusText: () => status.text,
    hasApiKey: async () => (await context.secrets.get(API_KEY_SECRET)) !== undefined,
  };
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

async function fingerprintSalt(context: vscode.ExtensionContext): Promise<string> {
  let salt = await context.secrets.get(FINGERPRINT_SALT_SECRET);
  if (!salt) {
    salt = randomBytes(32).toString("hex");
    await context.secrets.store(FINGERPRINT_SALT_SECRET, salt);
  }
  return salt;
}

async function disconnect(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(API_KEY_SECRET);
  await vscode.workspace.getConfiguration("tdb").update("serverUrl", undefined, vscode.ConfigurationTarget.Global);
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

async function updateStatus(status: vscode.StatusBarItem): Promise<void> {
  const url = serverUrl();
  status.command = "tdb.connect";
  if (!url) {
    status.text = "$(plug) TDB";
    status.tooltip = "TDB: not connected. Click to connect.";
    return;
  }
  try {
    const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(5_000) });
    const version = res.ok ? ((await res.json()) as { version?: unknown }).version : undefined;
    if (typeof version !== "string") {
      throw new Error(`HTTP ${res.status}`);
    }
    status.text = `$(database) TDB ${version}`;
    status.tooltip = `TDB ${version} at ${url}. Click to change server.`;
  } catch {
    status.text = "$(warning) TDB";
    status.tooltip = `TDB unreachable at ${url}. Click to change server.`;
  }
}
