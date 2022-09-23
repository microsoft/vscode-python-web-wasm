/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Uri, workspace } from 'vscode';
import RemoteRepositories from './remoteRepositories';

namespace PythonInstallation  {

	const defaultPythonRepository = 'https://github.com/microsoft/vscode-python-web-wasm.git' as const;
	const defaultPythonRoot = 'python' as const;

	let wasmBytes: Thenable<SharedArrayBuffer> | undefined;

	async function resolvePython(): Promise<{ repository: Uri; root: string | undefined }> {
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
		const api = await RemoteRepositories.getApi();
		const vfs = api.getVirtualUri(Uri.parse(pythonRepository)).with({ authority: 'github' });
		return { repository: vfs, root: pythonRoot};
	}

	const configPromise: Promise<{ repository: Uri; root: string | undefined}> = resolvePython();

	async function triggerPreload(): Promise<void> {
		const {repository, root} = await configPromise;
		try {
			const remoteHubApi = await RemoteRepositories.getApi();
			if (remoteHubApi.loadWorkspaceContents !== undefined) {
				await remoteHubApi.loadWorkspaceContents(repository);
				const binaryLocation =  root !== undefined ? Uri.joinPath(repository, root, 'python.wasm') : Uri.joinPath(repository, 'python.wasm');
				wasmBytes = workspace.fs.readFile(binaryLocation).then(bytes => {
					const buffer = new SharedArrayBuffer(bytes.byteLength);
					new Uint8Array(buffer).set(bytes);
					return buffer;
				}, (error) => {
					console.log(error);
				});
			}
		} catch (error) {
			console.log(error);
		}
	}

	const _preload: Promise<void> = triggerPreload();

	export function preload(): Promise<void> {
		return _preload;
	}

	export async function getConfig(): Promise<{ repository: Uri; root: string | undefined}> {
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