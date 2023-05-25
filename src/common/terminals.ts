/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as uuid from 'uuid';

import { Disposable, Terminal, Uri, window } from 'vscode';

import { WasmPseudoterminal, Wasm, PseudoterminalState } from '@vscode/wasm-wasi';

import RAL from './ral';

export namespace Terminals {

	type TerminalFreeInfo = [Terminal, WasmPseudoterminal, string, Disposable];
	type TerminalBusyInfo = [Terminal, WasmPseudoterminal, string];

	const freeTerminals: Map<WasmPseudoterminal, TerminalFreeInfo> = new Map();
	const busyTerminals: Map<WasmPseudoterminal, TerminalBusyInfo> = new Map();

	export function getTerminalHandle(terminal: WasmPseudoterminal): string | undefined {
		for (const free of freeTerminals.values()) {
			if (free[1] === terminal) {
				return free[2];
			}
		}
		for (const busy of busyTerminals.values()) {
			if (busy[1] === terminal) {
				return busy[2];
			}
		}
		return undefined;
	}

	export function getBusyTerminal(uuid: string): WasmPseudoterminal | undefined {
		for (const busy of busyTerminals.values()) {
			if (busy[2] === uuid) {
				return busy[1];
			}
		}
		return undefined;
	}

	export function getExecutionTerminal(resource: Uri, show: boolean): WasmPseudoterminal {
		const fileName = RAL().path.basename(resource.toString(true));
		const terminalName = `Executing ${fileName}`;
		const header = `Executing Python file ${fileName}`;

		return getTerminal(terminalName, header, show, true);
	}

	export function getReplTerminal(show: boolean): WasmPseudoterminal {
		const terminalName = `Python REPL`;
		const header = `Running Python REPL`;
		return getTerminal(terminalName, header, show, false);
	}

	function getTerminal(terminalName: string, header: string | undefined, show: boolean, preserveFocus: boolean) {
		// Check if we have an idle terminal
		if (freeTerminals.size > 0) {
			const entry = freeTerminals.entries().next();
			if (entry.done === false) {
				freeTerminals.delete(entry.value[0]);
				const info = entry.value[1];
				info[3].dispose();
				const terminal = info[0];
				const pty = info[1];
				const uuid = info[2];
				pty.setState(PseudoterminalState.busy);
				pty.setName(terminalName);
				if (show) {
					terminal.show(preserveFocus);
				}
				if (header !== undefined) {
					void pty.write(formatMessageForTerminal(header, true, true));
				}
				busyTerminals.set(pty, [terminal, pty, uuid]);
				return pty;
			}
		}

		// We haven't found an idle terminal. So create a new one;
		const pty = Wasm.api().createPseudoterminal();
		pty.setState(PseudoterminalState.busy);
		pty.onDidCloseTerminal(() => {
			clearTerminal(pty);
		});
		const terminal = window.createTerminal({ name: terminalName, pty, isTransient: true });
		if (show) {
			terminal.show(preserveFocus);
		}
		if (header !== undefined) {
			pty.write(formatMessageForTerminal(header, false, true));
		}
		const info: TerminalBusyInfo = [terminal, pty, uuid.v4()];
		busyTerminals.set(pty, info);
		return pty;
	}

	export function releaseExecutionTerminal(pty: WasmPseudoterminal, terminated: boolean = false): void {
		const footer = terminated
			? `Python execution got terminated. The terminal will be reused, press any key to close it.`
			: `Terminal will be reused, press any key to close it.`;
		releaseTerminal(pty, footer);
	}

	export function releaseReplTerminal(pty: WasmPseudoterminal, terminated: boolean = false): void {
		const footer = terminated
			? `Repl execution got terminated. The terminal will be reused, press any key to close it.`
			: `Terminal will be reused, press any key to close it.`;
		releaseTerminal(pty, footer);
	}

	function releaseTerminal(pty: WasmPseudoterminal, footer: string): void {
		const info = busyTerminals.get(pty);
		// Terminal might have gotten closed
		if (info === undefined) {
			return;
		}
		pty.setState(PseudoterminalState.free);
		void pty.write(formatMessageForTerminal(footer, true, false));
		const disposable = pty.onAnyKey(() => {
			const terminal = findTerminal(pty);
			clearTerminal(pty);
			terminal?.dispose();
		});
		busyTerminals.delete(pty);
		freeTerminals.set(pty, [info[0], info[1], info[2], disposable]);
	}

	function clearTerminal(pty: WasmPseudoterminal): void {
		busyTerminals.delete(pty);
		freeTerminals.delete(pty);
	}

	function findTerminal(pty: WasmPseudoterminal): Terminal | undefined {
		const info = freeTerminals.get(pty) ?? busyTerminals.get(pty);
		return info && info[0];
	}

	function formatMessageForTerminal(message: string, leadingNewLine: boolean, trailingNewLine: boolean): string {
		return `${leadingNewLine ? '\r\n\r\n' : ''}\x1b[0m\x1b[7m * \x1b[0m ${message} \x1b[0m${trailingNewLine ? '\r\n\r\n' : ''}`;
	}
}