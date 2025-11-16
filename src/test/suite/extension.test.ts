import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  // Wait for the extension to activate
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('DataQuanta.vscode-kaggle-run');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
    // Give the extension time to register commands
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  test('Extension should be present', () => {
    const extension = vscode.extensions.getExtension('DataQuanta.vscode-kaggle-run');
    assert.ok(extension, 'Extension should be found');
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('kaggle.signIn'));
    assert.ok(commands.includes('kaggle.signOut'));
    assert.ok(commands.includes('kaggle.initProject'));
    assert.ok(commands.includes('kaggle.runCurrentNotebook'));
    assert.ok(commands.includes('kaggle.downloadOutputs'));
    assert.ok(commands.includes('kaggle.refreshMyNotebooks'));
    assert.ok(commands.includes('kaggle.refreshDatasets'));
    assert.ok(commands.includes('kaggle.openNotebookLocally'));
    assert.ok(commands.includes('kaggle.datasetBrowseFiles'));
    assert.ok(commands.includes('kaggle.openOutputsFolder'));
  });
});
