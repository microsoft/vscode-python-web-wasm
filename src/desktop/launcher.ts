/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Uri, window } from 'vscode';

import { Worker } from 'worker_threads';

import { Launcher } from '../common/launcher';
import { ServiceConnection } from '@vscode/sync-api-common/node';
import { APIRequests, ApiService } from '@vscode/sync-api-service';

export class DesktopLauncher implements Launcher {

	private readonly exitPromise: Promise<number>;
	private exitResolveCallback!: ((value: number) => void);

	public constructor() {
		this.exitPromise = new Promise((resolve) => {
			this.exitResolveCallback = resolve;
		});
	}

	public async run(context: ExtensionContext): Promise<void> {
		const filename = Uri.joinPath(context.extensionUri, './out/desktop/pythonWasmWorker.js').fsPath;
		const worker = new Worker(filename);
		const connection = new ServiceConnection<APIRequests>(worker);
		const apiService = new ApiService('Python Shell', connection, (rval) => {
			process.nextTick(() => worker.terminate());
			this.exitResolveCallback(rval);
		});
		const terminal = window.createTerminal({ name: 'Python Terminal', pty: apiService.getPty() });
		terminal.show();
		connection.signalReady();
	}

	onExit(): Promise<number> {
		return this.exitPromise;
	}
}