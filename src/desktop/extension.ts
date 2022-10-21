/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import RIL from './ril';
RIL.install();

import { activate as commonActivate, deactivate as _deactivate } from '../common/extension';
import { debug, DebugAdapterDescriptor, DebugAdapterInlineImplementation, DebugSession, ExtensionContext } from 'vscode';
import { DesktopDebugConfigurationProvider } from './debugConfigurationProvider';
import { DebugAdapter } from '../common/debugAdapter';
import RAL from '../common/ral';

class DebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly context: ExtensionContext, private readonly preloadPromise: Promise<void>) {
	}
	async createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor> {
		await this.preloadPromise;
		return new DebugAdapterInlineImplementation(new DebugAdapter(session, this.context, RAL()));
	}
}


export function activate(context: ExtensionContext) {
	const preloadPromise = commonActivate(context);

	// Setup the node debugger on desktop
	const provider = new DesktopDebugConfigurationProvider(preloadPromise);
	context.subscriptions.push(debug.registerDebugConfigurationProvider('python-pdb-node', provider));

	const factory = new DebugAdapterDescriptorFactory(context, preloadPromise);
	context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory('python-pdb-node', factory));

}
export const deactivate = _deactivate;