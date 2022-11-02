/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Terminal, Uri, window } from 'vscode';

import { ApiServiceConnection, BaseMessageConnection, ServicePseudoTerminal } from '@vscode/sync-api-service';
import { ServiceConnection, Requests, ApiService, RAL as SyncRAL} from '@vscode/sync-api-service';

import RAL from './ral';
import PythonInstallation from './pythonInstallation';
import { MessageRequests } from './messages';

type MessageConnection = BaseMessageConnection<MessageRequests, undefined, undefined, undefined, any>;

export interface Launcher {
	/**
	 * Run the Python WASM.
	 *
	 * @param context The VS Code extension context
	 * @returns A promise that completes when the WASM is executing.
	 */
	run(context: ExtensionContext, program?: string, pty?: ServicePseudoTerminal): Promise<void>;

	/**
	 * A promise that resolves then the WASM finished running.
	 *
	 * @returns The promise.
	 */
	onExit(): Promise<number>;

	terminate(): Promise<void>;
}

export abstract class BaseLauncher {

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
	public async run(context: ExtensionContext, program?: string, pty?: ServicePseudoTerminal): Promise<void> {
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
			echoName: false,
		});

		const name = program !== undefined
			? `Executing ${RAL().path.basename(program)}`
			: 'Python REPL';

		if (pty !== undefined) {
			apiService.registerCharacterDeviceDriver(pty, true);
		}
		apiService.signalReady();

		const runRequest: Promise<number> = program === undefined
			? messageConnection.sendRequest('runRepl', { syncPort: port }, [port])
			: messageConnection.sendRequest('executeFile', { syncPort: port, file: program }, [port]);

		runRequest.
			then((rval) => { this.exitResolveCallback(rval); }).
			catch((reason) => { this.exitRejectCallback(reason); }).
			finally(() => { void this.terminateConnection(); });
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

	protected abstract createSyncConnection(messageConnection: MessageConnection): Promise<[ApiServiceConnection, any]>;

	protected abstract terminateConnection(): Promise<void>;
}