/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { DebugConfigurationProvider, WorkspaceFolder, DebugConfiguration, CancellationToken, window } from 'vscode';
import RAL from '../common/ral';

export class DesktopDebugConfigurationProvider implements DebugConfigurationProvider {

	constructor(private readonly preloadPromise: Promise<void>) {
	}

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	async resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): Promise<DebugConfiguration | undefined> {
		if (!RAL().isCrossOriginIsolated) {
			return undefined;
		}
		await this.preloadPromise;
		if (!config.type && !config.request && !config.name) {
			const editor = window.activeTextEditor;
			if (editor && editor.document.languageId === 'python') {
				config.type = 'python-pdb-node';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
		}

		if (config.stopOnEntry === undefined) {
			config.stopOnEntry = true;
		}

		if (!config.file && !config.module) {
			await window.showInformationMessage('Cannot find a Python file to debug');
			return undefined;
		}

		return config;
	}
}
