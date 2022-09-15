/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference path="./typings.d.ts" />

import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

import RAL from './ral';
import { Event, Response } from './debugMessages';

export class DebugAdapter implements vscode.DebugAdapter {

	private readonly context: vscode.ExtensionContext;

	private sequenceNumber: number;
	private _sendMessage: vscode.EventEmitter<vscode.DebugProtocolMessage>;

	constructor(_vscodeSession: vscode.DebugSession, context: vscode.ExtensionContext) {
		this.context = context;
		this.sequenceNumber = 1;
		this._sendMessage = new vscode.EventEmitter();
		this.onDidSendMessage = this._sendMessage.event;
	}

	onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage>;

	handleMessage(message: DebugProtocol.ProtocolMessage): void {
		if (message.type === 'request') {
			this.handleRequest(message as DebugProtocol.Request).catch(console.error);
		}
	}

	private async handleRequest(request: DebugProtocol.Request): Promise<void> {
		switch (request.command) {
			case 'initialize':
				const result = await this.handleInitialize(request.arguments as DebugProtocol.InitializeRequestArguments);
				const response: DebugProtocol.InitializeResponse = new Response(request);
				response.body = result;
				this._sendMessage.fire(response);
				break;
			case 'launch':
				await this.handleLaunch(request.arguments as DebugProtocol.LaunchRequestArguments);
				this._sendMessage.fire(new Response(request));
				break;
			default:
				this._sendMessage.fire(new Response(request, `Unhandled request ${request.command}`));
				break;
		}
	}

	private async handleInitialize(args: DebugProtocol.InitializeRequestArguments): Promise<DebugProtocol.Capabilities> {
		return {
			supportsConfigurationDoneRequest: false,
			supportsFunctionBreakpoints: false,
			supportsConditionalBreakpoints: false,
			supportsHitConditionalBreakpoints: false,
			supportsEvaluateForHovers: false,
			supportsStepBack: false,
			supportsSetVariable: false,
			supportsRestartFrame: false,
			supportsGotoTargetsRequest: false,
			supportsStepInTargetsRequest: false,
			supportsCompletionsRequest: false,
			supportsModulesRequest: false,
			supportsRestartRequest: false,
			supportsExceptionOptions: false,
			supportsValueFormattingOptions: false,
			supportsExceptionInfoRequest: false,
			supportTerminateDebuggee: true,
			supportSuspendDebuggee: false,
			supportsDelayedStackTraceLoading: false,
			supportsLoadedSourcesRequest: false,
			supportsLogPoints: false,
			supportsTerminateThreadsRequest: false,
			supportsSetExpression: false,
			supportsTerminateRequest: true,
			supportsDataBreakpoints: false,
			supportsReadMemoryRequest: false,
			supportsWriteMemoryRequest: false,
			supportsDisassembleRequest: false,
			supportsCancelRequest: false,
			supportsBreakpointLocationsRequest: false,
			supportsClipboardContext: false,
			supportsSteppingGranularity: false,
			supportsInstructionBreakpoints: false,
			supportsExceptionFilterOptions: false,
			supportsSingleThreadExecutionRequests: false
		};
	}

	private async handleLaunch(args: DebugProtocol.LaunchRequestArguments): Promise<void> {
		const launcher = RAL().launcher.create();
		launcher.onExit().then((_rval) => {
			const terminated: DebugProtocol.TerminatedEvent = new Event('terminated', { restart: false });
			this._sendMessage.fire(terminated);
		}).catch(console.error);
		await launcher.run(this.context);
	}

	dispose() {
		throw new Error('Method not implemented.');
	}
}