import * as assert from 'assert';
import * as vscode from 'vscode';
import { runKaggleCLI } from '../../kaggleCli';

suite('Kaggle E2E (optional)', () => {
  test('kaggle --version runs when token provided via env', async function () {
    if (!process.env.KAGGLE_TOKEN_JSON) {
      this.skip();
      return;
    }
    const mockContext = {
      secrets: {
        get: () => Promise.resolve(undefined),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    } as unknown as vscode.ExtensionContext;

    // Should resolve or at least attempt to exec; if kaggle is missing, error will mention not found
    try {
      const res = await runKaggleCLI(mockContext, ['--version']);
      assert.match(res.stdout + res.stderr, /kaggle/i);
    } catch (err: unknown) {
      // Allow missing CLI case, but ensure token path was attempted (i.e., not token error)
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(!message.includes('No Kaggle token'));
    }
  });
});
