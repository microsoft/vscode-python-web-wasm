/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Uri } from 'vscode';

import { Launcher } from '../common/launcher';
import { ServiceConnection } from '@vscode/sync-api-common/browser';
import { Requests } from '@vscode/sync-api-service';

export class WebLauncher extends Launcher {

	private worker: Worker | undefined;

	public constructor() {
		super();
	}

	protected async createConnection(context: ExtensionContext): Promise<ServiceConnection<Requests>> {
		const filename = Uri.joinPath(context.extensionUri, './dist/web/pythonWasmWorker.js').toString();
		this.worker = new Worker(filename);
		return new ServiceConnection<Requests>(this.worker);
	}

	protected async terminateConnection(): Promise<void> {
		this.worker?.terminate();
	}
}