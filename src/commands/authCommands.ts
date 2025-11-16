import * as vscode from 'vscode';
import {
  getKaggleCreds,
  clearStoredToken,
  storeApiTokenFromEnvOrPrompt,
  checkKaggleCLI,
} from '../kaggleCli';
import { showError } from '../utils';

export function registerAuthCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  async function updateAuthContext() {
    try {
      const creds = await getKaggleCreds(context);
      console.log('Auth context: Signed in as', creds.username);
      await vscode.commands.executeCommand('setContext', 'kaggle.isSignedIn', true);
    } catch (error) {
      console.log(
        'Auth context: Not signed in -',
        error instanceof Error ? error.message : String(error)
      );
      await vscode.commands.executeCommand('setContext', 'kaggle.isSignedIn', false);
    }
  }

  return [
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
        console.log('Sign out: Clearing stored token...');
        await clearStoredToken(context);
        console.log('Sign out: Updating auth context...');
        await updateAuthContext();
        console.log('Sign out: Complete');
        vscode.window.showInformationMessage('Signed out of Kaggle.');
      } catch (e) {
        console.error('Sign out error:', e);
        showError(e);
      }
    }),

    vscode.commands.registerCommand('kaggle.checkApiStatus', async () => {
      try {
        const status = await checkKaggleCLI();
        if (status.available) {
          vscode.window.showInformationMessage(
            `Kaggle API is available. Version: ${status.version || 'Unknown'}`
          );
        } else {
          const signInAction = 'Sign In';
          const action = await vscode.window.showErrorMessage(
            status.error || 'Kaggle API is not available',
            signInAction
          );

          if (action === signInAction) {
            vscode.commands.executeCommand('kaggle.signIn');
          }
        }
      } catch (e) {
        showError(e);
      }
    }),
  ];
}
