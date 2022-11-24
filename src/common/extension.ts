/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	CancellationToken, commands, debug, DebugAdapterDescriptor, DebugAdapterInlineImplementation, DebugConfiguration,
	DebugSession, ExtensionContext, Uri, window, WorkspaceFolder, workspace
} from 'vscode';

import { TerminalMode } from '@vscode/sync-api-service';

import RAL from './ral';
import PythonInstallation from './pythonInstallation';
import { DebugAdapter, DebugProperties } from './debugAdapter';
import { Terminals } from './terminals';

function isCossOriginIsolated(): boolean {
	if (RAL().isCrossOriginIsolated) {
		return true;
	}
	void window.showWarningMessage(`Executing Python needs cross origin isolation. You need to \nadd ?vscode-coi= to your browser URL to enable it.`, { modal: true});
	return false;
}

function getResourceUri(fileOrUriString: string): Uri | undefined {
	try {
		return Uri.parse(fileOrUriString);
	} catch {
		try {
			return Uri.file(fileOrUriString);
		} catch {
			return undefined;
		}
	}
}

export class DebugConfigurationProvider implements DebugConfigurationProvider {

	constructor(private readonly preloadPromise: Promise<void>) {
	}

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	async resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration & DebugProperties, token?: CancellationToken): Promise<DebugConfiguration | undefined> {
		if (!isCossOriginIsolated()) {
			return undefined;
		}
		await this.preloadPromise;
		if (!config.type && !config.request && !config.name) {
			const editor = window.activeTextEditor;
			if (editor && editor.document.languageId === 'python') {
				config.type = 'python-web-wasm';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
				config.console = 'internalConsole';
			}
		}

		// Stop on entry defaults to true. Assumption being users won't
		// understand what's happening without it.
		if (config.stopOnEntry === undefined) {
			config.stopOnEntry = true;
		}

		if (!config.program) {
			await window.showInformationMessage('Cannot find a Python file to debug');
			return undefined;
		}

		// Program has to be a URI
		const targetResource = config.program && config.program !== '${file}' ? getResourceUri(config.program) : window.activeTextEditor?.document.uri;
		if (targetResource) {
			config.program = targetResource.toString();
		}

		if (config.console === 'integratedTerminal' && targetResource !== undefined) {
			const pty = Terminals.getExecutionTerminal(targetResource, true);
			pty.setMode(TerminalMode.idle); // DebugAdapter will switch to in use
			config.ptyInfo = { uuid: pty.id };
		}

		return config;
	}
}

export class DebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly context: ExtensionContext, private readonly preloadPromise: Promise<void>) {
	}
	async createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor> {
		await this.preloadPromise;
		return new DebugAdapterInlineImplementation(new DebugAdapter(session, this.context, RAL()));
	}
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
		commands.registerCommand('vscode-python-web-wasm.debug.debugEditorContents', async (resource: Uri) => {
			if (!isCossOriginIsolated()) {
				return false;
			}
			let targetResource = resource;
			if (!targetResource && window.activeTextEditor) {
				targetResource = window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				await preloadPromise;
				return debug.startDebugging(undefined, {
					type: 'python-web-wasm',
					name: 'Debug Python in WASM',
					request: 'launch',
					stopOnEntry: true,
					program: targetResource.toString(true),
					console: 'internalConsole',
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
			await launcher.startRepl(context, pty);
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

	const provider = new DebugConfigurationProvider(preloadPromise);
	context.subscriptions.push(debug.registerDebugConfigurationProvider('python-web-wasm', provider));

	const factory = new DebugAdapterDescriptorFactory(context, preloadPromise);
	context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory('python-web-wasm', factory));

	return preloadPromise;
}

export function deactivate(): Promise<void> {
	return Promise.reject();
}