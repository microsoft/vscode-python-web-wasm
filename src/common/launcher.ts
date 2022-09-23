/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Terminal, Uri, window } from 'vscode';

import { BaseMessageConnection } from '@vscode/sync-api-service';
import { ServiceConnection, Requests, ApiService, RAL as SyncRAL} from '@vscode/sync-api-service';

import RAL from './ral';
import PythonInstallation from './pythonInstallation';
import { MessageRequests } from './messages';

type MessageConnection = BaseMessageConnection<MessageRequests, undefined, undefined, undefined, any>;

export abstract class Launcher {

	private readonly exitPromise: Promise<number>;
	private exitResolveCallback!: ((value: number) => void);
	private exitRejectCallback!: ((reason: any) => void);

	private terminal: Terminal | undefined;

	public constructor() {
		this.exitPromise = new Promise((resolve, reject) => {
			this.exitResolveCallback = resolve;
			this.exitRejectCallback = reject;
		});
	}

	/**
	 * Run the Python WASM.
	 *
	 * @param context The VS Code extension context
	 * @returns A promise that completes when the WASM is executing.
	 */
	public async run(context: ExtensionContext, program?: string): Promise<void> {
		const [{ repository, root }, sharedWasmBytes, messageConnection] = await Promise.all([PythonInstallation.getConfig(), PythonInstallation.sharedWasmBytes(), this.createMessageConnection(context)]);

		messageConnection.listen();
		// Send initialize to the worker. We could cache them in the future.
		await messageConnection.sendRequest('initialize', {
			pythonRepository: repository.toString(true),
			pythonRoot: root,
			binary: sharedWasmBytes
		});

		const [syncConnection, port] = await this.createSyncConnection(messageConnection);
		const apiService = new ApiService('Python WASM Execution', syncConnection, {
			exitHandler: (_rval) => {
			},
			echoName: false
		});
		const name = program !== undefined
			? `Executing ${RAL().path.basename(program)}`
			: 'Executing Python File';
		this.terminal = window.createTerminal({ name: name, pty: apiService.getPty() });
		// See https://github.com/microsoft/vscode/issues/160914
		SyncRAL().timer.setTimeout(() => {
			this.terminal!.show();
		}, 50);
		syncConnection.signalReady();

		const result: Promise<number> = program === undefined
			? messageConnection.sendRequest('runRepl', { syncPort: port }, [port])
			: messageConnection.sendRequest('executeFile', { syncPort: port, file: program }, [port]);

		result.
			then((rval) => { this.exitResolveCallback(rval);}).
			catch((reason) => { this.exitRejectCallback(reason); });
	}

	/**
	 * A promise that resolves then the WASM finished running.
	 *
	 * @returns The promise.
	 */
	public onExit(): Promise<number> {
		return this.exitPromise;
	}

	public terminate(): Promise<void> {
		if (this.terminal !== undefined) {
			this.terminal.sendText(`Execution terminated`, true);
		}
		return this.terminateConnection();
	}

	protected abstract createMessageConnection(context: ExtensionContext): Promise<MessageConnection>;

	protected abstract createSyncConnection(messageConnection: MessageConnection): Promise<[ServiceConnection<Requests>, any]>;

	protected abstract terminateConnection(): Promise<void>;
}