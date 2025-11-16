import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import { OUTPUT } from './utils';

const SECRET_KEY = 'kaggle.api.token.json';

export async function storeApiTokenFromFile(context: vscode.ExtensionContext) {
  const uri = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { JSON: ['json'] },
  });
  if (!uri || !uri[0]) return;
  const raw = await fs.promises.readFile(uri[0].fsPath, 'utf8');
  const obj = JSON.parse(raw);
  if (!obj.username || !obj.key) {
    throw new Error('Invalid kaggle.json (missing username/key).');
  }
  await context.secrets.store(SECRET_KEY, raw);
  vscode.window.showInformationMessage('Kaggle token stored securely.');
}

export async function getKaggleCreds(
  context: vscode.ExtensionContext
): Promise<{ username: string; key: string }> {
  // 1) Secrets store (via Kaggle: Sign In)
  const raw = await context.secrets.get(SECRET_KEY);
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj?.username && obj?.key) return { username: obj.username, key: obj.key };
    } catch {
      /* fallthrough */
    }
  }

  // 2) Env: KAGGLE_TOKEN_JSON
  const envRaw = process.env.KAGGLE_TOKEN_JSON;
  if (envRaw) {
    try {
      const obj = JSON.parse(envRaw);
      if (obj?.username && obj?.key) return { username: obj.username, key: obj.key };
    } catch {
      /* fallthrough */
    }
  }

  // 3) Env: KAGGLE_USERNAME / KAGGLE_KEY
  if (process.env.KAGGLE_USERNAME && process.env.KAGGLE_KEY) {
    return { username: process.env.KAGGLE_USERNAME, key: process.env.KAGGLE_KEY } as {
      username: string;
      key: string;
    };
  }

  throw new Error(
    'No Kaggle token found. Run "Kaggle: Sign In" or set KAGGLE_TOKEN_JSON / KAGGLE_USERNAME & KAGGLE_KEY.'
  );
}

export async function clearStoredToken(context: vscode.ExtensionContext) {
  await context.secrets.delete(SECRET_KEY);
}

export async function storeApiTokenFromEnvOrPrompt(context: vscode.ExtensionContext) {
  // Prefer env var if present
  const envRaw = process.env.KAGGLE_TOKEN_JSON;
  if (envRaw) {
    try {
      const obj = JSON.parse(envRaw);
      if (obj?.username && obj?.key) {
        await context.secrets.store(SECRET_KEY, envRaw);
        vscode.window.showInformationMessage('Kaggle token loaded from environment.');
        return;
      }
    } catch {
      /* fallthrough to prompt */
    }
  }

  // Prompt user for username & key
  const username = await vscode.window.showInputBox({
    prompt: 'Kaggle Username',
    ignoreFocusOut: true,
  });
  if (!username) throw new Error('Sign in canceled.');
  const key = await vscode.window.showInputBox({
    prompt: 'Kaggle API Key',
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) throw new Error('Sign in canceled.');
  const json = JSON.stringify({ username, key });
  await context.secrets.store(SECRET_KEY, json);
  vscode.window.showInformationMessage('Kaggle token saved securely.');
}

export type ExecResult = { code: number; stdout: string; stderr: string };

function escapeShellArg(arg: string): string {
  if (process.platform === 'win32') {
    // Windows cmd.exe/PowerShell: use double quotes and escape internal double quotes
    // Double quotes are escaped by doubling them
    return `"${arg.replace(/"/g, '""')}"`;
  } else {
    // Unix/Mac: use single quotes and escape single quotes with '\''
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}

function getInstallInstructions(): string {
  const platform = process.platform;
  switch (platform) {
    case 'win32':
      return `Install Kaggle CLI:
• Using pip: pip install kaggle
• Using conda: conda install -c conda-forge kaggle
• Make sure Python and pip are installed first`;
    case 'darwin':
      return `Install Kaggle CLI:
• Using pip: pip install kaggle
• Using conda: conda install -c conda-forge kaggle
• Using Homebrew: brew install kaggle`;
    default:
      return `Install Kaggle CLI:
• Using pip: pip install kaggle
• Using conda: conda install -c conda-forge kaggle
• Make sure Python and pip are installed first`;
  }
}

export async function checkKaggleCLI(): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  const config = vscode.workspace.getConfiguration('kaggle');
  const cliPath = config.get<string>('cliPath', 'kaggle');

  return new Promise(resolve => {
    exec(`${cliPath} --version`, (error, stdout, stderr) => {
      if (error) {
        const errorMsg = error.message.toLowerCase();
        if (
          errorMsg.includes('command not found') ||
          errorMsg.includes('not recognized') ||
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          resolve({
            available: false,
            error: `Kaggle CLI not found at '${cliPath}'.\n\n${getInstallInstructions()}`,
          });
        } else {
          resolve({
            available: false,
            error: `Error checking Kaggle CLI: ${error.message}`,
          });
        }
        return;
      }

      const version = stdout.trim() || stderr.trim();
      resolve({ available: true, version });
    });
  });
}

export async function runKaggleCLI(
  context: vscode.ExtensionContext,
  args: string[],
  cwd?: string
): Promise<ExecResult> {
  const config = vscode.workspace.getConfiguration('kaggle');
  const cliPath = config.get<string>('cliPath', 'kaggle');

  // Check if CLI is available before running
  const cliCheck = await checkKaggleCLI();
  if (!cliCheck.available) {
    const installAction = 'Install Instructions';
    const configAction = 'Configure Path';
    const action = await vscode.window.showErrorMessage(
      cliCheck.error || 'Kaggle CLI is not available',
      installAction,
      configAction
    );

    if (action === installAction) {
      vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/Kaggle/kaggle-api#installation')
      );
    } else if (action === configAction) {
      vscode.commands.executeCommand('workbench.action.openSettings', 'kaggle.cliPath');
    }

    throw new Error(cliCheck.error || 'Kaggle CLI is not available');
  }

  const creds = await getKaggleCreds(context);

  return new Promise((resolve, reject) => {
    OUTPUT.show(true);
    OUTPUT.appendLine(`$ ${cliPath} ${args.join(' ')}`);
    exec(
      `${cliPath} ${args.map(escapeShellArg).join(' ')}`,
      { cwd, env: { ...process.env, KAGGLE_USERNAME: creds.username, KAGGLE_KEY: creds.key } },
      (error, stdout, stderr) => {
        if (stdout) OUTPUT.append(stdout);
        if (stderr) OUTPUT.append(stderr);
        if (error) return reject(error);
        resolve({ code: 0, stdout, stderr });
      }
    );
  });
}
