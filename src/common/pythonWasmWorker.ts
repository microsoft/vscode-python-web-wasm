/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// We can't use Uri from vscode since vscode is not available in a web worker.
import { URI } from 'vscode-uri';

import { ApiClient, BaseMessageConnection, ApiClientConnection } from '@vscode/sync-api-client';
import { WASI, DeviceDescription } from '@vscode/wasm-wasi';

import * as dbgfs from './debugFileSystem';
import { MessageRequests } from './messages';
import { debug } from 'vscode';

type MessageConnection = BaseMessageConnection<undefined, undefined, MessageRequests, undefined, unknown>;

namespace DebugMain {
	// This is basically the same code in pdb.main, but using _run with a target instead
	const common = ` 
import pdb

def opendbgout():
	return open('/$debug/output', 'w', -1, 'utf-8')

def opendbgin():
	return open('/$debug/input', 'r', -1, 'utf-8')
	
def run(dbg, tgt):
	try:
		dbg._run(tgt)
	except SystemExit:
		import sys
		with open('/$debug/output', 'w', -1, 'utf-8') as dbgout:
			print(sys.exc_info()[1], file=dbgout)
	except:
		import traceback
		import sys
		with open('/$debug/output', 'w', -1, 'utf-8') as dbgout:
			traceback.print_exc(file=dbgout)
			print("Uncaught exception. Entering post mortem debugging", file=dbgout)
			dbgout.write("$terminator")
		t = sys.exc_info()[2]
		dbg.interaction(None, t)


debugger = pdb.Pdb(stdin=opendbgin(), stdout=opendbgout())
debugger.prompt = '$terminator'
target = pdb.ScriptTarget('$program')
run(debugger, target)`;

	export function create(program: string, terminator: string): string {
		return common.replace(/\$terminator/g, terminator).replace(/\$program/g, program);
	}
}

export abstract class WasmRunner {

	private pythonRepository!: URI;
	private pythonRoot: string | undefined;
	private binary!: Uint8Array;

	constructor(private readonly connection: MessageConnection, private readonly path: { readonly join: (...paths: string[]) => string, readonly sep: string }) {
		this.connection = connection;

		connection.onRequest('initialize', async (params) => {
			this.binary = new Uint8Array(params.binary.byteLength);
			this.binary.set(new Uint8Array(params.binary));
			this.pythonRepository = URI.parse(params.pythonRepository);
			this.pythonRoot = params.pythonRoot;
		});

		connection.onRequest('executeFile', (params) => {
			return this.executePythonFile(this.createClientConnection(params.syncPort), URI.parse(params.file));
		});

		connection.onRequest('debugFile', (params) => {
			return this.debugPythonFile(this.createClientConnection(params.syncPort), URI.parse(params.file), URI.from(params.uri), params.terminator);
		});

		connection.onRequest('runRepl', (params) => {
			return this.runRepl(this.createClientConnection(params.syncPort));
		});
	}

	public listen(): void {
		this.connection.listen();
	}

	protected abstract createClientConnection(port: any): ApiClientConnection;

	protected async executePythonFile(clientConnection: ApiClientConnection, file: URI): Promise<number> {
		return this.run(clientConnection, file);
	}

	protected async debugPythonFile(clientConnection: ApiClientConnection, file: URI, debug: URI, terminator: string): Promise<number> {
		return this.run(clientConnection, file, debug, terminator);
	}

	protected async runRepl(clientConnection: ApiClientConnection): Promise<number> {
		return this.run(clientConnection, undefined);
	}

	private async run(clientConnection: ApiClientConnection, file?: URI, debug?: URI, terminator?: string): Promise<number> {
		const apiClient = new ApiClient(clientConnection);
		const stdio = (await apiClient.serviceReady()).stdio;
		const path = this.path;
		// The is the name of the wasm to be execute (e.g. comparable to users typing it in bash)
		const name = 'python';
		const workspaceFolders = apiClient.vscode.workspace.workspaceFolders;
		const devices: DeviceDescription[] = [];
		let toRun: string | undefined;
		if (workspaceFolders.length === 1) {
			const folderUri = workspaceFolders[0].uri;
			devices.push({ kind: 'fileSystem',  uri: workspaceFolders[0].uri, mountPoint: path.join(path.sep, 'workspace') });
			if (file !== undefined) {
				if (file.toString().startsWith(folderUri.toString())) {
					toRun = path.join(path.sep, 'workspace', file.toString().substring(folderUri.toString().length));
				}
			}
		} else {
			for (const folder of workspaceFolders) {
				devices.push({ kind: 'fileSystem',  uri: folder.uri, mountPoint: path.join(path.sep, 'workspaces', folder.name) });
			}
		}
		const pythonInstallation = this.pythonRoot === undefined
			? this.pythonRepository
			: this.pythonRepository.with({ path: path.join( this.pythonRepository.path, this.pythonRoot )});
		devices.push({ kind: 'fileSystem', uri: pythonInstallation, mountPoint: path.sep});
		if (debug !== undefined && toRun !== undefined) {
			const mainContent = DebugMain.create(toRun, terminator || '');
			devices.push({
				kind:'custom',
				uri: debug,
				factory: (apiClient, encoder, _decoder, fileDescriptorId) => {
					return dbgfs.create(apiClient, encoder, fileDescriptorId, this.path, debug, mainContent);
				}
			});
			toRun = '/$debug/main.py';
		}
		let exitCode: number | undefined;
		const exitHandler = (rval: number): void => {
			exitCode = rval;
		};
		const wasi = WASI.create(name, apiClient, exitHandler, devices, stdio, {
			args: toRun !== undefined ? ['-B', '-X', 'utf8', toRun] : ['-B', '-X', 'utf8'],
			env: {
				PYTHONPATH: '/workspace:/site-packages'
			}
		});
		await this.doRun(this.binary, wasi);
		return exitCode ?? 0;
	}

	protected abstract doRun(binary: Uint8Array, wasi: WASI): Promise<void>;
}