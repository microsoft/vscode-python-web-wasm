/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Terminal, Event, EventEmitter } from 'vscode';

import { ApiServiceConnection, BaseMessageConnection, CharacterDeviceDriver, DTOs, ServicePseudoTerminal } from '@vscode/sync-api-service';
import { ApiService } from '@vscode/sync-api-service';

import PythonInstallation from './pythonInstallation';
import { MessageRequests, MessageNotifications } from './messages';
import { DebugCharacterDeviceDriver } from './debugCharacterDeviceDriver';

export type MessageConnection = BaseMessageConnection<MessageRequests, undefined, undefined, MessageNotifications, any>;

type LauncherState = {
	mode: 'run' | 'debug' | 'repl';
	stdio?: CharacterDeviceDriver;
	program?: string;
};

export interface Launcher {

	/**
	 * An event that signals the path mapping used by the
	 * WASM runtime
	 */
	onPathMapping: Event<PathMapping>;

	/**
	 * The launcher state.
	 */
	getState(): LauncherState | undefined;

	/**
	 * Run the Python WASM.
	 *
	 * @param context The VS Code extension context.
	 * @param program The program to run.
	 * @param stdio A character device acting as stdio
	 * @returns A promise that completes when the WASM is executing.
	 */
	run(context: ExtensionContext, program: string, stdio: CharacterDeviceDriver): Promise<void>;

	/**
	 * debug a program using the Python WASM.
	 *
	 * @param context The VS Code extension context.
	 * @param program The program to run.
	 * @param stdio A character device acting as stdio
	 * @param terminator Terminator sent by PDB when it is ready to accept commands.
	 * @returns A promise that completes when the WASM is executing.
	 */
	debug(context: ExtensionContext, program: string, stdio: CharacterDeviceDriver, debugPorts: DebugCharacterDeviceDriver, terminator: String): Promise<void>;

	/**
	 * Starts a REPL session.
	 *
	 * @param context  The VS Code extension context
	 * @param stdio A character device acting as stdio
	 * @returns A promise that completes when the WASM is executing.
	 */
	startRepl(context: ExtensionContext, stdio: CharacterDeviceDriver): Promise<void>;

	/**
	 * A promise that resolves then the WASM finished running.
	 *
	 * @returns The promise.
	 */
	onExit(): Promise<number>;

	terminate(): Promise<void>;
}

export type PathMapping = {
	[mountPoint: string]: DTOs.UriComponents;
};

export abstract class BaseLauncher {

	private readonly exitPromise: Promise<number>;
	private exitResolveCallback!: ((value: number) => void);
	private exitRejectCallback!: ((reason: any) => void);

	private terminal: Terminal | undefined;

	private state: undefined | LauncherState;

	private _onPathMapping: EventEmitter<PathMapping>;

	public constructor() {
		this.exitPromise = new Promise((resolve, reject) => {
			this.exitResolveCallback = resolve;
			this.exitRejectCallback = reject;
		});
		this._onPathMapping = new EventEmitter();
		this.onPathMapping = this._onPathMapping.event;
	}

	public onPathMapping: Event<PathMapping>;

	public getState(): LauncherState | undefined {
		return this.state;
	}

	public run(context: ExtensionContext, program: string, stdio: CharacterDeviceDriver): Promise<void> {
		return this.doRun('run', context, stdio, program);
	}

	public debug(context: ExtensionContext, program: string, stdio: CharacterDeviceDriver, debugPorts: DebugCharacterDeviceDriver, terminator: string): Promise<void> {
		return this.doRun('debug', context, stdio, program, debugPorts, terminator);
	}

	public startRepl(context: ExtensionContext, stdio: CharacterDeviceDriver): Promise<void> {
		return this.doRun('repl', context, stdio);
	}

	private doRun(mode: 'run', context: ExtensionContext, stdio: CharacterDeviceDriver, program: string): Promise<void>;
	private doRun(mode: 'debug', context: ExtensionContext, stdio: CharacterDeviceDriver | undefined, program: string, debugPorts: DebugCharacterDeviceDriver, terminator: string): Promise<void>;
	private doRun(mode: 'repl', context: ExtensionContext, stdio: CharacterDeviceDriver): Promise<void>;
	private async doRun(mode: 'run' | 'debug' | 'repl', context: ExtensionContext, stdio: CharacterDeviceDriver,  program?: string, debugPorts?: DebugCharacterDeviceDriver, terminator?: string): Promise<void> {
		this.state = { mode, stdio, program };
		const [{ repository, root }, sharedWasmBytes, messageConnection] = await Promise.all([PythonInstallation.getConfig(), PythonInstallation.sharedWasmBytes(), this.createMessageConnection(context)]);

		messageConnection.listen();
		messageConnection.onNotification('pathMappings', (params) => {
			this._onPathMapping.fire(params.mapping);
		});
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

		apiService.registerCharacterDeviceDriver(stdio, true);
		if (mode === 'debug') {
			apiService.registerCharacterDeviceDriver(debugPorts!, false);
		}
		apiService.signalReady();

		const runRequest: Promise<number> = mode === 'run'
			? messageConnection.sendRequest('executeFile', { syncPort: port, file: program! }, [port])
			: mode === 'debug'
				? messageConnection.sendRequest('debugFile', { syncPort: port, file: program!, uri: debugPorts!.uri, terminator: terminator! }, [port])
				: messageConnection.sendRequest('runRepl', { syncPort: port }, [port]);

		runRequest.
			then((rval) => {
				this.exitResolveCallback(rval);
			}).
			catch((reason) => {
				this.exitRejectCallback(reason);
			}).
			finally(() => {
				void this.terminateConnection();
			});
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