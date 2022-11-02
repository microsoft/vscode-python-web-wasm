/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Disposable, Terminal, Uri, window } from 'vscode';

import { ServicePseudoTerminal, TerminalMode } from '@vscode/sync-api-service';
import RAL from './ral';

export namespace Terminals {

	type TerminalIdleInfo = [Terminal, ServicePseudoTerminal, Disposable];
	type TerminalInUseInfo = [Terminal, ServicePseudoTerminal];

	const idleTerminals: Map<string, TerminalIdleInfo> = new Map();
	const terminalsInUse: Map<string, TerminalInUseInfo> = new Map();

	export function getTerminalInUse(uuid: string): ServicePseudoTerminal | undefined {
		const inUse = terminalsInUse.get(uuid);
		return inUse?.[1];
	}

	export function getExecutionTerminal(resource: Uri, show: boolean): ServicePseudoTerminal {
		const fileName = RAL().path.basename(resource.toString(true));
		const terminalName = `Executing ${fileName}`;
		const header = `Executing Python file ${fileName}`;

		return getTerminal(terminalName, header, show, true);
	}

	export function getReplTerminal(show: boolean): ServicePseudoTerminal {
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
					pty.writeString(formatMessageForTerminal(header, true, true));
				}
				terminalsInUse.set(pty.id, [terminal, pty]);
				return pty;
			}
		}

		// We haven't found an idle terminal. So create a new one;
		const pty = ServicePseudoTerminal.create();
		pty.setMode(TerminalMode.inUse);
		pty.onDidClose(() => {
			clearTerminal(pty);

		});
		const terminal = window.createTerminal({ name: terminalName, pty, isTransient: true });
		if (show) {
			terminal.show(preserveFocus);
		}
		if (header !== undefined) {
			pty.writeString(formatMessageForTerminal(header, false, true));
		}
		const info: TerminalInUseInfo = [terminal, pty];
		terminalsInUse.set(pty.id, info);
		return pty;
	}

	export function releaseExecutionTerminal(pty: ServicePseudoTerminal, terminated: boolean = false): void {
		const footer = terminated
			? `Python execution got terminated. The terminal will be reused, press any key to close it.`
			: `Terminal will be reused, press any key to close it.`;
		releaseTerminal(pty, footer);
	}

	export function releaseReplTerminal(pty: ServicePseudoTerminal, terminated: boolean = false): void {
		const footer = terminated
			? `Repl execution got terminated. The terminal will be reused, press any key to close it.`
			: `Terminal will be reused, press any key to close it.`;
		releaseTerminal(pty, footer);
	}

	function releaseTerminal(pty: ServicePseudoTerminal, footer: string): void {
		const id = pty.id;
		const info = terminalsInUse.get(id);
		// Terminal might have gotten closed
		if (info === undefined) {
			return;
		}
		pty.setMode(TerminalMode.idle);
		pty.writeString(formatMessageForTerminal(footer, true, false));
		const disposable = pty.onAnyKey(() => {
			const terminal = findTerminal(pty.id);
			clearTerminal(pty);
			terminal?.dispose();
		});
		terminalsInUse.delete(id);
		idleTerminals.set(id, [info[0], info[1], disposable]);
	}

	function clearTerminal(pty: ServicePseudoTerminal): void {
		const id = pty.id;
		terminalsInUse.delete(id);
		idleTerminals.delete(id);
	}

	function findTerminal(id: string): Terminal | undefined {
		const info = idleTerminals.get(id) ?? terminalsInUse.get(id);
		return info && info[0];
	}

	function formatMessageForTerminal(message: string, leadingNewLine: boolean, trailingNewLine: boolean): string {
		return `${leadingNewLine ? '\r\n\r\n' : ''}\x1b[0m\x1b[7m * \x1b[0m ${message} \x1b[0m${trailingNewLine ? '\r\n\r\n' : ''}`;
	}
}