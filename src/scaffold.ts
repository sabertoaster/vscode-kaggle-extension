import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ensureFolder, writeFile } from './utils';

export async function initProject(root: string) {
    const title = await vscode.window.showInputBox({ prompt: 'Notebook title', value: 'My Awesome Kernel' });
    if (!title) return;
    const username = await vscode.window.showInputBox({ prompt: 'Your Kaggle username (for kernel slug)' });
    if (!username) return;

    const accel = vscode.workspace.getConfiguration('kaggle').get<string>('defaultAccelerator', 'none');
    const internet = vscode.workspace.getConfiguration('kaggle').get<boolean>('defaultInternet', false);

    const codeFile = await vscode.window.showQuickPick(['notebook.ipynb', 'main.py'], { placeHolder: 'Primary code file' }) || 'notebook.ipynb';

    const kernelId = `${username}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;

    const kmeta = {
        id: kernelId,
        title,
        code_file: codeFile,
        language: 'python',
        kernel_type: codeFile.endsWith('.ipynb') ? 'notebook' : 'script',
        is_private: true,
        enable_gpu: accel === 'gpu',
        enable_internet: internet,
        dataset_sources: [] as string[],
        competition_sources: [] as string[]
    };

    const yml = `project: ${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
kernel_slug: ${kernelId}
code_file: ${codeFile}
accelerator: ${accel}
internet: ${internet}
privacy: private
datasets: []
competitions: []
outputs:\n  download_to: .kaggle-outputs\n`;

    await ensureFolder(root);
    await writeFile(path.join(root, 'kernel-metadata.json'), JSON.stringify(kmeta, null, 2));
    await writeFile(path.join(root, 'kaggle.yml'), yml);

    // create placeholders
    if (!(await exists(path.join(root, codeFile)))) {
        if (codeFile.endsWith('.py')) {
            await writeFile(path.join(root, codeFile), 'print("Hello from Kaggle!")\n');
        } else {
            await writeFile(path.join(root, codeFile), JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 2));
        }
    }

    vscode.window.showInformationMessage('Kaggle project initialized.');
}

async function exists(p: string) { try { await fs.promises.access(p); return true; } catch { return false; } }