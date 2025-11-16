import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {
  OUTPUT,
  getWorkspaceFolder,
  ensureFolder,
  writeFile,
  readJson,
  showError,
  showCompetitionError,
} from './utils';
import {
  runKaggleCLI,
  getKaggleCreds,
  clearStoredToken,
  storeApiTokenFromEnvOrPrompt,
  checkKaggleCLI,
} from './kaggleCli';
import { initProject } from './scaffold';
import { RunsProvider } from './tree/runsProvider';
import { MyNotebooksProvider } from './tree/myNotebooksProvider';
import { DatasetsProvider } from './tree/datasetsProvider';
import { CompetitionsProvider } from './tree/competitionsProvider';

interface KaggleYml {
  project: string;
  kernel_slug: string;
  code_file: string;
  accelerator?: 'none' | 'gpu' | 'tpu';
  internet?: boolean;
  privacy?: 'private' | 'public';
  datasets?: string[];
  competitions?: string[];
  outputs?: { download_to?: string };
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('Kaggle extension activated!');
  async function updateAuthContext() {
    try {
      await getKaggleCreds(context);
      await vscode.commands.executeCommand('setContext', 'kaggle.isSignedIn', true);
    } catch {
      await vscode.commands.executeCommand('setContext', 'kaggle.isSignedIn', false);
    }
  }
  await updateAuthContext();
  context.secrets.onDidChange(async e => {
    if (e.key === 'kaggle.api.token.json') await updateAuthContext();
  });

  // Check CLI availability on activation (non-blocking)
  setTimeout(async () => {
    try {
      const cliStatus = await checkKaggleCLI();
      if (!cliStatus.available) {
        // Don't show popup immediately, just log it
        console.log('Kaggle CLI not available:', cliStatus.error);
        // Only show warning if user tries to use CLI-dependent features
      }
    } catch (error) {
      console.log('Error checking CLI status:', error);
    }
  }, 2000); // Longer delay to ensure extension is fully activated first
  const runsProvider = new RunsProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kaggleRunsView', runsProvider)
  );
  const getUsername = async () => {
    try {
      const c = await getKaggleCreds(context);
      return c.username;
    } catch {
      return undefined;
    }
  };
  const myNotebooksProvider = new MyNotebooksProvider(context, getUsername);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kaggleMyNotebooksView', myNotebooksProvider)
  );
  const datasetsProvider = new DatasetsProvider(context, getUsername);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kaggleDatasetsView', datasetsProvider)
  );
  const competitionsProvider = new CompetitionsProvider(context, getUsername);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kaggleCompetitionsView', competitionsProvider)
  );

  // Create status bar item for CLI status
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  async function updateCliStatusBar() {
    const cliStatus = await checkKaggleCLI();
    if (cliStatus.available) {
      statusBarItem.text = `$(check) Kaggle CLI`;
      statusBarItem.tooltip = `Kaggle CLI is available (${cliStatus.version || 'Unknown version'})`;
      statusBarItem.backgroundColor = undefined;
      statusBarItem.command = 'kaggle.checkCliStatus';
    } else {
      statusBarItem.text = `$(warning) Kaggle CLI`;
      statusBarItem.tooltip = 'Kaggle CLI is not available. Click to check status.';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.command = 'kaggle.checkCliStatus';
    }
    statusBarItem.show();
  }

  // Update status bar on activation
  updateCliStatusBar();

  context.subscriptions.push(
    vscode.commands.registerCommand('kaggle.signIn', async () => {
      try {
        await storeApiTokenFromEnvOrPrompt(context);
        await updateAuthContext();
      } catch (e) {
        showError(e);
      }
    }),
    vscode.commands.registerCommand('kaggle.signOut', async () => {
      try {
        await clearStoredToken(context);
        await updateAuthContext();
        vscode.window.showInformationMessage('Signed out of Kaggle.');
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand('kaggle.refreshMyNotebooks', () =>
      myNotebooksProvider.refresh()
    ),
    vscode.commands.registerCommand('kaggle.refreshDatasets', () => datasetsProvider.refresh()),
    vscode.commands.registerCommand('kaggle.refreshCompetitions', () =>
      competitionsProvider.refresh()
    ),
    vscode.commands.registerCommand('kaggle.openOnKaggle', async (item: { url?: string }) => {
      if (item?.url) vscode.env.openExternal(vscode.Uri.parse(item.url));
    }),
    vscode.commands.registerCommand(
      'kaggle.openNotebookLocally',
      async (item: { ref?: string }) => {
        if (!item?.ref) return;
        const root = getWorkspaceFolder();
        if (!root) return vscode.window.showErrorMessage('Open a folder first.');
        try {
          // Pull into remote_notebooks/<user__slug>
          const destRoot = path.join(root, 'remote_notebooks');
          const safeRef = item.ref.replace(/[\\/]/g, '__');
          const destDir = path.join(destRoot, safeRef);
          await ensureFolder(destDir);
          await runKaggleCLI(context, ['kernels', 'pull', '-p', destDir, item.ref], root);

          // Open kernel-metadata.json -> code_file if present, otherwise first ipynb
          const metaPath = path.join(destDir, 'kernel-metadata.json');
          let openTarget: string | undefined;
          try {
            const meta = await readJson<{ code_file?: string }>(metaPath);
            if (meta?.code_file) openTarget = path.join(destDir, meta.code_file);
          } catch {
            /* ignore */
          }
          if (!openTarget) {
            const files = await fs.promises.readdir(destDir);
            const nb = files.find(f => f.toLowerCase().endsWith('.ipynb'));
            if (nb) openTarget = path.join(destDir, nb);
          }
          if (openTarget) {
            const doc = await vscode.workspace.openTextDocument(openTarget);
            await vscode.window.showTextDocument(doc, { preview: false });
          } else {
            vscode.window.showInformationMessage(
              'Downloaded notebook; open the code file from the explorer.'
            );
          }
        } catch (e) {
          showError(e);
        }
      }
    ),
    vscode.commands.registerCommand(
      'kaggle.linkNotebookFromTree',
      async (item: { ref?: string }) => {
        if (!item?.ref) return;
        const root = getWorkspaceFolder();
        if (!root) return vscode.window.showErrorMessage('Open a folder first.');
        try {
          await runKaggleCLI(context, ['kernels', 'pull', '-m', item.ref], root);
          vscode.window.showInformationMessage(`Linked ${item.ref}.`);
        } catch (e) {
          showError(e);
        }
      }
    ),
    vscode.commands.registerCommand(
      'kaggle.pullNotebookFromTree',
      async (item: { ref?: string }) => {
        if (!item?.ref) return;
        const root = getWorkspaceFolder();
        if (!root) return vscode.window.showErrorMessage('Open a folder first.');
        try {
          await runKaggleCLI(context, ['kernels', 'pull', item.ref], root);
          vscode.window.showInformationMessage(`Pulled ${item.ref}.`);
        } catch (e) {
          showError(e);
        }
      }
    ),
    vscode.commands.registerCommand(
      'kaggle.attachDatasetFromTree',
      async (item: { ref?: string }) => {
        if (!item?.ref) return;
        const root = getWorkspaceFolder();
        if (!root) return vscode.window.showErrorMessage('Open a folder first.');
        try {
          const ymlPath = path.join(root, 'kaggle.yml');
          let yml: Partial<KaggleYml> = {};
          if (
            !(await fs.promises
              .stat(ymlPath)
              .then(() => true)
              .catch(() => false))
          ) {
            const create = await vscode.window.showInformationMessage(
              'kaggle.yml not found. Initialize Kaggle project?',
              'Yes',
              'No'
            );
            if (create === 'Yes') {
              await initProject(root);
            } else {
              return;
            }
          }
          yml = (yaml.load(await fs.promises.readFile(ymlPath, 'utf8')) || {}) as KaggleYml;
          yml.datasets = Array.from(new Set([...(yml.datasets || []), item.ref]));
          await writeFile(ymlPath, yaml.dump(yml));
          vscode.window.showInformationMessage(`Attached dataset: ${item.ref}`);
        } catch (e) {
          showError(e);
        }
      }
    ),

    vscode.commands.registerCommand('kaggle.openOutputsFolder', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');
      try {
        const ymlRaw = await fs.promises
          .readFile(path.join(root, 'kaggle.yml'), 'utf8')
          .catch(() => '');
        const yml = (ymlRaw ? (yaml.load(ymlRaw) as Record<string, unknown>) : {}) || {};
        const outDir = path.join(
          root,
          ((yml.outputs as Record<string, unknown>)?.download_to as string) || '.kaggle-outputs'
        );
        await ensureFolder(outDir);
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outDir));
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand(
      'kaggle.datasetBrowseFiles',
      async (item?: { ref?: string }) => {
        const root = getWorkspaceFolder();
        if (!root) return vscode.window.showErrorMessage('Open a folder first.');
        const ymlPath = path.join(root, 'kaggle.yml');
        if (
          !(await fs.promises
            .stat(ymlPath)
            .then(() => true)
            .catch(() => false))
        ) {
          const create = await vscode.window.showInformationMessage(
            'kaggle.yml not found. Initialize Kaggle project?',
            'Yes',
            'No'
          );
          if (create === 'Yes') {
            await initProject(root);
          } else {
            return;
          }
        }
        const ref =
          item?.ref ||
          (await vscode.window.showInputBox({ prompt: 'Dataset ref (username/dataset)' })) ||
          '';
        if (!ref) return;
        try {
          const res = await runKaggleCLI(context, ['datasets', 'files', ref, '--csv'], root);
          const lines = res.stdout.trim().split(/\r?\n/);
          const header = lines.shift() || '';
          const headers = header.split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
          const nameIdx = headers.indexOf('name');
          const sizeIdx = headers.findIndex(h => /size|bytes/i.test(h));
          const entries = lines.filter(Boolean).map(line => {
            const cols = line.split(',');
            const name = cols[nameIdx] || '';
            const size = sizeIdx >= 0 ? cols[sizeIdx] : '';
            return { label: name, description: size, name } as vscode.QuickPickItem & {
              name: string;
            };
          });
          const pick = await vscode.window.showQuickPick(entries, {
            placeHolder: `Files in ${ref}`,
          });
          if (!pick) return;
          const action = await vscode.window.showQuickPick(['Preview', 'Download'], {
            placeHolder: `What do you want to do with ${pick.label}?`,
          });
          if (!action) return;
          const safeRef = ref.replace(/[\\/]/g, '__');
          const dest = path.join(root, '.kaggle-datasets', safeRef);
          await ensureFolder(dest);
          await runKaggleCLI(
            context,
            ['datasets', 'download', ref, '-f', pick.name, '-p', dest, '--unzip'],
            root
          );
          const filePath = path.join(dest, pick.name);
          if (action === 'Preview') {
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc, { preview: false });
          } else {
            vscode.window.showInformationMessage(`Downloaded to ${filePath}`);
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
          }
        } catch (e) {
          showError(e);
        }
      }
    ),
    // New command: Search datasets by competition name and download
    vscode.commands.registerCommand('kaggle.searchDatasetsByCompetition', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');
      const ymlPath = path.join(root, 'kaggle.yml');
      if (
        !(await fs.promises
          .stat(ymlPath)
          .then(() => true)
          .catch(() => false))
      ) {
        const create = await vscode.window.showInformationMessage(
          'kaggle.yml not found. Initialize Kaggle project?',
          'Yes',
          'No'
        );
        if (create === 'Yes') {
          await initProject(root);
        } else {
          return;
        }
      }
      const compName = await vscode.window.showInputBox({
        prompt: 'Competition name (e.g., titanic)',
      });
      if (!compName) return;
      try {
        // List datasets for the competition
        const res = await runKaggleCLI(
          context,
          ['competitions', 'list', '--search', compName, '--csv'],
          root
        );
        const lines = res.stdout.trim().split(/\r?\n/);
        const header = lines.shift() || '';
        const headers = header.split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
        const refIdx = headers.indexOf('ref');
        const nameIdx = headers.indexOf('title');
        const entries = lines.filter(Boolean).map(line => {
          const cols = line.split(',');
          const ref = cols[refIdx] || '';
          const name = cols[nameIdx] || ref;
          return { label: name, description: ref, ref } as vscode.QuickPickItem & { ref: string };
        });
        const pick = await vscode.window.showQuickPick(entries, {
          placeHolder: `Competitions matching "${compName}"`,
        });
        if (!pick) return;
        // Download competition data
        const dest = path.join(root, 'competitions', pick.ref.replace(/[\\/]/g, '__'));
        await ensureFolder(dest);
        await runKaggleCLI(
          context,
          ['competitions', 'download', '-c', pick.ref, '-p', dest, '--unzip'],
          root
        );
        vscode.window.showInformationMessage(`Competition data downloaded to ${dest}`);
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dest));
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand(
      'kaggle.datasetDownloadAll',
      async (item?: { ref?: string }) => {
        const root = getWorkspaceFolder();
        if (!root) return vscode.window.showErrorMessage('Open a folder first.');
        const ref =
          item?.ref ||
          (await vscode.window.showInputBox({ prompt: 'Dataset ref (username/dataset)' })) ||
          '';
        if (!ref) return;
        try {
          const dest = path.join(root, '.kaggle-datasets', ref.replace(/[\\/]/g, '__'));
          await ensureFolder(dest);
          await runKaggleCLI(context, ['datasets', 'download', ref, '-p', dest, '--unzip'], root);
          vscode.window.showInformationMessage(`Dataset downloaded to ${dest}`);
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dest));
        } catch (e) {
          showError(e);
        }
      }
    ),

    vscode.commands.registerCommand('kaggle.initProject', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');
      try {
        await initProject(root);
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand('kaggle.linkNotebook', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');
      const slug = await vscode.window.showInputBox({
        prompt: 'Kernel slug (e.g., username/notebook-name)',
      });
      if (!slug) return;
      try {
        await runKaggleCLI(context, ['kernels', 'pull', '-m', slug], root);
        vscode.window.showInformationMessage('Linked. kernel-metadata.json downloaded.');
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand('kaggle.runCurrentNotebook', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');

      // Determine the active notebook file
      const nbEditor = vscode.window.activeNotebookEditor;
      const activePath =
        nbEditor?.notebook?.uri.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
      if (!activePath || !activePath.endsWith('.ipynb')) {
        return vscode.window.showErrorMessage('Open a .ipynb notebook to run on Kaggle.');
      }

      // Read current yml and prefer its settings; only prompt if missing
      const ymlPath = path.join(root, 'kaggle.yml');
      const metaPath = path.join(root, 'kernel-metadata.json');
      if (
        !(await fs.promises
          .stat(ymlPath)
          .then(() => true)
          .catch(() => false)) ||
        !(await fs.promises
          .stat(metaPath)
          .then(() => true)
          .catch(() => false))
      ) {
        await initProject(root);
      }

      const yml = (yaml.load(await fs.promises.readFile(ymlPath, 'utf8')) || {}) as KaggleYml;
      const accelCfg =
        yml.accelerator ||
        vscode.workspace.getConfiguration('kaggle').get<string>('defaultAccelerator', 'none');
      const internetCfg =
        typeof yml.internet === 'boolean'
          ? yml.internet
          : vscode.workspace.getConfiguration('kaggle').get<boolean>('defaultInternet', false);

      let accel = accelCfg as KaggleYml['accelerator'];
      let internet = internetCfg as boolean;
      if (!accel) {
        const pick = await vscode.window.showQuickPick(
          [
            { label: 'CPU', value: 'none' },
            { label: 'GPU', value: 'gpu' },
            { label: 'TPU', value: 'tpu' },
          ],
          { placeHolder: 'Select accelerator' }
        );
        if (!pick) return;
        accel = pick.value as 'none' | 'gpu' | 'tpu';
      }
      if (internet === undefined) {
        const pickNet = await vscode.window.showQuickPick(
          [
            { label: 'Internet: Off', value: false },
            { label: 'Internet: On', value: true },
          ],
          { placeHolder: 'Internet access?' }
        );
        internet = pickNet?.value ?? false;
      }

      try {
        const relCodePath = path.relative(root, activePath);
        const meta = (await readJson<Record<string, unknown>>(metaPath)) || {};

        // Sync settings to metadata
        yml.code_file = relCodePath;
        yml.accelerator = accel;
        yml.internet = !!internet;
        await writeFile(ymlPath, yaml.dump(yml));

        meta.id = yml.kernel_slug || meta.id;
        meta.code_file = yml.code_file || meta.code_file;
        meta.is_private = (yml.privacy || 'private') === 'private';
        meta.enable_gpu = yml.accelerator === 'gpu';
        (meta as Record<string, unknown>).enable_tpu = yml.accelerator === 'tpu';
        meta.enable_internet = !!yml.internet;
        meta.dataset_sources = yml.datasets || meta.dataset_sources || [];
        meta.competition_sources = yml.competitions || meta.competition_sources || [];
        await writeFile(metaPath, JSON.stringify(meta, null, 2));
        await writeFile(metaPath, JSON.stringify(meta, null, 2));

        OUTPUT.show(true);
        OUTPUT.appendLine(`Pushing ${relCodePath} to Kaggle...`);
        const res = await runKaggleCLI(context, ['kernels', 'push', '-p', '.'], root);

        const urlMatch = res.stdout.match(/https?:\/\/www\.kaggle\.com\/[\w\-\/]+/);
        const url = urlMatch ? urlMatch[0] : undefined;
        if (url) await logRun(root, url);
        runsProvider.refresh();

        // Optional auto-poll and download
        const cfg = vscode.workspace.getConfiguration('kaggle');
        if (cfg.get<boolean>('autoDownloadOnComplete', true)) {
          const kernelId = (meta.id as string) || yml.kernel_slug;
          if (kernelId) {
            await pollAndDownload(
              context,
              kernelId,
              root,
              cfg.get<number>('pollIntervalSeconds', 10),
              cfg.get<number>('pollTimeoutSeconds', 600)
            );
          }
        } else {
          const open = url ? 'Open Run' : undefined;
          const dl = 'Download Outputs';
          const choice = await vscode.window.showInformationMessage(
            'Kaggle run triggered.',
            ...(open ? [open] : []),
            dl
          );
          if (choice === open && url) vscode.env.openExternal(vscode.Uri.parse(url));
          if (choice === dl) vscode.commands.executeCommand('kaggle.downloadOutputs');
        }
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand('kaggle.pushRun', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');
      try {
        // Sync metadata toggles from kaggle.yml → kernel-metadata.json
        const ymlPath = path.join(root, 'kaggle.yml');
        const metaPath = path.join(root, 'kernel-metadata.json');

        const yml = (yaml.load(await fs.promises.readFile(ymlPath, 'utf8')) || {}) as KaggleYml;
        const meta = (await readJson<Record<string, unknown>>(metaPath)) || {};

        meta.id = yml.kernel_slug || meta.id;
        meta.code_file = yml.code_file || meta.code_file;
        meta.is_private = (yml.privacy || 'private') === 'private';
        meta.enable_gpu = yml.accelerator === 'gpu';
        meta.enable_internet = !!yml.internet;
        meta.dataset_sources = yml.datasets || meta.dataset_sources || [];
        meta.competition_sources = yml.competitions || meta.competition_sources || [];

        await writeFile(metaPath, JSON.stringify(meta, null, 2));

        OUTPUT.show(true);
        OUTPUT.appendLine('Pushing & running on Kaggle...');
        const res = await runKaggleCLI(context, ['kernels', 'push', '-p', '.'], root);

        // Try to extract a URL from stdout
        const urlMatch = res.stdout.match(/https?:\/\/www\.kaggle\.com\/[\w\-\/]+/);
        const url = urlMatch ? urlMatch[0] : undefined;
        if (url) {
          await logRun(root, url);
          runsProvider.refresh();
          const open = 'Open Run';
          const dl = 'Download Outputs';
          const choice = await vscode.window.showInformationMessage(
            'Kaggle run triggered.',
            open,
            dl
          );
          if (choice === open) vscode.env.openExternal(vscode.Uri.parse(url));
          if (choice === dl) vscode.commands.executeCommand('kaggle.downloadOutputs');
        } else {
          vscode.window.showInformationMessage('Kaggle push finished.');
        }
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand('kaggle.downloadOutputs', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');
      try {
        const yml = (yaml.load(await fs.promises.readFile(path.join(root, 'kaggle.yml'), 'utf8')) ||
          {}) as KaggleYml;
        const meta = await readJson<{ id?: string }>(path.join(root, 'kernel-metadata.json'));
        const dest = path.join(root, yml.outputs?.download_to || '.kaggle-outputs');
        await ensureFolder(dest);
        await runKaggleCLI(context, ['kernels', 'output', meta?.id || '', '-p', dest], root);

        vscode.window.showInformationMessage(`Outputs downloaded to ${dest}`);
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand('kaggle.attachDataset', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');
      try {
        const ds = await vscode.window.showInputBox({
          prompt: 'Dataset slug to attach (username/dataset-slug)',
        });
        if (!ds) return;
        const ymlPath = path.join(root, 'kaggle.yml');
        const yml = (yaml.load(await fs.promises.readFile(ymlPath, 'utf8')) || {}) as KaggleYml;
        yml.datasets = Array.from(new Set([...(yml.datasets || []), ds]));
        await writeFile(ymlPath, yaml.dump(yml));
        vscode.window.showInformationMessage(`Attached dataset: ${ds}`);
      } catch (e) {
        showError(e);
      }
    }),

    vscode.commands.registerCommand('kaggle.submitCompetition', async () => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');
      try {
        const cid = await vscode.window.showInputBox({ prompt: 'Competition id (e.g., titanic)' });
        if (!cid) return;
        const fileUri = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Select submission file',
        });
        if (!fileUri || !fileUri[0]) return;
        const message =
          (await vscode.window.showInputBox({
            prompt: 'Submission message',
            value: 'Submission from VS Code',
          })) || 'Submission from VS Code';
        await runKaggleCLI(
          context,
          ['competitions', 'submit', '-c', cid, '-f', fileUri[0].fsPath, '-m', message],
          root
        );
        vscode.window.showInformationMessage('Submission uploaded.');
      } catch (e) {
        showError(e);
      }
    }),

    // Competition-specific commands
    vscode.commands.registerCommand('kaggle.competitionDownloadData', async (item?: any) => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');

      // Extract ref from various possible sources
      let ref = '';
      if (item?.ref) {
        ref = item.ref;
      } else if (item?.url && typeof item.url === 'string') {
        // Extract competition name from URL like https://www.kaggle.com/competitions/arc-prize-2025
        const urlMatch = item.url.match(/\/competitions\/([^/?]+)/);
        ref = urlMatch ? urlMatch[1] : '';
      } else if (typeof item === 'string') {
        // Handle case where item itself is the ref
        ref = item;
      }

      if (!ref) {
        ref =
          (await vscode.window.showInputBox({ prompt: 'Competition name (e.g., titanic)' })) || '';
      }
      if (!ref) return;
      try {
        const dest = path.join(root, 'competitions', ref.replace(/[\\/]/g, '__'));
        await ensureFolder(dest);
        await runKaggleCLI(context, ['competitions', 'download', ref, '-p', dest], root);
        vscode.window.showInformationMessage(`Competition data downloaded to ${dest}`);
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dest));
      } catch (e) {
        showCompetitionError(e, ref, 'download data');
      }
    }),

    vscode.commands.registerCommand('kaggle.competitionSubmitFromTree', async (item?: any) => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');

      // Extract ref from various possible sources
      let ref = '';
      if (item?.ref) {
        ref = item.ref;
      } else if (item?.url && typeof item.url === 'string') {
        // Extract competition name from URL like https://www.kaggle.com/competitions/arc-prize-2025
        const urlMatch = item.url.match(/\/competitions\/([^/?]+)/);
        ref = urlMatch ? urlMatch[1] : '';
      } else if (typeof item === 'string') {
        // Handle case where item itself is the ref
        ref = item;
      }
      if (!ref) return;
      try {
        const fileUri = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Select submission file',
        });
        if (!fileUri || !fileUri[0]) return;
        const message =
          (await vscode.window.showInputBox({
            prompt: 'Submission message',
            value: 'Submission from VS Code',
          })) || 'Submission from VS Code';
        await runKaggleCLI(
          context,
          ['competitions', 'submit', ref, '-f', fileUri[0].fsPath, '-m', message],
          root
        );
        vscode.window.showInformationMessage(`Submission uploaded to ${ref}`);
      } catch (e) {
        showCompetitionError(e, ref, 'submit to');
      }
    }),

    vscode.commands.registerCommand('kaggle.competitionViewSubmissions', async (item?: any) => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');

      // Extract ref from various possible sources
      let ref = '';
      if (item?.ref) {
        ref = item.ref;
      } else if (item?.url && typeof item.url === 'string') {
        // Extract competition name from URL like https://www.kaggle.com/competitions/arc-prize-2025
        const urlMatch = item.url.match(/\/competitions\/([^/?]+)/);
        ref = urlMatch ? urlMatch[1] : '';
      } else if (typeof item === 'string') {
        // Handle case where item itself is the ref
        ref = item;
      }

      if (!ref) {
        ref =
          (await vscode.window.showInputBox({ prompt: 'Competition name (e.g., titanic)' })) || '';
      }
      if (!ref) return;
      try {
        const res = await runKaggleCLI(
          context,
          ['competitions', 'submissions', ref, '--csv'],
          root
        );
        OUTPUT.show(true);
        OUTPUT.appendLine(`=== Submissions for ${ref} ===`);
        OUTPUT.appendLine(res.stdout);
      } catch (e) {
        showCompetitionError(e, ref, 'view submissions');
      }
    }),

    vscode.commands.registerCommand(
      'kaggle.competitionViewLeaderboard',
      async (item?: { ref?: string }) => {
        const root = getWorkspaceFolder();
        if (!root) return vscode.window.showErrorMessage('Open a folder first.');
        const ref =
          item?.ref ||
          (await vscode.window.showInputBox({ prompt: 'Competition name (e.g., titanic)' })) ||
          '';
        if (!ref) return;
        try {
          const res = await runKaggleCLI(
            context,
            ['competitions', 'leaderboard', ref, '-s', '--csv'],
            root
          );
          OUTPUT.show(true);
          OUTPUT.appendLine(`=== Leaderboard for ${ref} ===`);
          OUTPUT.appendLine(res.stdout);
        } catch (e) {
          showCompetitionError(e, ref, 'view leaderboard');
        }
      }
    ),

    vscode.commands.registerCommand('kaggle.competitionBrowseFiles', async (item?: any) => {
      const root = getWorkspaceFolder();
      if (!root) return vscode.window.showErrorMessage('Open a folder first.');

      // Extract ref from various possible sources
      let ref = '';
      if (item?.ref) {
        ref = item.ref;
      } else if (item?.url && typeof item.url === 'string') {
        // Extract competition name from URL like https://www.kaggle.com/competitions/arc-prize-2025
        const urlMatch = item.url.match(/\/competitions\/([^/?]+)/);
        ref = urlMatch ? urlMatch[1] : '';
      } else if (typeof item === 'string') {
        // Handle case where item itself is the ref
        ref = item;
      }

      if (!ref) {
        ref =
          (await vscode.window.showInputBox({ prompt: 'Competition name (e.g., titanic)' })) || '';
      }
      if (!ref) return;
      try {
        const res = await runKaggleCLI(context, ['competitions', 'files', ref, '--csv'], root);
        const lines = res.stdout.trim().split(/\r?\n/);
        const header = lines.shift() || '';
        const headers = header.split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
        const nameIdx = headers.indexOf('name');
        const sizeIdx = headers.findIndex(h => /size|bytes/i.test(h));
        const entries = lines.filter(Boolean).map(line => {
          const cols = line.split(',');
          const name = cols[nameIdx] || '';
          const size = sizeIdx >= 0 ? cols[sizeIdx] : '';
          return { label: name, description: size, name } as vscode.QuickPickItem & {
            name: string;
          };
        });
        const pick = await vscode.window.showQuickPick(entries, {
          placeHolder: `Files in ${ref}`,
        });
        if (!pick) return;
        const action = await vscode.window.showQuickPick(['Preview', 'Download'], {
          placeHolder: `What do you want to do with ${pick.label}?`,
        });
        if (!action) return;
        const dest = path.join(root, 'competitions', ref.replace(/[\\/]/g, '__'));
        await ensureFolder(dest);
        await runKaggleCLI(
          context,
          ['competitions', 'download', ref, '-f', pick.name, '-p', dest],
          root
        );
        const filePath = path.join(dest, pick.name);
        if (action === 'Preview') {
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc, { preview: false });
        } else {
          vscode.window.showInformationMessage(`Downloaded to ${filePath}`);
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
        }
      } catch (e) {
        showCompetitionError(e, ref, 'browse files');
      }
    }),

    vscode.commands.registerCommand('kaggle.checkCliStatus', async () => {
      try {
        const status = await checkKaggleCLI();
        if (status.available) {
          vscode.window.showInformationMessage(
            `Kaggle CLI is available. Version: ${status.version || 'Unknown'}`
          );
        } else {
          const installAction = 'Install Instructions';
          const configAction = 'Configure Path';
          const action = await vscode.window.showErrorMessage(
            status.error || 'Kaggle CLI is not available',
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
        }
      } catch (e) {
        showError(e);
      }
    })
  );
}

async function logRun(root: string, url: string) {
  const file = path.join(root, '.kaggle-run.log');
  const ts = new Date().toISOString();
  await fs.promises.appendFile(file, `${ts} | ${url}\n`, 'utf8');
}

export function deactivate() {}

async function pollAndDownload(
  context: vscode.ExtensionContext,
  kernelId: string,
  root: string,
  intervalSeconds: number,
  timeoutSeconds: number
) {
  const yml = (yaml.load(await fs.promises.readFile(path.join(root, 'kaggle.yml'), 'utf8')) ||
    {}) as KaggleYml;
  const dest = path.join(root, yml.outputs?.download_to || '.kaggle-outputs');
  await ensureFolder(dest);
  const start = Date.now();

  while (Date.now() - start < timeoutSeconds * 1000) {
    try {
      await runKaggleCLI(context, ['kernels', 'output', kernelId, '-p', dest], root);
      // Check if files exist
      const items = await fs.promises.readdir(dest);
      if (items.length > 0) {
        vscode.window.showInformationMessage(`Kaggle run completed. Outputs downloaded to ${dest}`);
        return;
      }
    } catch {
      // Not ready yet; ignore
    }
    await new Promise(r => setTimeout(r, Math.max(1000, intervalSeconds * 1000)));
  }
  vscode.window.showWarningMessage(
    'Timed out waiting for Kaggle run to complete. You can download outputs later via Kaggle: Download Outputs.'
  );
}
