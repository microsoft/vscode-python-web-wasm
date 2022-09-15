/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';

import { DebugAdapter } from './debugAdapter';

class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | undefined> {
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'python') {
				config.type = 'python-web-wasm';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = false;
			}
		}

		if (!config.program) {
			await vscode.window.showInformationMessage('Cannot find a Python file to debug');
			return undefined;
		}

		return config;
	}
}

class DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
	constructor(private readonly context: vscode.ExtensionContext) {
	}
	createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new DebugAdapter(session, this.context));
	}
}

export function activate(context: vscode.ExtensionContext) {
	void vscode.window.showWarningMessage('Hello World from python web');

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-python-web-wasm.debug.runEditorContents', async (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				return vscode.debug.startDebugging(undefined, {
					type: 'python-web-wasm',
					name: 'Run Python in WASM',
					request: 'launch',
					program: targetResource.fsPath
				},
				{
					noDebug: true
				});
			}
			return false;
		}),
		vscode.commands.registerCommand('vscode-python-web-wasm.debug.debugEditorContents', async (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				return vscode.debug.startDebugging(undefined, {
					type: 'python-web-wasm',
					name: 'Debug Python in WASM',
					request: 'launch',
					program: targetResource.fsPath,
					stopOnEntry: true
				});
			}
			return false;
		}),
		vscode.commands.registerCommand('vscode-python-web-wasm.debug.getProgramName', config => {
			return vscode.window.showInputBox({
				placeHolder: 'Please enter the name of a markdown file in the workspace folder',
				value: 'app.py'
			});
		})
	);

	const provider = new DebugConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('python-web-wasm', provider));

	const factory = new DebugAdapterDescriptorFactory(context);
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('python-web-wasm', factory));
}

export function deactivate(): Promise<void> {
	return Promise.reject();
}