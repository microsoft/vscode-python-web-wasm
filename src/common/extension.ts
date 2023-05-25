/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	CancellationToken, commands, debug, DebugAdapterDescriptor, DebugAdapterInlineImplementation,
	DebugConfiguration, DebugSession, ExtensionContext, Uri, window, WorkspaceFolder
} from 'vscode';

import { PseudoterminalState, Wasm } from '@vscode/wasm-wasi';

import RAL from './ral';
import { DebugAdapter, DebugProperties } from './debugAdapter';
import { Terminals } from './terminals';
import Python from './python';
import Logger from './logger';

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

	constructor() {
	}

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	async resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration & DebugProperties, token?: CancellationToken): Promise<DebugConfiguration | undefined> {
		if (!isCossOriginIsolated()) {
			return undefined;
		}
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
			pty.setState(PseudoterminalState.free); // DebugAdapter will switch to busy
			config.ptyInfo = { uuid: Terminals.getTerminalHandle(pty) };
		}

		return config;
	}
}

export class DebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly context: ExtensionContext) {
	}
	async createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor> {
		return new DebugAdapterInlineImplementation(new DebugAdapter(session, this.context, RAL()));
	}
}


export async function activate(context: ExtensionContext) {
	const wasm = await Wasm.load();
	Python.initialize(context);
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
				try {
					const pty = Terminals.getExecutionTerminal(targetResource, true);
					const process = await Python.createProcess(pty.stdio, targetResource);
					const ctrlC = pty.onDidCtrlC(() => {
						ctrlC.dispose();
						process.terminate().catch(RAL().console.error);
						Terminals.releaseExecutionTerminal(pty, true);
					});
					try {
						await process.run();
					} finally {
						ctrlC.dispose();
						Terminals.releaseExecutionTerminal(pty);
					}
				} catch (error: any) {
					Logger().error(error);
				}
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
			try {
				const pty = Terminals.getReplTerminal(true);
				const process = await Python.createProcess(pty.stdio);
				const ctrlC = pty.onDidCtrlC(() => {
					ctrlC.dispose();
					process.terminate().catch(RAL().console.error);
					Terminals.releaseReplTerminal(pty, true);
				});
				try {
					await process.run();
				} finally {
					ctrlC.dispose();
					Terminals.releaseReplTerminal(pty);
				}
			} catch (error: any) {
				Logger().error(error);
			}
			return true;
		}),
		commands.registerCommand('vscode-python-web-wasm.debug.getProgramName', config => {
			return window.showInputBox({
				placeHolder: 'Please enter the name of a python file in the workspace folder',
				value: 'app.py'
			});
		})
	);

	const provider = new DebugConfigurationProvider();
	context.subscriptions.push(debug.registerDebugConfigurationProvider('python-web-wasm', provider));

	const factory = new DebugAdapterDescriptorFactory(context);
	context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory('python-web-wasm', factory));
}

export function deactivate(): Promise<void> {
	return Promise.reject();
}