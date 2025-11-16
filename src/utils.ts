import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export const OUTPUT = vscode.window.createOutputChannel('Kaggle');

export function getWorkspaceFolder(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : undefined;
}

export async function ensureFolder(folder: string) {
  await fs.promises.mkdir(folder, { recursive: true });
}

export async function writeFile(filePath: string, contents: string) {
  await ensureFolder(path.dirname(filePath));
  await fs.promises.writeFile(filePath, contents, 'utf8');
}

export async function readJson<T = Record<string, unknown>>(
  filePath: string
): Promise<T | undefined> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function fileExists(p: string) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

export function showError(e: Error | unknown, msg?: string) {
  const message = e instanceof Error ? e.message : String(e);
  OUTPUT.appendLine(`Error: ${message}`);
  vscode.window.showErrorMessage(msg || message);
}

export function showCompetitionError(e: Error | unknown, competitionRef: string, action: string) {
  const message = e instanceof Error ? e.message : String(e);
  OUTPUT.appendLine(`Competition ${action} error: ${message}`);

  if (message.includes('403') || message.includes('Forbidden')) {
    const joinAction = 'Join Competition';
    const learnAction = 'Learn More';
    vscode.window
      .showErrorMessage(
        `Access denied for competition "${competitionRef}". You may need to join the competition first.`,
        joinAction,
        learnAction
      )
      .then(selection => {
        if (selection === joinAction) {
          vscode.env.openExternal(
            vscode.Uri.parse(`https://www.kaggle.com/competitions/${competitionRef}`)
          );
        } else if (selection === learnAction) {
          vscode.env.openExternal(vscode.Uri.parse('https://www.kaggle.com/docs/competitions'));
        }
      });
  } else if (message.includes('401') || message.includes('Unauthorized')) {
    const refreshAction = 'Refresh API Token';
    vscode.window
      .showErrorMessage(
        `Authentication error for competition "${competitionRef}". Your API token may be invalid.`,
        refreshAction
      )
      .then(selection => {
        if (selection === refreshAction) {
          vscode.env.openExternal(vscode.Uri.parse('https://www.kaggle.com/settings/account'));
        }
      });
  } else {
    vscode.window.showErrorMessage(
      `Failed to ${action} for competition "${competitionRef}": ${message}`
    );
  }
}
