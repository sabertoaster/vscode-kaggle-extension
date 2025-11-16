import * as vscode from 'vscode';
import { runKaggleCLI } from '../kaggleCli';

export interface KernelItem {
  ref: string;
  url: string;
}

export class MyNotebooksProvider implements vscode.TreeDataProvider<KernelItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private searchTerm: string = '';
  private showMyNotebooks: boolean = true;
  private language: string = 'all';
  private kernelType: string = 'all';

  constructor(
    private context: vscode.ExtensionContext,
    private getUsername: () => Promise<string | undefined>
  ) {
    // Register command for searching notebooks from the tree view
    vscode.commands.registerCommand('kaggle.searchNotebooksTree', async () => {
      const options = [
        { label: 'Search All Notebooks', description: 'Search public notebooks by keyword' },
        { label: 'Show My Notebooks', description: 'Show only your own notebooks' },
        { label: 'Filter by Language', description: 'Show notebooks by programming language' },
        { label: 'Filter by Type', description: 'Show notebooks or scripts only' },
        {
          label: 'Browse by Competition',
          description: 'Find notebooks for a specific competition',
        },
      ];

      const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'What would you like to do?',
      });

      if (!choice) return;

      if (choice.label === 'Search All Notebooks') {
        const term = await vscode.window.showInputBox({
          prompt: 'Enter search terms (e.g., "machine learning", "data visualization", "nlp")',
        });
        if (term !== undefined) {
          this.searchTerm = term.trim();
          this.showMyNotebooks = false;
          this.refresh();
          if (term.trim()) {
            vscode.window.showInformationMessage(`Searching notebooks for: "${term.trim()}"`);
          } else {
            vscode.window.showInformationMessage('Showing popular notebooks');
          }
        }
      } else if (choice.label === 'Show My Notebooks') {
        this.searchTerm = '';
        this.showMyNotebooks = true;
        this.refresh();
        vscode.window.showInformationMessage('Showing your notebooks');
      } else if (choice.label === 'Filter by Language') {
        const langOptions = [
          { label: 'All Languages', value: 'all' },
          { label: 'Python', value: 'python' },
          { label: 'R', value: 'r' },
          { label: 'SQL', value: 'sqlite' },
          { label: 'Julia', value: 'julia' },
        ];
        const langChoice = await vscode.window.showQuickPick(langOptions, {
          placeHolder: 'Select programming language',
        });
        if (langChoice) {
          this.language = langChoice.value;
          this.showMyNotebooks = false;
          this.searchTerm = '';
          this.refresh();
          vscode.window.showInformationMessage(`Showing ${langChoice.label} notebooks`);
        }
      } else if (choice.label === 'Filter by Type') {
        const typeOptions = [
          { label: 'All Types', value: 'all' },
          { label: 'Notebooks Only', value: 'notebook' },
          { label: 'Scripts Only', value: 'script' },
        ];
        const typeChoice = await vscode.window.showQuickPick(typeOptions, {
          placeHolder: 'Select notebook type',
        });
        if (typeChoice) {
          this.kernelType = typeChoice.value;
          this.showMyNotebooks = false;
          this.searchTerm = '';
          this.refresh();
          vscode.window.showInformationMessage(`Showing ${typeChoice.label.toLowerCase()}`);
        }
      } else if (choice.label === 'Browse by Competition') {
        const compName = await vscode.window.showInputBox({
          prompt: 'Enter competition name (e.g., "titanic", "house-prices")',
        });
        if (compName) {
          this.searchTerm = '';
          this.showMyNotebooks = false;
          // We'll use the competition filter in getChildren
          this.refresh();
          vscode.window.showInformationMessage(`Showing notebooks for competition: "${compName}"`);
        }
      }
    });
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: KernelItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.ref, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'kernel';
    item.tooltip = element.url;
    item.iconPath = new vscode.ThemeIcon('notebook');
    item.command = {
      command: 'kaggle.openNotebookLocally',
      title: 'Open Locally',
      arguments: [element],
    };

    // Add status description
    if (this.showMyNotebooks) {
      item.description = '(My Notebook)';
    } else if (this.searchTerm) {
      item.description = `(Search: "${this.searchTerm}")`;
    } else if (this.language !== 'all') {
      item.description = `(${this.language.toUpperCase()})`;
    } else if (this.kernelType !== 'all') {
      item.description = `(${this.kernelType})`;
    }

    return item;
  }

  async getChildren(): Promise<KernelItem[]> {
    try {
      // Build command arguments based on current mode
      const args = ['kernels', 'list', '--csv', '--page-size', '50'];

      if (this.showMyNotebooks) {
        // Show user's own notebooks
        args.push('--mine');
      } else {
        // Search/filter public notebooks
        if (this.searchTerm && this.searchTerm.trim()) {
          args.push('-s', this.searchTerm.trim());
        }

        if (this.language !== 'all') {
          args.push('--language', this.language);
        }

        if (this.kernelType !== 'all') {
          args.push('--kernel-type', this.kernelType);
        }
      }

      const res = await runKaggleCLI(this.context, args);
      const stdout = res.stdout.trim();

      if (!isCsvWithRef(stdout)) {
        return [];
      }

      return parseKernelsCsv(stdout);
    } catch (error) {
      console.error('Error fetching notebooks:', error);
      // Fallback to user's notebooks if search fails
      if (!this.showMyNotebooks) {
        try {
          const res = await runKaggleCLI(this.context, ['kernels', 'list', '--csv', '--mine']);
          return parseKernelsCsv(res.stdout.trim());
        } catch {
          return [];
        }
      }
      return [];
    }
  }
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.replace(/^\"|\"$/g, ''));
}

function isCsvWithRef(csv: string): boolean {
  const first = csv.split(/\r?\n/)[0] || '';
  return /(^|,)\s*ref\s*(,|$)/i.test(first);
}

function parseKernelsCsv(csv: string): KernelItem[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines.shift();
  if (!header) return [];
  const headers = header.split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  const refIdx = headers.indexOf('ref');
  const urlIdx = headers.indexOf('url');
  if (refIdx === -1) return [];
  const items: KernelItem[] = [];
  for (const line of lines) {
    const cols = splitCsv(line);
    const ref = cols[refIdx] || '';
    const url = urlIdx >= 0 ? cols[urlIdx] || '' : '';
    const resolvedUrl = url || (ref ? `https://www.kaggle.com/code/${ref}` : '');
    if (ref) items.push({ ref, url: resolvedUrl });
  }
  return items;
}
