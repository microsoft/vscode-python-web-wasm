/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import RAL from './ral';

import { Disposable, RelativePattern, Uri, workspace } from 'vscode';
import RemoteRepositories from './remoteRepositories';
import { Tracer } from './trace';

namespace PythonInstallation  {

	const defaultPythonRepository = 'https://github.com/microsoft/vscode-python-web-wasm' as const;
	const defaultPythonRoot = 'python' as const;

	async function resolveConfiguration(): Promise<{ repository: Uri; root: string | undefined }> {
		const path = RAL().path;
		let pythonRepository = workspace.getConfiguration('python.wasm').get<string | undefined | null>('runtime', undefined);
		let isDefault: boolean = false;
		let pythonRoot = undefined;
		if (pythonRepository === undefined || pythonRepository === null || pythonRepository.length === 0) {
			pythonRepository = defaultPythonRepository;
			pythonRoot = defaultPythonRoot;
			isDefault = true;
		}

		let pythonRepositoryUri: Uri | undefined = undefined;
		try {
			pythonRepositoryUri = Uri.parse(pythonRepository);
		} catch (error) {
			Tracer.append(`${pythonRepository} is not a valid URI. Falling back to default Python repository ${defaultPythonRepository}`);
		}

		if (pythonRepositoryUri === undefined) {
			pythonRepositoryUri = Uri.parse(defaultPythonRepository);
			pythonRoot = defaultPythonRoot;
			isDefault = true;
		}

		// If we point to github.com we need to turn the URI into a virtual one
		if (pythonRepositoryUri.authority === 'github.com') {
			const uriPath = pythonRepositoryUri.path;
			const extname = path.extname(uriPath);
			if (extname === '.git') {
				pythonRepositoryUri = pythonRepositoryUri.with({ path: uriPath.substring(0, uriPath.length - extname.length) });
			}
			const api = await RemoteRepositories.getApi();
			pythonRepositoryUri = api.getVirtualUri(pythonRepositoryUri.with({ authority: 'github' }));
		}

		// If we are not on the default location make sure we have a python.wasm file
		if (!isDefault) {
			try {
				const binaryLocation = createPythonWasmUri(pythonRepositoryUri, pythonRoot);
				await workspace.fs.stat(binaryLocation);
				Tracer.append(`Using Python from ${pythonRepositoryUri}`);
			} catch (error) {
				Tracer.append(`Failed to load Python from ${pythonRepositoryUri}`);
				const api = await RemoteRepositories.getApi();
				pythonRepositoryUri = api.getVirtualUri(Uri.parse(defaultPythonRepository).with({ authority: 'github' }));
				pythonRoot = defaultPythonRoot;
				isDefault = true;
				Tracer.append(`Falling back to default Python repository ${pythonRepositoryUri}`);
			}
		}

		return { repository: pythonRepositoryUri, root: pythonRoot};
	}

	let _configPromise: Promise<{ repository: Uri; root: string | undefined}> | undefined;
	export async function getConfig(): Promise<{ repository: Uri; root: string | undefined}> {
		if (_configPromise === undefined) {
			_configPromise = resolveConfiguration();
		}
		return _configPromise;
	}
	workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('python.wasm')) {
			_configPromise = undefined;
			if (_repositoryWatcher !== undefined) {
				_repositoryWatcher.dispose();
				_repositoryWatcher = undefined;
			}
			_preload = undefined;
			preload().catch(console.error);
		}
	});

	let _repositoryWatcher: Disposable | undefined;
	let preloadToken: number = 0;
	async function triggerPreload(): Promise<void> {
		const {repository, root} = await getConfig();
		const isVSCodeVFS = repository.scheme === 'vscode-vfs';
		// We can only preload a repository if we are using a vscode virtual file system.
		if (isVSCodeVFS && _repositoryWatcher === undefined) {
			const fsWatcher = workspace.createFileSystemWatcher(new RelativePattern(repository, '*'));
			_repositoryWatcher =  fsWatcher.onDidChange(async (uri) => {
				if (uri.toString() === repository.toString()) {
					Tracer.append(`Repository ${repository.toString()} changed. Pre-load it again.`);
					_preload = undefined;
					preload().catch(console.error);
				}
			});
		}
		try {
			const token = ++preloadToken;

			if (isVSCodeVFS) {
				const remoteHubApi = await RemoteRepositories.getApi();
				if (remoteHubApi.loadWorkspaceContents !== undefined) {
					await remoteHubApi.loadWorkspaceContents(repository);
				}
				Tracer.append(`Successfully loaded workspace content for repository ${repository.toString()}`);
			}
			const binaryLocation =  root !== undefined ? Uri.joinPath(repository, root, 'python.wasm') : Uri.joinPath(repository, 'python.wasm');
			try {
				const bytes = await workspace.fs.readFile(binaryLocation);
				// We didn't start another preload.
				if (token === preloadToken) {
					const buffer = new SharedArrayBuffer(bytes.byteLength);
					new Uint8Array(buffer).set(bytes);
					Tracer.append(`Successfully cached WASM file ${binaryLocation.toString()}`);
					wasmBytes = buffer;

				} else {
					wasmBytes = undefined;
				}
			} catch (error) {
				wasmBytes = undefined;
				Tracer.append(`Caching WASM file ${binaryLocation.toString()} failed`);
				console.error(error);
			}
		} catch (error) {
			Tracer.append(`Loading workspace content for repository ${repository.toString()} failed: ${error instanceof Error ? error.toString() : 'Unknown reason'}`);
			console.error(error);
		}
	}

	let _preload: Promise<void> | undefined;
	export function preload(): Promise<void> {
		if (_preload === undefined) {
			_preload = triggerPreload();
		}
		return _preload;
	}

	let wasmBytes: SharedArrayBuffer | undefined;
	export async function sharedWasmBytes(): Promise<SharedArrayBuffer> {
		if (wasmBytes === undefined) {
			await _preload;
		}
		if (wasmBytes === undefined) {
			throw new Error(`Load python.wasm file failed`);
		}
		return wasmBytes;
	}

	function createPythonWasmUri(repository: Uri, root: string | undefined) {
		return root !== undefined ? Uri.joinPath(repository, root, 'python.wasm') : Uri.joinPath(repository, 'python.wasm');
	}
}
export default PythonInstallation;