import * as vscode from 'vscode';
import { runKaggleCLI } from '../kaggleCli';

export interface DatasetItem {
  ref: string;
  url: string;
}

export class DatasetsProvider implements vscode.TreeDataProvider<DatasetItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private searchTerm: string = '';
  private showMyDatasets: boolean = true; // Start with user's datasets by default

  constructor(
    private context: vscode.ExtensionContext,
    private getUsername: () => Promise<string | undefined>
  ) {
    // Register command for searching datasets from the tree view
    vscode.commands.registerCommand('kaggle.searchDatasetsTree', async () => {
      const options = [
        { label: 'Search All Datasets', description: 'Search public datasets by keyword' },
        { label: 'Show My Datasets', description: 'Show only your own datasets' },
        { label: 'Show Popular Datasets', description: 'Show popular public datasets' },
      ];

      const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'What would you like to do?',
      });

      if (!choice) return;

      if (choice.label === 'Search All Datasets') {
        const term = await vscode.window.showInputBox({
          prompt: 'Enter search terms (e.g., "covid", "housing prices", "nlp")',
        });
        if (term !== undefined) {
          this.searchTerm = term.trim();
          this.showMyDatasets = false;
          this.refresh();
          if (term.trim()) {
            vscode.window.showInformationMessage(`Searching datasets for: "${term.trim()}"`);
          } else {
            vscode.window.showInformationMessage('Showing popular datasets');
          }
        }
      } else if (choice.label === 'Show My Datasets') {
        this.searchTerm = '';
        this.showMyDatasets = true;
        this.refresh();
        vscode.window.showInformationMessage('Showing your datasets');
      } else if (choice.label === 'Show Popular Datasets') {
        this.searchTerm = '';
        this.showMyDatasets = false;
        this.refresh();
        vscode.window.showInformationMessage('Showing popular datasets');
      }
    });
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DatasetItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.ref, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'dataset';
    item.tooltip = element.url;
    item.iconPath = new vscode.ThemeIcon('database');
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.parse(element.url)],
    };

    // Add status description
    if (this.showMyDatasets) {
      item.description = '(Popular)'; // Will show "My Dataset" only if user actually has datasets
    } else if (this.searchTerm) {
      item.description = `(Search: "${this.searchTerm}")`;
    }

    return item;
  }

  async getChildren(): Promise<DatasetItem[]> {
    try {
      // Build command arguments based on current mode
      const args = ['datasets', 'list', '--csv', '-p', '50'];

      if (this.showMyDatasets) {
        // Try to show user's own datasets first
        args.push('-m');
        const res = await runKaggleCLI(this.context, args);
        const lines = res.stdout.trim().split(/\r?\n/);

        // If user has no datasets, fall back to popular datasets
        if (lines.length <= 1 || lines[0].includes('No datasets found')) {
          vscode.window.showInformationMessage(
            'You have no published datasets. Showing popular datasets instead.'
          );
          // Remove the '-m' flag and show popular datasets
          args.pop();
          const popularRes = await runKaggleCLI(this.context, args);
          return this.parseDatasets(popularRes.stdout.trim(), false);
        }

        return this.parseDatasets(res.stdout.trim(), true);
      } else if (this.searchTerm && this.searchTerm.trim()) {
        // Search public datasets with the search term
        args.push('-s', this.searchTerm.trim());
        const res = await runKaggleCLI(this.context, args);
        return this.parseDatasets(res.stdout.trim(), false);
      } else {
        // Show popular public datasets
        const res = await runKaggleCLI(this.context, args);
        return this.parseDatasets(res.stdout.trim(), false);
      }
    } catch (error) {
      console.error('Error fetching datasets:', error);
      return [];
    }
  }

  private parseDatasets(csvData: string, _isMyDatasets: boolean): DatasetItem[] {
    const lines = csvData.split(/\r?\n/);

    if (lines.length <= 1) {
      return [];
    }

    const header = lines.shift() || '';
    const refIdx = header.split(',').findIndex(h => /^ref$/i.test(h.trim().replace(/"/g, '')));
    const urlIdx = header.split(',').findIndex(h => /^url$/i.test(h.trim().replace(/"/g, '')));
    const items: DatasetItem[] = [];

    for (const line of lines) {
      const cols = splitCsv(line);
      const ref = cols[refIdx] || '';
      const url = cols[urlIdx] || (ref ? `https://www.kaggle.com/datasets/${ref}` : '');
      if (ref) items.push({ ref, url });
    }

    return items;
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
