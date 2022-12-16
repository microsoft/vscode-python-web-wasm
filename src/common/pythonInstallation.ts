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

	let wasmBytes: Thenable<SharedArrayBuffer> | undefined;

	async function resolveConfiguration(): Promise<{ repository: Uri; root: string | undefined }> {
		const path = RAL().path;
		let pythonRepository = workspace.getConfiguration('python.wasm').get<string | undefined | null>('runtime', undefined);
		let pythonRoot = undefined;
		if (pythonRepository === undefined || pythonRepository === null || pythonRepository.length === 0) {
			pythonRepository = defaultPythonRepository;
			pythonRoot = defaultPythonRoot;
		}
		if (Uri.parse(pythonRepository).authority !== 'github.com') {
			pythonRepository = defaultPythonRepository;
			pythonRoot = defaultPythonRoot;
		}
		const extname = path.extname(pythonRepository);
		if (extname === '.git') {
			pythonRepository = pythonRepository.substring(0, pythonRepository.length - extname.length);
		}
		const api = await RemoteRepositories.getApi();
		const vfs = api.getVirtualUri(Uri.parse(pythonRepository)).with({ authority: 'github' });
		return { repository: vfs, root: pythonRoot};
	}

	let configPromise: Promise<{ repository: Uri; root: string | undefined}> | undefined;
	let repositoryWatcher: Disposable | undefined;

	async function triggerPreload(): Promise<void> {
		const {repository, root} = await getConfig();
		if (repositoryWatcher === undefined) {
			const fsWatcher = workspace.createFileSystemWatcher(new RelativePattern(repository, '*'));
			repositoryWatcher =  fsWatcher.onDidChange(async (uri) => {
				if (uri.toString() === repository.toString()) {
					Tracer.append(`Repository ${repository.toString()} changed. Pre-load it again.`);
					_preload = undefined;
					preload().catch(console.error);
				}
			});
		}
		try {
			const remoteHubApi = await RemoteRepositories.getApi();
			if (remoteHubApi.loadWorkspaceContents !== undefined) {
				await remoteHubApi.loadWorkspaceContents(repository);
				Tracer.append(`Successfully loaded workspace content for repository ${repository.toString()}`);
				const binaryLocation =  root !== undefined ? Uri.joinPath(repository, root, 'python.wasm') : Uri.joinPath(repository, 'python.wasm');
				wasmBytes = workspace.fs.readFile(binaryLocation).then(bytes => {
					const buffer = new SharedArrayBuffer(bytes.byteLength);
					new Uint8Array(buffer).set(bytes);
					Tracer.append(`Successfully cached WASM file ${binaryLocation.toString()}`);
					return buffer;
				}, (error) => {
					console.error(error);
				});
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

	export async function getConfig(): Promise<{ repository: Uri; root: string | undefined}> {
		if (configPromise === undefined) {
			configPromise = resolveConfiguration();
		}
		return configPromise;
	}

	export async function sharedWasmBytes(): Promise<SharedArrayBuffer> {
		if (wasmBytes === undefined) {
			await _preload;
		}
		if (wasmBytes === undefined) {
			throw new Error(`Load python.wasm file failed`);
		}
		return wasmBytes;
	}
}

export default PythonInstallation;