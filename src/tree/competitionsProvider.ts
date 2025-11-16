import * as vscode from 'vscode';
import { runKaggleCLI } from '../kaggleCli';

export interface CompetitionItem {
  ref: string;
  title: string;
  deadline: string;
  category: string;
  url: string;
}

export class CompetitionsProvider implements vscode.TreeDataProvider<CompetitionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private searchTerm: string = '';
  private category: string = 'featured'; // Start with featured competitions by default
  private group: string = 'general';

  constructor(
    private context: vscode.ExtensionContext,
    private getUsername: () => Promise<string | undefined>
  ) {
    // Register command for searching competitions from the tree view
    vscode.commands.registerCommand('kaggle.searchCompetitionsTree', async () => {
      const options = [
        { label: 'Search All Competitions', description: 'Search competitions by keyword' },
        { label: 'Show My Competitions', description: 'Show competitions you have entered' },
        { label: 'Featured Competitions', description: 'Show featured competitions' },
        { label: 'Research Competitions', description: 'Show research competitions' },
        { label: 'Getting Started', description: 'Show beginner-friendly competitions' },
      ];

      const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'What would you like to see?',
      });

      if (!choice) return;

      if (choice.label === 'Search All Competitions') {
        const term = await vscode.window.showInputBox({
          prompt: 'Enter search terms (e.g., "nlp", "computer vision", "tabular")',
        });
        if (term !== undefined) {
          this.searchTerm = term.trim();
          this.category = 'all';
          this.group = 'general';
          this.refresh();
          if (term.trim()) {
            vscode.window.showInformationMessage(`Searching competitions for: "${term.trim()}"`);
          } else {
            vscode.window.showInformationMessage('Showing all competitions');
          }
        }
      } else if (choice.label === 'Show My Competitions') {
        this.searchTerm = '';
        this.category = 'all';
        this.group = 'entered';
        this.refresh();
        vscode.window.showInformationMessage('Showing your entered competitions');
      } else if (choice.label === 'Featured Competitions') {
        this.searchTerm = '';
        this.category = 'featured';
        this.group = 'general';
        this.refresh();
        vscode.window.showInformationMessage('Showing featured competitions');
      } else if (choice.label === 'Research Competitions') {
        this.searchTerm = '';
        this.category = 'research';
        this.group = 'general';
        this.refresh();
        vscode.window.showInformationMessage('Showing research competitions');
      } else if (choice.label === 'Getting Started') {
        this.searchTerm = '';
        this.category = 'gettingStarted';
        this.group = 'general';
        this.refresh();
        vscode.window.showInformationMessage('Showing getting started competitions');
      }
    });
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CompetitionItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'competition';
    item.tooltip = `${element.title}\nCompetition: ${element.ref}\nDeadline: ${element.deadline}\nCategory: ${element.category}`;
    item.iconPath = new vscode.ThemeIcon('trophy');
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.parse(element.url)],
    };

    // Store the original element data for commands
    (item as any).ref = element.ref;
    (item as any).url = element.url;
    (item as any).title = element.title;

    // Add status description with shorter format
    if (this.group === 'entered') {
      item.description = 'Entered';
    } else if (this.category === 'featured') {
      item.description = 'Featured';
    } else if (this.searchTerm) {
      item.description = `Search: "${this.searchTerm}"`;
    } else {
      item.description = element.category;
    }

    return item;
  }

  async getChildren(element?: CompetitionItem): Promise<CompetitionItem[]> {
    if (!element) {
      // Root level - return competitions
      try {
        const competitions = await this.fetchCompetitions();
        return competitions;
      } catch (error) {
        console.error('Error fetching competitions:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Handle authentication errors
        if (errorMessage.includes('401')) {
          const message =
            this.group === 'entered'
              ? 'Unable to fetch your competitions. Your Kaggle API token may be expired or invalid.'
              : 'Unable to fetch competitions. Your Kaggle API token may be expired or invalid.';

          vscode.window
            .showErrorMessage(message, 'Refresh API Token', 'Learn More')
            .then(selection => {
              if (selection === 'Refresh API Token') {
                vscode.env.openExternal(
                  vscode.Uri.parse('https://www.kaggle.com/settings/account')
                );
              } else if (selection === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://www.kaggle.com/docs/api'));
              }
            });
        }
        return [];
      }
    }
    return [];
  }

  private async fetchCompetitions(): Promise<CompetitionItem[]> {
    // Build command arguments based on current mode
    const args = ['competitions', 'list', '--csv'];

    if (this.group === 'entered') {
      // Show user's entered competitions
      args.push('--group', this.group);
    } else {
      // Show general competitions with category filter
      args.push('--group', this.group);
      if (this.category && this.category !== 'all') {
        args.push('--category', this.category);
      }
    }

    if (this.searchTerm && this.searchTerm.trim()) {
      args.push('--search', this.searchTerm.trim());
    }

    const res = await runKaggleCLI(this.context, args);
    return this.parseCompetitions(res.stdout.trim());
  }

  private parseCompetitions(csvData: string): CompetitionItem[] {
    const lines = csvData.split(/\r?\n/);

    if (lines.length <= 1) {
      return [];
    }

    const header = lines.shift() || '';
    const headers = header.split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
    const refIdx = headers.indexOf('ref');
    const titleIdx = headers.indexOf('title');
    const deadlineIdx = headers.indexOf('deadline');
    const categoryIdx = headers.indexOf('category');
    const urlIdx = headers.indexOf('url');

    const items: CompetitionItem[] = [];

    for (const line of lines) {
      const cols = splitCsv(line);
      const rawRef = cols[refIdx] || '';
      const deadline = cols[deadlineIdx] || 'No deadline';
      const category = cols[categoryIdx] || 'General';

      // Extract competition slug from ref URL if it's a full URL
      let ref = rawRef;
      if (rawRef.startsWith('https://www.kaggle.com/competitions/')) {
        const urlMatch = rawRef.match(/\/competitions\/([^/?]+)/);
        ref = urlMatch ? urlMatch[1] : rawRef;
      }

      // Create a readable title from the competition slug
      const title =
        titleIdx >= 0 && cols[titleIdx]
          ? cols[titleIdx]
          : ref
              .split('-')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');

      const url = cols[urlIdx] || (ref ? `https://www.kaggle.com/competitions/${ref}` : rawRef);

      if (ref) {
        items.push({ ref, title, deadline, category, url });
      }
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
