/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Disposable, ExtensionContext, RelativePattern, Uri, workspace } from 'vscode';
import {
	ExtensionLocationDescriptor, MemoryFileSystem, MountPointDescriptor, ProcessOptions, Readable, RootFileSystem, Stdio,
	VSCodeFileSystemDescriptor, Wasm, WasmProcess, WasmPseudoterminal, Writable
} from '@vscode/wasm-wasi';

import RAL from './ral';
import Logger from './logger';
import RemoteRepositories from './remoteRepositories';

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
target = pdb.ScriptTarget('$program') if hasattr(pdb, 'ScriptTarget') else pdb._ScriptTarget('$program')
run(debugger, target)`;

	export function create(program: string, terminator: string): string {
		return common.replace(/\$terminator/g, terminator).replace(/\$program/g, program);
	}
}

export class DebugProcess {
	private readonly _process: WasmProcess;
	private readonly _rootFileSystem: RootFileSystem;
	private readonly _dbgin: Writable;
	private readonly _dbgout: Readable;

	constructor(process: WasmProcess, rootFileSystem: RootFileSystem, dbgin: Writable, dbgout: Readable) {
		this._process = process;
		this._rootFileSystem = rootFileSystem;
		this._dbgin = dbgin;
		this._dbgout = dbgout;
	}

	public get stdin(): Writable | undefined {
		return this._process.stdin;
	}

	public get stdout(): Readable | undefined {
		return this._process.stdout;
	}

	public get stderr(): Readable | undefined {
		return this._process.stderr;
	}

	public get dbgin(): Writable {
		return this._dbgin;
	}

	public get dbgout(): Readable {
		return this._dbgout;
	}

	public toWasm(file: Uri): Promise<string | undefined> {
		return this._rootFileSystem.toWasm(file);
	}

	public toVSCode(file: string): Promise<Uri | undefined> {
		return this._rootFileSystem.toVSCode(file);
	}

	public run(): Promise<number> {
		return this._process.run();
	}

	public terminate(): Promise<number> {
		return this._process.terminate();
	}
}

namespace Python {

	type Configuration = { location: Uri, bits: Uri, lib: VSCodeFileSystemDescriptor | ExtensionLocationDescriptor };

	let $context: ExtensionContext | undefined = undefined;
	let module: Promise<WebAssembly.Module> | undefined | null = undefined;
	let libs: VSCodeFileSystemDescriptor | ExtensionLocationDescriptor | undefined = undefined;

	export function initialize(context: ExtensionContext) {
		$context = context;
		preload().catch(error => { Logger().error(error); });
	}

	export async function createProcess(stdio: Stdio, file?: Uri): Promise<WasmProcess> {
		const [module, configuration] = await Promise.all([getModule(), resolveConfiguration()]);
		const options: ProcessOptions = {
			stdio: stdio,
			mountPoints: [
				{ kind: 'workspaceFolder' },
				configuration.lib,
			],
			env: {
 				PYTHONPATH: '/workspace'
 			},
			args: file !== undefined ? ['-B', '-X', 'utf8', file] : ['-B', '-X', 'utf8']
		};

		return Wasm.api().createProcess('python', module, options);
	}

	export async function createDebugProcess(file: Uri, terminal?: WasmPseudoterminal, terminator?: string): Promise<DebugProcess> {
		const wasm = Wasm.api();
		const [module, configuration] = await Promise.all([getModule(), resolveConfiguration()]);
		const debugFileSystem: MemoryFileSystem = await wasm.createMemoryFileSystem();
		debugFileSystem.createFile('main.py', {
			size: 4069n,
			reader: async () => {
				const wasmPath = await rootFileSystem.toWasm(file);
				if (wasmPath === undefined) {
					throw new Error(`Failed to resolve file ${file}`);
				}
				const content = DebugMain.create(wasmPath, terminator ?? '');
				return RAL().TextEncoder.create().encode(content);
			}
		});

		let stdio: Stdio;
		if (terminal !== undefined) {
			stdio = terminal.stdio;
		} else {
			const input = wasm.createWritable();
			const out = wasm.createReadable();
			const err = wasm.createReadable();
			stdio = {
				in: { kind: 'pipeIn' as const, pipe: input },
				out: { kind: 'pipeOut' as const, pipe: out },
				err: { kind: 'pipeOut' as const, pipe: err }
			};
		}

		const dbgin = debugFileSystem.createWritable('input');
		const dbgout = debugFileSystem.createReadable('output');

		const mountPoints: MountPointDescriptor[] = [
			{ kind: 'workspaceFolder' },
			configuration.lib,
			{ kind: 'memoryFileSystem', mountPoint: '/$debug', fileSystem: debugFileSystem }
		];
		const rootFileSystem = await wasm.createRootFileSystem(mountPoints);
		const options: ProcessOptions = {
			stdio: stdio,
			rootFileSystem,
			env: {
 				PYTHONPATH: '/workspace'
 			},
			args: ['-B', '-X', 'utf8', '/$debug/main.py']
		};
		const process = await Wasm.api().createProcess('python', module, options);
		return new DebugProcess(process, rootFileSystem, dbgin, dbgout);
	}

	function context(): ExtensionContext {
		if ($context === undefined) {
			throw new Error('Environment not initialized');
		}
		return $context;
	}

	async function getModule(): Promise<WebAssembly.Module> {
		if (module === null) {
			throw new Error('Compiling WASM module failed. See output for details.');
		}
		if (module === undefined) {
			await preload();
		}
		return module!;
	}

	async function resolveConfiguration(): Promise<Configuration> {
		const defaultLocation = context().extensionUri;
		const defaultBits = Uri.joinPath(context().extensionUri, 'wasm', 'bin', 'python.wasm');
		const defaultLib: ExtensionLocationDescriptor = {
			kind: 'extensionLocation',
			extension: context().extension,
			path: 'wasm/lib',
			mountPoint: '/usr/local/lib/python3.11'
		};

		let location = defaultLocation;
		let bits = defaultBits;
		let lib: VSCodeFileSystemDescriptor | ExtensionLocationDescriptor = defaultLib;
		const paths = RAL().path;

		let runtimeSetting = workspace.getConfiguration('python.wasm').get<string | undefined | null>('runtime', undefined);
		if (runtimeSetting !== undefined && runtimeSetting !== null && runtimeSetting.length > 0) {
			try {
				const location = Uri.parse(runtimeSetting);
				bits = Uri.joinPath(location, 'python.wasm');
				lib = {
					kind: 'vscodeFileSystem',
					uri: Uri.joinPath(location, 'lib', 'python3.11'),
					mountPoint: '/usr/local/lib/python3.11'
				};
				// If we point to github.com we need to turn the URI into a virtual one
				if (bits.authority === 'github.com') {
					const uriPath = bits.path;
					const extname = paths.extname(uriPath);
					if (extname === '.git') {
						bits = bits.with({ path: uriPath.substring(0, uriPath.length - extname.length) });
					}
					const api = await RemoteRepositories.getApi();
					bits = api.getVirtualUri(bits.with({ authority: 'github' }));
				}

				await workspace.fs.stat(bits);
				Logger().info(`Using Python from ${bits.toString()}`);
			} catch (error) {
				Logger().warn(`${runtimeSetting} is not a valid URI. Falling back to default Python binaries provided by the extension itself.`);
				location = defaultLocation;
				bits = defaultBits;
				lib = defaultLib;
			}
		}
		return { location, bits, lib };
	}

	let _configPromise: Promise<Configuration> | undefined;
	export async function getConfig(): Promise<Configuration> {
		if (_configPromise === undefined) {
			_configPromise = resolveConfiguration();
		}
		return _configPromise;
	}

	let _repositoryWatcher: Disposable | undefined;
	let preloadToken: number = 0;
	async function triggerPreload(): Promise<void> {
		const { location, bits } = await getConfig();
		const isVSCodeVFS = location.scheme === 'vscode-vfs';
		// We can only preload a repository if we are using a vscode virtual file system.
		if (isVSCodeVFS && _repositoryWatcher === undefined) {
			const fsWatcher = workspace.createFileSystemWatcher(new RelativePattern(location, '*'));
			_repositoryWatcher =  fsWatcher.onDidChange(async (uri) => {
				if (uri.toString() === location.toString()) {
					Logger().info(`Repository ${location.toString()} changed. Pre-load it again.`);
					_preload = undefined;
					preload().catch(RAL().console.error);
				}
			});
		}
		try {
			const token = ++preloadToken;

			if (isVSCodeVFS) {
				const remoteHubApi = await RemoteRepositories.getApi();
				if (remoteHubApi.loadWorkspaceContents !== undefined) {
					await remoteHubApi.loadWorkspaceContents(location);
				}
				Logger().info(`Successfully loaded workspace content for repository ${location.toString()}`);
			}
			try {
				// We didn't start another preload.
				if (token === preloadToken) {
					module = Wasm.api().compile(bits);
					Logger().info(`Successfully cached WASM module ${bits.toString()}`);
				} else {
					module = null;
				}
			} catch (error) {
				module = null;
				Logger().error(`Caching WASM module ${bits.toString()} failed`);
				if (error instanceof Error)  {
					Logger().error(error);
				}
			}
		} catch (error) {
			Logger().error(`Loading workspace content for repository ${location.toString()} failed: ${error instanceof Error ? error.toString() : 'Unknown reason'}`);
			if (error instanceof Error)  {
				Logger().error(error);
			}
		}
	}

	let _preload: Promise<void> | undefined;
	export function preload(): Promise<void> {
		if (_preload === undefined) {
			_preload = triggerPreload();
		}
		return _preload;
	}

	workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('python.wasm')) {
			_configPromise = undefined;
			if (_repositoryWatcher !== undefined) {
				_repositoryWatcher.dispose();
				_repositoryWatcher = undefined;
			}
			_preload = undefined;
			preload().catch(RAL().console.error);
		}
	});
}

export default Python;