import * as assert from 'assert';
import * as vscode from 'vscode';
import { getKaggleCreds } from '../../kaggleCli';

suite('Kaggle CLI Test Suite', () => {
  test('Should throw error when no token stored', async () => {
    const prevEnv = process.env.KAGGLE_TOKEN_JSON;
    delete process.env.KAGGLE_TOKEN_JSON;
    const mockContext = {
      secrets: {
        get: () => Promise.resolve(undefined),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    } as unknown as vscode.ExtensionContext;

    try {
      await getKaggleCreds(mockContext);
      assert.fail('Should have thrown error');
    } catch (error: unknown) {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('No Kaggle token'));
    }
    if (prevEnv) process.env.KAGGLE_TOKEN_JSON = prevEnv;
    else delete process.env.KAGGLE_TOKEN_JSON;
  });

  test('Should handle valid token format', async () => {
    const validToken = JSON.stringify({
      username: 'testuser',
      key: 'testkey123',
    });

    const mockContext = {
      secrets: {
        get: () => Promise.resolve(validToken),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    } as unknown as vscode.ExtensionContext;

    // Test that we can extract valid credentials
    const creds = await getKaggleCreds(mockContext);
    assert.strictEqual(creds.username, 'testuser');
    assert.strictEqual(creds.key, 'testkey123');
  });
});
