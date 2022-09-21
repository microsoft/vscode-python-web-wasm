/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Uri } from 'vscode';

import { MessageConnection } from 'vscode-jsonrpc';
import { WASI, Options } from '@vscode/wasm-wasi';
import { ClientConnection, ApiClient, Requests } from '@vscode/sync-api-client';

import { Initialize, ExecuteFile, RunRepl } from './messages';

export abstract class WasmRunner {

	private clientConnection!: ClientConnection<Requests>;

	private pythonRoot!: Uri;
	private apiClient!: ApiClient;
	private binary!: Uint8Array;

	constructor(private readonly connection: MessageConnection, private readonly path: { readonly join: (...paths: string[]) => string, readonly sep: string }) {
		this.connection = connection;

		connection.onRequest(Initialize.type, async (params) => {
			this.clientConnection = this.createClientConnection(params.syncPort);
			await this.clientConnection.serviceReady();
			this.apiClient = new ApiClient(this.clientConnection);

			this.pythonRoot = Uri.parse(params.pythonRoot);
			this.binary = this.apiClient.vscode.workspace.fileSystem.readFile(this.pythonRoot.with({ path: path.join(this.pythonRoot.path, 'python.wasm') }));

		});
		connection.onRequest(ExecuteFile.type, (params) => {
			return this.executePythonFile(Uri.parse(params.file));
		});
		connection.onRequest(RunRepl.type, (params) => {
			return this.runRepl();
		});
	}

	public listen(): void {
		this.connection.listen();
	}

	protected abstract createClientConnection(port: any): ClientConnection<Requests>;

	protected async executePythonFile(file: Uri): Promise<number> {
		return this.run(file);
	}

	protected async runRepl(): Promise<number> {
		return this.run();
	}

	private async run(file?: Uri): Promise<number> {
		const path = this.path;
		const name = 'Python WASM';
		const workspaceFolders = this.apiClient.vscode.workspace.workspaceFolders;
		const mapDir: Options['mapDir'] = [];
		let toRun: string | undefined;
		if (workspaceFolders.length === 1) {
			const folderUri = workspaceFolders[0].uri;
			mapDir.push({ name: path.join(path.sep, 'workspace'), uri: folderUri });
			if (file !== undefined) {
				if (file.toString().startsWith(folderUri.toString())) {
					toRun = path.join(path.sep, 'workspace', file.toString().substring(folderUri.toString().length));
				}
			}
		} else {
			for (const folder of workspaceFolders) {
				mapDir.push({ name: path.join(path.sep, 'workspaces', folder.name), uri: folder.uri });
			}
		}
		mapDir.push({ name: path.sep, uri: this.pythonRoot });
		let exitCode: number | undefined;
		const exitHandler = (rval: number): void => {
			exitCode = rval;
		};
		const wasi = WASI.create(name, this.apiClient, exitHandler, {
			mapDir,
			argv: toRun !== undefined ? ['python', '-X', 'utf8', toRun] : ['python', '-X', 'utf8'],
			env: {
				PYTHONPATH: '/workspace'
			}
		});
		await this.doRun(this.binary, wasi);
		return exitCode ?? 0;
	}

	protected abstract doRun(binary: Uint8Array, wasi: WASI): Promise<void>;
}