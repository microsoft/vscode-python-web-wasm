/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Terminal, Uri, window } from 'vscode';

import * as uuid from 'uuid';

import { ServicePseudoTerminal } from '@vscode/sync-api-service';

export namespace Terminals {

	export type Data = [Uri, string];
	type TerminalInfo = [Terminal, ServicePseudoTerminal];

	const idleTerminals: Map<string, Map<string, TerminalInfo>> = new Map();
	const inUseTerminals: Map<string, Map<string, TerminalInfo>> = new Map();

	export function getInUseTerminal(resource: Uri, uuid: string): ServicePseudoTerminal | undefined {
		const key = resource.toString(true);
		const inUse = inUseTerminals.get(key);
		return inUse?.get(uuid)?.[1];
	}

	export function reuseOrCreateTerminal(resource: Uri, show: boolean): ServicePseudoTerminal {
		// Check if we have an idle terminal
		const key = resource.toString(true);
		const idle = idleTerminals.get(key);
		if (idle !== undefined && idle.size > 0) {
			const entry = idle.entries().next();
			if (entry.done === false) {
				const toUse = entry.value[1];
				toUse[0].show();
				return toUse[1];
			}
		}

		// We haven't found an idle terminal. So create a new one;
		const pty = ServicePseudoTerminal.create();
		const infoId = uuid.v4();
		const data: Data = [resource, infoId];
		pty.data =  data;
		pty.onDidClose(() => {
			gotClosed(pty);

		});
		const terminal = window.createTerminal({ name: '', pty, isTransient: true });
		if (show) {
			terminal.show();
		}
		terminal.sendText('Hello World');

		let infos = inUseTerminals.get(key);
		if (infos === undefined) {
			infos = new Map();
			inUseTerminals.set(key, infos);
		}
		infos.set(pty.data[1], [terminal, pty]);

		return pty;
	}

	export function unUseTerminal(pty: ServicePseudoTerminal): void {
		const data: Data = pty.data;
		const key = data[0].toString(true);
		const inUse = inUseTerminals.get(key);
		// Terminal might have gotten closed
		if (inUse === undefined) {
			return;
		}
		const info = inUse.get(data[1]);
		if (info === undefined) {
			return;
		}
		inUse.delete(data[1]);

		let idle = idleTerminals.get(key);
		if (idle === undefined) {
			idle = new Map();
			idleTerminals.set(key, idle);
		}
		idle.set(data[1], info);
	}

	function markUsed(key: string, info: TerminalInfo) {
		let inUse = inUseTerminals.get(key);
		if (inUse === undefined) {
			inUse = new Map();
		}
		inUse.set(info[1].data as string, info);
	}

	function gotClosed(pty: ServicePseudoTerminal): void {
		const data: Data = pty.data;
		const key = data[0].toString(true);
		const inUse = inUseTerminals.get(key);
		if (inUse !== undefined) {
			inUse.delete(data[1]);
			if (inUse.size === 0) {
				inUseTerminals.delete(key);
			}
		}
		const idle = idleTerminals.get(key);
		if (idle !== undefined) {
			idle.delete(data[1]);
			if (idle.size === 0) {
				idleTerminals.delete(key);
			}
		}
	}
}