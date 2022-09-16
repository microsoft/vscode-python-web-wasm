/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { URI } from 'vscode-uri';

import { WASI, Options } from '@vscode/wasm-wasi';
import { ClientConnection, ApiClient, Requests } from '@vscode/sync-api-client';

export abstract class WasmRunner {
	constructor(private readonly connection: ClientConnection<Requests>, private readonly path: { readonly join: (...paths: string[]) => string, readonly sep: string }) {
	}

	public async run(): Promise<void> {
		await this.connection.serviceReady();
		const path = this.path;
		const name = 'Python Terminal';
		const apiClient = new ApiClient(this.connection);
		const workspaceFolders = apiClient.vscode.workspace.workspaceFolders;
		const activeTextDocument = apiClient.vscode.window.activeTextDocument;
		const mapDir: Options['mapDir'] = [];
		let toRun: string | undefined;
		if (workspaceFolders.length === 1) {
			const folderUri = workspaceFolders[0].uri;
			mapDir.push({ name: path.join(path.sep, 'workspace'), uri: folderUri });
			if (activeTextDocument !== undefined) {
				const file =  activeTextDocument.uri;
				if (file.toString().startsWith(folderUri.toString())) {
					toRun = path.join(path.sep, 'workspace', file.toString().substring(folderUri.toString().length));
				}
			}
		} else {
			for (const folder of workspaceFolders) {
				mapDir.push({ name: path.join(path.sep, 'workspaces', folder.name), uri: folder.uri });
			}
		}
		const pythonRoot = URI.parse('vscode-vfs://github/dbaeumer/python-3.11.0rc');
		mapDir.push({ name: path.sep, uri: pythonRoot });
		const exitHandler = (rval: number): void => {
			apiClient.process.procExit(rval);
		};
		const wasi = WASI.create(name, apiClient, exitHandler, {
			mapDir,
			argv: toRun !== undefined ? ['python', '-X', 'utf8', toRun] : ['python', '-X', 'utf8'],
			env: {
				PYTHONPATH: '/workspace'
			}
		});
		const binary = apiClient.vscode.workspace.fileSystem.readFile(pythonRoot.with({ path: path.join(pythonRoot.path, 'python.wasm') }));
		await this.doRun(binary, wasi);
		apiClient.process.procExit(0);
	}

	protected abstract doRun(binary: Uint8Array, wasi: WASI): Promise<void>;
}