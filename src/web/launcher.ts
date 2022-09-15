/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Uri, window } from 'vscode';

import { Launcher } from '../common/launcher';
import { ServiceConnection } from '@vscode/sync-api-common/browser';
import { Requests, ApiService } from '@vscode/sync-api-service';

export class WebLauncher implements Launcher {

	private readonly exitPromise: Promise<number>;
	private exitResolveCallback!: ((value: number) => void);

	public constructor() {
		this.exitPromise = new Promise((resolve) => {
			this.exitResolveCallback = resolve;
		});
	}

	public async run(context: ExtensionContext): Promise<void> {
		const filename = Uri.joinPath(context.extensionUri, './dist/web/pythonWasmWorker.js').toString();
		const worker = new Worker(filename);
		const connection = new ServiceConnection<Requests>(worker);
		const apiService = new ApiService('Python Shell', connection, (rval) => {
			setTimeout(() => {
				worker.terminate();
			}, 0);
			this.exitResolveCallback(rval);
		});
		const pty = apiService.getPty();
		const channel = window.createOutputChannel('Python Terminal');
		channel.show();
		pty.onDidWrite((value) => {
			channel.append(value);
		});
		// const terminal = window.createTerminal({ name: 'Python Terminal', pty:  });
		// terminal.show();
		connection.signalReady();
	}


	onExit(): Promise<number> {
		return this.exitPromise;
	}
}