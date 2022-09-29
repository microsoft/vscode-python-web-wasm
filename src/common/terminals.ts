/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Disposable, Terminal, Uri, window } from 'vscode';

import * as uuid from 'uuid';

import { ServicePseudoTerminal, TerminalMode } from '@vscode/sync-api-service';
import RAL from './ral';

export namespace Terminals {

	export type UUID = string;
	export type Data = { uuid: UUID };

	type TerminalIdleInfo = [Terminal, ServicePseudoTerminal<Data>, Disposable];
	type TerminalInUseInfo = [Terminal, ServicePseudoTerminal<Data>];

	const idleTerminals: Map<UUID, TerminalIdleInfo> = new Map();
	const terminalsInUse: Map<UUID, TerminalInUseInfo> = new Map();

	export function getTerminalInUse(uuid: string): ServicePseudoTerminal<Data> | undefined {
		const inUse = terminalsInUse.get(uuid);
		return inUse?.[1];
	}

	export function getExecutionTerminal(resource: Uri, show: boolean): ServicePseudoTerminal<Data> {
		const fileName = RAL().path.basename(resource.toString(true));
		const terminalName = `Executing ${fileName}`;
		const header = `Executing Python file ${fileName}`;

		return getTerminal(terminalName, header, show, true);
	}

	export function getReplTerminal(show: boolean): ServicePseudoTerminal<Data> {
		const terminalName = `Python REPL`;
		const header = `Running Python REPL`;
		return getTerminal(terminalName, header, show, false);
	}

	function getTerminal(terminalName: string, header: string | undefined, show: boolean, preserveFocus: boolean) {
		// Check if we have an idle terminal
		if (idleTerminals.size > 0) {
			const entry = idleTerminals.entries().next();
			if (entry.done === false) {
				idleTerminals.delete(entry.value[0]);
				const info = entry.value[1];
				info[2].dispose();
				const terminal = info[0];
				const pty = info[1];
				pty.setMode(TerminalMode.inUse);
				pty.setName(terminalName);
				if (show) {
					terminal.show(preserveFocus);
				}
				if (header !== undefined) {
					pty.write(formatMessageForTerminal(header, true, true));
				}
				terminalsInUse.set((pty.data as Data).uuid, [terminal, pty]);
				return pty;
			}
		}

		// We haven't found an idle terminal. So create a new one;
		const pty = ServicePseudoTerminal.create<Data>(TerminalMode.inUse);
		const infoId = uuid.v4();
		const data: Data = { uuid: infoId };
		pty.data =  data;
		pty.onDidClose(() => {
			clearTerminal(pty);

		});
		const terminal = window.createTerminal({ name: terminalName, pty, isTransient: true });
		if (show) {
			terminal.show(preserveFocus);
		}
		if (header !== undefined) {
			pty.write(formatMessageForTerminal(header, false, true));
		}
		const info: TerminalInUseInfo = [terminal, pty];
		terminalsInUse.set(data.uuid, info);
		return pty;
	}

	export function releaseExecutionTerminal(pty: ServicePseudoTerminal<Data>, terminated: boolean = false): void {
		const footer = terminated
			? `Python execution got terminated. The terminal will be reused, press any key to close it.`
			: `Terminal will be reused, press any key to close it.`;
		releaseTerminal(pty, footer);
	}

	export function releaseReplTerminal(pty: ServicePseudoTerminal<Data>, terminated: boolean = false): void {
		const footer = terminated
			? `Repl execution got terminated. The terminal will be reused, press any key to close it.`
			: `Terminal will be reused, press any key to close it.`;
		releaseTerminal(pty, footer);
	}

	function releaseTerminal(pty: ServicePseudoTerminal<Data>, footer: string): void {
		const data: Data = pty.data;
		const uuid: UUID = data.uuid;
		const info = terminalsInUse.get(uuid);
		// Terminal might have gotten closed
		if (info === undefined) {
			return;
		}
		pty.setMode(TerminalMode.idle);
		pty.write(formatMessageForTerminal(footer, true, false));
		const disposable = pty.onAnyKey(() => {
			const terminal = findTerminal(pty.data.uuid);
			clearTerminal(pty);
			terminal?.dispose();
		});
		terminalsInUse.delete(uuid);
		idleTerminals.set(uuid, [info[0], info[1], disposable]);
	}

	function clearTerminal(pty: ServicePseudoTerminal): void {
		const data: Data = pty.data;
		const uuid = data.uuid;
		terminalsInUse.delete(uuid);
		idleTerminals.delete(uuid);
	}

	function findTerminal(uuid: UUID): Terminal | undefined {
		const info = idleTerminals.get(uuid) ?? terminalsInUse.get(uuid);
		return info && info[0];
	}

	function formatMessageForTerminal(message: string, leadingNewLine: boolean, trailingNewLine: boolean): string {
		return `${leadingNewLine ? '\r\n\r\n' : ''}\x1b[0m\x1b[7m * \x1b[0m ${message} \x1b[0m${trailingNewLine ? '\r\n\r\n' : ''}`;
	}
}