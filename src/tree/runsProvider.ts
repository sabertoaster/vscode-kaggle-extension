import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

interface RunItem {
  label: string;
  url?: string;
  status?: 'complete' | 'pending';
  isLatest?: boolean;
}

export class RunsProvider implements vscode.TreeDataProvider<RunItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: RunItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    if (element.url) {
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [vscode.Uri.parse(element.url)],
      };
      item.contextValue = 'run';
      item.tooltip = element.url;
    }
    if (element.isLatest) {
      if (element.status === 'complete') {
        item.iconPath = new vscode.ThemeIcon('check');
        item.description = 'outputs ready';
        item.tooltip = (item.tooltip ? item.tooltip + ' • ' : '') + 'Outputs downloaded';
      } else if (element.status === 'pending') {
        item.iconPath = new vscode.ThemeIcon('clock');
        item.description = 'waiting';
        item.tooltip = (item.tooltip ? item.tooltip + ' • ' : '') + 'Waiting for outputs';
      }
    }
    return item;
  }

  getChildren(): Thenable<RunItem[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return Promise.resolve([]);
    const logFile = path.join(root, '.kaggle-run.log');
    return new Promise(async resolve => {
      try {
        const txt = await fs.promises.readFile(logFile, 'utf8');
        const lines = txt.trim().split(/\r?\n/).slice(-50);
        const items = lines.map(l => {
          const [ts, url] = l.split(/\s+\|\s+/);
          return { label: ts, url } as RunItem;
        });

        // Mark last (most recent) run with a simple status based on outputs presence
        if (items.length > 0) {
          const latest = items[items.length - 1];
          latest.isLatest = true;
          try {
            const ymlPath = path.join(root, 'kaggle.yml');
            const ymlRaw = await fs.promises.readFile(ymlPath, 'utf8').catch(() => '');
            const yml = (ymlRaw ? (yaml.load(ymlRaw) as Record<string, unknown>) : {}) || {};
            const outDir = path.join(
              root,
              ((yml.outputs as Record<string, unknown>)?.download_to as string) || '.kaggle-outputs'
            );
            const has = await hasAnyRecentFile(outDir, new Date(latest.label).getTime());
            latest.status = has ? 'complete' : 'pending';
          } catch {
            /* ignore */
          }
        }

        resolve(items);
      } catch {
        resolve([]);
      }
    });
  }
}

async function hasAnyRecentFile(dir: string, sinceMs: number): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (await hasAnyRecentFile(p, sinceMs)) return true;
      } else if (e.isFile()) {
        const st = await fs.promises.stat(p);
        if (st.mtimeMs >= sinceMs) return true;
      }
    }
  } catch {
    /* missing dir: treat as no files */
  }
  return false;
}
