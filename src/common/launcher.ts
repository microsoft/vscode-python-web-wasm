/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Terminal } from 'vscode';

import { ApiServiceConnection, BaseMessageConnection, ServicePseudoTerminal } from '@vscode/sync-api-service';
import { ApiService } from '@vscode/sync-api-service';

import PythonInstallation from './pythonInstallation';
import { MessageRequests } from './messages';
import { DebugCharacterDeviceDriver } from './debugCharacterDeviceDriver';

type MessageConnection = BaseMessageConnection<MessageRequests, undefined, undefined, undefined, any>;

type LauncherState = {
	mode: 'run' | 'debug' | 'repl';
	pty: ServicePseudoTerminal;
	program?: string;
};

export interface Launcher {

	getState(): LauncherState | undefined;

	/**
	 * Run the Python WASM.
	 *
	 * @param context The VS Code extension context.
	 * @param program The program to run.
	 * @param pty A pseudo terminal to use for input / output.
	 * @returns A promise that completes when the WASM is executing.
	 */
	run(context: ExtensionContext, program: string, pty: ServicePseudoTerminal): Promise<void>;

	/**
	 * debug a program using the Python WASM.
	 *
	 * @param context The VS Code extension context.
	 * @param program The program to run.
	 * @param pty A pseudo terminal to use for input / output.
	 * @returns A promise that completes when the WASM is executing.
	 */
	debug(context: ExtensionContext, program: string, pty: ServicePseudoTerminal): Promise<void>;

	/**
	 * Starts a REPL session.
	 *
	 * @param context  The VS Code extension context
	 * @param pty A pseudo terminal to use for input / output
	 * @returns A promise that completes when the WASM is executing.
	 */
	startRepl(context: ExtensionContext, pty: ServicePseudoTerminal): Promise<void>;

	/**
	 *
	 * @param context The VS Code extension context.
	 * @param state The state to use.
	 */
	runFromState(context: ExtensionContext, state: LauncherState): Promise<void>

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

	private state: undefined | LauncherState;

	public constructor() {
		this.exitPromise = new Promise((resolve, reject) => {
			this.exitResolveCallback = resolve;
			this.exitRejectCallback = reject;
		});
	}

	getState(): LauncherState | undefined {
		return this.state;
	}

	run(context: ExtensionContext, program: string, pty: ServicePseudoTerminal): Promise<void> {
		return this.doRun('run', context, pty, program);
	}

	debug(context: ExtensionContext, program: string, pty: ServicePseudoTerminal): Promise<void> {
		return this.doRun('debug', context, pty, program);
	}

	startRepl(context: ExtensionContext, pty: ServicePseudoTerminal): Promise<void> {
		return this.doRun('repl', context, pty);
	}

	runFromState(context: ExtensionContext, state: NonNullable<BaseLauncher['state']>): Promise<void> {
		switch (state.mode) {
			case 'run':
				return this.doRun('run', context, state.pty, state.program!);
			case 'debug':
				return this.doRun('debug', context, state.pty, state.program!);
			case 'repl':
				return this.doRun('repl', context, state.pty);

		}
	}

	private doRun(mode: 'run', context: ExtensionContext, pty: ServicePseudoTerminal, program: string): Promise<void>;
	private doRun(mode: 'debug', context: ExtensionContext, pty: ServicePseudoTerminal, program: string): Promise<void>;
	private doRun(mode: 'repl', context: ExtensionContext, pty: ServicePseudoTerminal): Promise<void>;
	private async doRun(mode: 'run' | 'debug' | 'repl', context: ExtensionContext, pty: ServicePseudoTerminal,  program?: string): Promise<void> {
		this.state = { mode, pty, program };
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

		apiService.registerCharacterDeviceDriver(pty, true);
		let debugCharacterDeviceDriver: DebugCharacterDeviceDriver | undefined;
		if (mode === 'debug' || mode === 'repl') {
			debugCharacterDeviceDriver = new DebugCharacterDeviceDriver();
			apiService.registerCharacterDeviceDriver(debugCharacterDeviceDriver, false);
		}
		apiService.signalReady();

		const runRequest: Promise<number> = mode === 'run'
			? messageConnection.sendRequest('executeFile', { syncPort: port, file: program! }, [port])
			: mode === 'debug'
				? messageConnection.sendRequest('debugFile', { syncPort: port, file: program!, uri: debugCharacterDeviceDriver!.uri }, [port])
				: messageConnection.sendRequest('runRepl', { syncPort: port , uri: debugCharacterDeviceDriver!.uri }, [port]);

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