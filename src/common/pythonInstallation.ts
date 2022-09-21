/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Uri, workspace } from 'vscode';
import RemoteRepositories from './remoteRepositories';

namespace PythonInstallation  {

	async function resolvePython(): Promise<[Uri, string]> {
		let pythonRoot = workspace.getConfiguration('python.wasm').get<string | undefined | null>('runtime', undefined);
		let pythonWasm = 'python.wasm';
		if (pythonRoot === undefined || pythonRoot === null) {
			pythonRoot = 'https://github.com/microsoft/vscode-python-web-wasm.git';
			pythonWasm = 'python/python.wasm';
		}
		const api = await RemoteRepositories.getApi();
		const vfs = api.getVirtualUri(Uri.parse(pythonRoot.replace('//github.com/', '//github/')));
		return [vfs, pythonWasm];
	}

	const configPromise: Promise<[Uri, string]> = resolvePython();

	export async function getConfig(): Promise<[Uri, string]> {
		return configPromise;
	}

	export async function preload(): Promise<void> {
		const [pythonRoot, pythonWasm] = await configPromise;
		try {
			const remoteHubApi = await RemoteRepositories.getApi();
			if (remoteHubApi.loadWorkspaceContents !== undefined) {
				await remoteHubApi.loadWorkspaceContents(pythonRoot);
				if (pythonWasm !== undefined) {
					void workspace.fs.readFile(Uri.joinPath(pythonRoot, pythonWasm));
				}
			}
		} catch (error) {
			console.log(error);
		}
	}
}

export default PythonInstallation;