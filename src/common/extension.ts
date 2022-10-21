/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	commands, ExtensionContext, Uri, window} from 'vscode';

import PythonInstallation from './pythonInstallation';
import RAL from './ral';
import { Terminals } from './terminals';

function isCossOriginIsolated(): boolean {
	if (RAL().isCrossOriginIsolated) {
		return true;
	}
	void window.showWarningMessage(`Executing Python needs cross origin isolation. You need to \nadd ?vscode-coi= to your browser URL to enable it.`, { modal: true});
	return false;
}

export function activate(context: ExtensionContext) {
	const preloadPromise = PythonInstallation.preload();
	context.subscriptions.push(
		commands.registerCommand('vscode-python-web-wasm.debug.runEditorContents', async (resource: Uri) => {
			if (!isCossOriginIsolated()) {
				return false;
			}
			let targetResource = resource;
			if (!targetResource && window.activeTextEditor) {
				targetResource = window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				await preloadPromise;
				const pty = Terminals.getExecutionTerminal(targetResource, true);
				const launcher = RAL().launcher.create();
				const ctrlC = pty.onDidCtrlC(() => {
					ctrlC.dispose();
					launcher.terminate().catch(console.error);
					Terminals.releaseExecutionTerminal(pty, true);
				});
				await launcher.run(context, targetResource.toString(true), pty);
				launcher.onExit().catch(() => {
					// todo@dirkb need to think how to handle this.
				}).finally(() => {
					ctrlC.dispose();
					Terminals.releaseExecutionTerminal(pty);
				});
			}
			return false;
		}),
		commands.registerCommand('vscode-python-web-wasm.repl.start', async () => {
			if (!isCossOriginIsolated()) {
				return false;
			}
			const pty = Terminals.getReplTerminal(true);
			const ctrlC = pty.onDidCtrlC(() => {
				ctrlC.dispose();
				launcher.terminate().catch(console.error);
				Terminals.releaseReplTerminal(pty, true);
			});
			const launcher = RAL().launcher.create();
			await launcher.run(context, undefined, pty);
			launcher.onExit().catch(() => {
				// todo@dirkb need to think how to handle this.
			}).finally(() => {
				ctrlC.dispose();
				Terminals.releaseReplTerminal(pty);
			});
			return true;
		}),
		commands.registerCommand('vscode-python-web-wasm.debug.getProgramName', config => {
			return window.showInputBox({
				placeHolder: 'Please enter the name of a python file in the workspace folder',
				value: 'app.py'
			});
		})
	);
	return preloadPromise;
}

export function deactivate(): Promise<void> {
	return Promise.reject();
}