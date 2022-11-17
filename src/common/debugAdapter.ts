/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference path="./typings.d.ts" />

import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import { ServicePseudoTerminal, RAL as SyncRal, TerminalMode } from '@vscode/sync-api-service';
import RAL from './ral';
import { Response } from './debugMessages';
import { Launcher } from './launcher';
import { Terminals } from './terminals';
import { DebugCharacterDeviceDriver } from './debugCharacterDeviceDriver';

const StackFrameRegex = /^[>,\s]+(.+)\((\d+)\)(.*)\(\)/;
const ScrapeDirOutputRegex = /\[(.*)\]/;
const BreakpointRegex = /Breakpoint (\d+) at (.+):(\d+)/;
const PossibleStepExceptionRegex = /^\w+:\s+.*\r*\n>/;
const PrintExceptionMessage = `debug_pdb_print_exc_message`;
const SetupExceptionMessage = `alias debug_pdb_print_exc_message !import sys; print(sys.exc_info()[1])`;
const PrintExceptionTraceback = `debug_pdb_print_exc_traceback`;
const SetupExceptionTraceback = `alias debug_pdb_print_exc_traceback !import traceback; import sys; traceback.print_exception(*sys.exc_info())`;
const PdbTerminator = `(Pdb) `;

export class DebugAdapter implements vscode.DebugAdapter {
	private _launcher: Launcher | undefined;
	private _debuggerDriver: DebugCharacterDeviceDriver | undefined;
	private _terminal: ServicePseudoTerminal | undefined;
	private _cwd: string | undefined;
	private _sequence = 0;
	private _outputChain: Promise<string> | undefined;
	private _stopped = true;
	private _stopOnEntry = false;
	private _currentFrame = 1;
	private _disposed = false;
	private _uncaughtException = false;
	private _workspaceFolder: vscode.WorkspaceFolder | undefined;
	private _boundBreakpoints: DebugProtocol.Breakpoint[] = [];
	private _didSendMessageEmitter: vscode.EventEmitter<DebugProtocol.Response | DebugProtocol.Event> =
		new vscode.EventEmitter<DebugProtocol.Response | DebugProtocol.Event>();
	
	private _encoder: SyncRal.TextEncoder = SyncRal().TextEncoder.create();
	private _decoder: SyncRal.TextDecoder = SyncRal().TextDecoder.create();
		
	constructor(
		readonly session: vscode.DebugSession,
		readonly context: vscode.ExtensionContext,
		private readonly _ral: RAL
	) {
		this._stopOnEntry = session.configuration.stopOnEntry;
		this._workspaceFolder = session.workspaceFolder ||
			(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined);
		this._cwd = session.configuration.cwd || this._workspaceFolder;
	}
	get onDidSendMessage(): vscode.Event<DebugProtocol.ProtocolMessage> {
		return this._didSendMessageEmitter.event;
	}
	handleMessage(message: DebugProtocol.ProtocolMessage): void {
		if (message.type === 'request') {
			this._handleRequest(message as DebugProtocol.Request);
		}
	}
	dispose() {
		// Hack, readlinecallback needs to be reset. We likely have an outstanding promise
		if (!this._disposed) {
			this._disposed = true;
			this._terminal?.handleInput!('\r');
			(this._terminal as any).lines.clear();
			this._terminal?.setMode(TerminalMode.idle);
		}
	}

	private _handleRequest(message: DebugProtocol.Request) {
		switch (message.command) {
			case 'launch':
				void this._handleLaunch(message as DebugProtocol.LaunchRequest);
				break;

			case 'disconnect':
				this._handleDisconnect(message as DebugProtocol.DisconnectRequest);

			case 'initialize':
				this._handleInitialize(message as DebugProtocol.InitializeRequest);
				break;

			case 'threads':
				this._handleThreads(message as DebugProtocol.ThreadsRequest);
				break;

			case 'stackTrace':
				void this._handleStackTrace(message as DebugProtocol.StackTraceRequest);
				break;

			case 'scopes':
				void this._handleScopesRequest(message as DebugProtocol.ScopesRequest);
				break;

			case 'variables':
				void this._handleVariablesRequest(message as DebugProtocol.VariablesRequest);
				break;

			case 'setBreakpoints':
				void this._handleSetBreakpointsRequest(message as DebugProtocol.SetBreakpointsRequest);
				break;

			case 'configurationDone':
				this._handleConfigurationDone(message as DebugProtocol.ConfigurationDoneRequest);
				break;

			case 'continue':
				this._handleContinue(message as DebugProtocol.ContinueRequest);
				break;
				
			case 'terminate':
				this._handleTerminate(message as DebugProtocol.TerminateRequest);
				break;

			case 'next':
				void this._handleNext(message as DebugProtocol.NextRequest);
				break;

			case 'stepIn':
				void this._handleStepIn(message as DebugProtocol.StepInRequest);
				break;

			case 'stepOut':
				void this._handleStepOut(message as DebugProtocol.StepOutRequest);
				break;

			case 'evaluate':
				void this._handleEvaluate(message as DebugProtocol.EvaluateRequest);
				break;

			case 'exceptionInfo':
				void this._handleExceptionInfo(message as DebugProtocol.ExceptionInfoRequest);
				break;

			default:
				this._sendResponse(new Response(message, `Unhandled request ${message.command}`));
				break;
		}
	}

	private _sendResponse<T extends DebugProtocol.Response>(response: T) {
		this._sequence += 1;
		this._didSendMessageEmitter.fire({...response, seq: this._sequence});
	}

	private _sendEvent<T extends DebugProtocol.Event>(event: T) {
		this._sequence += 1;
		this._didSendMessageEmitter.fire({...event, seq: this._sequence});
	}

	private _sendStoppedEvent(reason: string, breakpointHit?: DebugProtocol.Breakpoint, text?: string) {
		if (breakpointHit && breakpointHit.id) {
			this._sendEvent<DebugProtocol.StoppedEvent>({
				type: 'event',
				seq: 1,
				event: 'stopped',
				body: {
					reason: 'breakpoint',
					threadId: 1,
					allThreadsStopped: true,
					hitBreakpointIds: [breakpointHit.id]
				}
			});
		} else {
			this._sendEvent<DebugProtocol.StoppedEvent>({
				type: 'event',
				seq: 1,
				event: 'stopped',
				body: {
					reason,
					threadId: 1,
					allThreadsStopped: true,
					text
				}
			});
		}
	}

	private _terminate() {
		if (this._launcher) {
			this._writetostdin('exit\n');
			const launcher = this._launcher;
			this._launcher = undefined;
			void launcher.terminate();
		}
	}

	private _handleDisconnect(message: DebugProtocol.DisconnectRequest) {
		this._terminate();
		this._sendToUserConsole(`Process exited.`);
		this._sendResponse<DebugProtocol.DisconnectResponse>({
			type: 'response',
			request_seq: message.seq,
			success: true,
			command: message.command,
			seq: 1,
		});
	}

	private _handleInitialize(message: DebugProtocol.InitializeRequest) {
		// Send back the initialize response
		this._sendResponse<DebugProtocol.InitializeResponse>({
			type: 'response',
			request_seq: message.seq,
			success: true,
			command: message.command,
			seq: 1,
			body: {
				supportsConditionalBreakpoints: true,
				supportsConfigurationDoneRequest: true,
				supportsSteppingGranularity: true,
				supportsTerminateRequest: true,
				supportsExceptionInfoRequest: true
			}
		});

		// Send back the initialized event to indicate ready to receive breakpoint requests
		this._sendEvent<DebugProtocol.InitializedEvent>({
			type: 'event',
			event: 'initialized',
			seq: 1
		});
	}

	private _handleThreads(message: DebugProtocol.ThreadsRequest) {
		// PDB doesn't handle threads, (see https://github.com/python/cpython/issues/85743)
		// Just respond with a single thread
		this._sendResponse<DebugProtocol.ThreadsResponse>({
			type: 'response',
			request_seq: message.seq,
			success: true,
			command: message.command,
			seq: 1,
			body: {
				threads: [
					{
						id: 1,
						name: 'Main Thread'
					}
				]
			}
		});
	}

	private _waitForPdbOutput(mode: 'run' | 'command', generator: () => void): Promise<string> {
		const current = this._outputChain ?? Promise.resolve('');
		this._outputChain = current.then(() => {
			return new Promise<string>((resolve, reject) => {
				let output = '';
				const disposable = this._debuggerDriver?.output((str) => {
					// In command mode, remove carriage returns. Makes handling simpler
					str = mode === 'command' ? str.replace(/\r/g, '') : str;

					// We are finished when the output ends with `(Pdb) `
					if (str.endsWith(PdbTerminator)) {
						disposable?.dispose();
						output = `${output}${str.slice(0, str.length - PdbTerminator.length)}`;
						this._stopped = true;
						resolve(output);
					} else if (mode === 'run') {
						// In run mode, send to console
						this._sendToUserConsole(str);
					} else {
						// In command mode, save
						output = `${output}${str}`;
					}
				});
				this._stopped = false;
				generator();
			});
		});
		return this._outputChain;
	}

	private _translateToWorkspacePath(wasmPath: string) {
		const normalized = wasmPath.replace(/\\/g, '/');
		if (normalized.startsWith('/workspace/') && this._workspaceFolder) {
			const root = this._workspaceFolder.uri.fsPath.replace(/\\/g, '/');
			// Wasm path, translate to workspace path
			return `${root}/${normalized.slice('/workspace/'.length)}`;
		}
		return normalized;
	}

	private _translateFromWorkspacePath(workspacePath: string) {
		const normalized = workspacePath.replace(/\\/g, '/');
		const root = this._workspaceFolder?.uri.fsPath.replace(/\\/g, '/');
		if (root && normalized.startsWith(root)) {
			// workspace path, translate to workspace path
			return `/workspace${normalized.slice(root.length)}`;
		}
		return normalized;
	}

	private _parseStackFrames(frames: string): DebugProtocol.StackFrame[] {
		let result: DebugProtocol.StackFrame[] = [];

		// Split frames into lines
		const lines = frames.replace(/\r/g, '').split('\n');

		// Go through each line and return frames that are user code
		lines.forEach((line, index) => {
			const frameParts = StackFrameRegex.exec(line);
			if (frameParts) {
				const sepIndex = frameParts[1].replace(/\\/g, '/').lastIndexOf('/');
				const name = sepIndex >= 0 ? frameParts[1].slice(sepIndex) : frameParts[1];
				const translatedPath = this._translateToWorkspacePath(frameParts[1]);
				// Insert at the front so last frame is on front of list
				result.splice(0, 0, {
					id: result.length+1,
					source: {
						name,
						path: translatedPath,
						sourceReference: 0 // Don't retrieve source from pdb
					},
					name: frameParts[3],
					line: parseInt(frameParts[2]),
					column: 0
				});
			}
		});

		// Reverse the ids
		result = result.map((v, i) => {
			return {
				...v,
				id: i + 1,
			};
		});
		return result;
	}

	private async _handleStackTrace(message: DebugProtocol.StackTraceRequest) {
		// Ask PDB for the current frame
		const frames = await this._executecommand('where');

		// Parse the frames
		const stackFrames = this._parseStackFrames(frames)
			.filter(f => f.source?.path && this._isMyCode(f.source?.path));

		// Return the stack trace
		this._sendResponse<DebugProtocol.StackTraceResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				totalFrames: stackFrames.length,
				stackFrames
			}
		});
	}

	private async _handleScopesRequest(message: DebugProtocol.ScopesRequest) {
		// When the scopes request comes in, it has the frame that is being requested
		// If not the same as our current frame, move up or down
		await this._switchCurrentFrame(message.arguments.frameId);

		// For now have just a single scope all the time. PDB doesn't
		// really have a way other than asking for 'locals()' or 'globals()'
		// but then we have to figure out the difference.
		this._sendResponse<DebugProtocol.ScopesResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				scopes: [
					{
						name: 'locals',
						variablesReference: 1,
						expensive: false
					}
				]
			}
		});
	}

	private async _handleVariablesRequest(message: DebugProtocol.VariablesRequest) {
		// Use the dir() python command to get back the list of current variables
		const dir = await this._executecommand('dir()');
		const scrapedDir = ScrapeDirOutputRegex.exec(dir);

		// Go backwards through this list until we get something that starts without
		// a double underscore
		const entries = scrapedDir
			? scrapedDir[1].split(',')
				.map(s => s.trim())
				.map(s => s.slice(1, s.length-1))
				.filter(e => !e.startsWith('__') || e === '__file__')
			: [];

		// For each entry we need to make a request to pdb to get its value. This might take a while
		// TODO: Handle limits here
		const variables = await Promise.all(entries.map(async (e) => {
			const value = await this._executecommand(`p ${e}`);
			const result: DebugProtocol.Variable = {
				name: e,
				value,
				variablesReference: 0
			};
			return result;
		}));

		this._sendResponse<DebugProtocol.VariablesResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				variables
			}
		});
	}

	private _handleConfigurationDone(message: DebugProtocol.ConfigurationDoneRequest) {
		this._sendResponse<DebugProtocol.ConfigurationDoneResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
		});

		if (this._stopOnEntry) {
			// Send back the stopped location. This should cause
			// VS code to ask for the stack frame
			this._sendStoppedEvent('entry');
		} else if (this._stopped) {
			// Not stopping, tell pdb to continue. We should have
			// gotten any breakpoint requests already
			void this._continue();
		}
	}

	private _sendTerminated() {
		this._terminate();
		this._sendEvent<DebugProtocol.TerminatedEvent>({
			type: 'event',
			event: 'terminated',
			seq: 1,
		});
	}

	private _handleTerminate(message: DebugProtocol.TerminateRequest) {
		this._sendTerminated();
		this._sendResponse<DebugProtocol.TerminateResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
		});
	}

	private async _handleSetBreakpointsRequest(message: DebugProtocol.SetBreakpointsRequest) {
		const results: DebugProtocol.Breakpoint[] = [];

		// If there is a source file, clear all breakpoints in this source
		if (message.arguments.source.path) {
			const numbers = this._boundBreakpoints
				.filter(b => b.source?.path === message.arguments.source.path)
				.map(b => b.id);
			if (numbers.length) {
				await this._executecommand(`cl ${numbers.join(' ')}`);
				this._boundBreakpoints = this._boundBreakpoints
					.filter(b => b.source?.path !== message.arguments.source.path);
			}
		}

		// Use the 'b' command to create breakpoints
		if (message.arguments.breakpoints) {
			await Promise.all(message.arguments.breakpoints.map(async (b) => {
				const wasmPath = this._translateFromWorkspacePath(message.arguments.source.path || '');
				const result = await this._executecommand(`b ${wasmPath}:${b.line}`);
				const parsed = BreakpointRegex.exec(result);
				if (parsed) {
					const breakpoint: DebugProtocol.Breakpoint = {
						id: parseInt(parsed[1]),
						line: parseInt(parsed[3]),
						source: {
							path: this._translateToWorkspacePath(parsed[2])
						},
						verified: true
					};
					this._boundBreakpoints.push(breakpoint);
					results.push(breakpoint);
				}
			}));
		}

		this._sendResponse<DebugProtocol.SetBreakpointsResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				breakpoints: results
			}
		});
	}

	private _isMyCode(file: string): boolean {
		// Determine if this file is in the current workspace or not
		if (file.startsWith('/workspace')) {
			return true;
		}else if (this._workspaceFolder) {
			const root = this._workspaceFolder.uri.fsPath.toLowerCase().replace(/\\/g, '/');
			return file.toLowerCase().startsWith(root);
		} else {
			// Otherwise no workspace folder and just a loose file. Use the starting file
			const root = this._cwd?.toLowerCase().replace(/\\/g, '/');
			return root ? file.toLowerCase().startsWith(root) : false;
		}
	}

	private _handleProgramFinished(output: string) {
		const finishedIndex = output.indexOf('The program finished and will be restarted');
		if (finishedIndex >= 0) {
			this._sendToUserConsole(output.slice(0, finishedIndex));
		}
		// Program finished. Disconnect
		this._sendTerminated();
	}

	private async _handleUncaughtException(output: string) {
		const uncaughtIndex = output.indexOf('Uncaught exception. Entering post mortem debugging');
		if (uncaughtIndex >= 0) {
			this._sendToUserConsole(output.slice(0, uncaughtIndex));
		}

		// Uncaught exception. Don't let any run commands be executed
		this._uncaughtException = true;

		// Combine the two
		this._sendStoppedEvent('exception');
	}

	private _handleFunctionReturn(output: string) {
		const returnIndex = output.indexOf('--Return--');
		if (returnIndex > 0) {
			this._sendToUserConsole(output.slice(0, returnIndex));
		}
		return this._executerun('s');
	}

	private _handleFunctionCall(output:string) {
		const callIndex = output.indexOf('--Call--');
		if (callIndex > 0) {
			this._sendToUserConsole(output.slice(0, callIndex));
		}
		return this._executerun('s');
	}

	private async _handleStopped(lastCommand: string, output: string) {
		// Check for the step case where the step printed out an exception
		// We don't want the exception to print out. If we were
		// trying to catch caught exceptions, then maybe, but for now it
		// is inconsistent with the behavior of continue.
		if (lastCommand !== 'c' && PossibleStepExceptionRegex.test(output)) {
			return this._executerun('s');
		}
		// Filter out non 'frame' output. Send it to the output as
		// it should be output from the process.
		let nonFrameIndex = output.indexOf('\n> ');
		if (nonFrameIndex >= 0) {
			this._sendToUserConsole(output.slice(0, nonFrameIndex+1));
			output = output.slice(nonFrameIndex);
		}

		// Parse the output. It should have the frames in it
		const frames = this._parseStackFrames(output);

		// The topmost frame needs to be 'my code' or we should step out of the current
		// frame
		if (frames.length > 0 && !this._isMyCode(frames[0].source!.path!)) {
			return this._stepOutOf();
		}

		// Otherwise we stopped. See if this location matches one of
		// our current breakpoints
		const match = frames.length > 0 ? this._boundBreakpoints.find(
			b => b.line === frames[0].line && b.source?.path === frames[0].source?.path) : undefined;
		this._sendStoppedEvent('step', match);
	}

	private async _switchCurrentFrame(newFrame: number) {
		if (this._currentFrame !== newFrame) {
			const count = newFrame - this._currentFrame;
			const frameCommand = count > 0 ? 'u' : 'd';
			await this._executecommand(`${frameCommand} ${Math.abs(count)}`);
			this._currentFrame = newFrame;
		}
	}

	private _executerun(runcommand: string) {
		// If at an unhandled exception, just terminate (user hit go after the exception happened)
		if (this._uncaughtException) {
			this._sendTerminated();
			return;
		}

		// To prevent a large recursive chain, execute the rest of this in a timeout
		this._ral.timer.setTimeout(async () => {
			// If the current frame isn't the topmost, force it to the topmost.
			// This is how debugpy works. It always steps the topmost frame
			await this._switchCurrentFrame(1);

			// Then execute our run command
			const output = await this._waitForPdbOutput('run', () => this._writetostdin(`${runcommand}\n`));

			// We should be stopped now. Depends upon why
			if (output.includes('The program finished and will be restarted')) {
				this._handleProgramFinished(output);
			} else if (output.includes('Uncaught exception. Entering post mortem debugging')) {
				await this._handleUncaughtException(output);
			} else if (output.includes('--Return--')) {
				await this._handleFunctionReturn(output);
			} else if (output.includes('--Call--')) {
				await this._handleFunctionCall(output);
			} else {
				await this._handleStopped(runcommand, output);
			}
		}, 1);
	}
	private async _continue() {
		// see https://docs.python.org/3/library/pdb.html#pdbcommand-continue
		// Send a continue command. Waiting for the first output.
		return this._executerun('c');
	}

	private async _handleLaunch(message: DebugProtocol.LaunchRequest): Promise<void> {
		if (this._launcher !== undefined) {
			return;
		}
		const args: DebugProtocol.LaunchRequestArguments & { program: string, ptyInfo: { uuid: string } } = message.arguments as any;
		const uuid = args.ptyInfo.uuid;
		this._terminal = Terminals.getTerminalInUse(uuid)!;
		this._launcher = RAL().launcher.create();
		this._launcher.onExit().then((_rval) => {
			this._launcher = undefined;
			this._sendTerminated();
		}).catch(e => {
			console.error(e);
			this._launcher = undefined;
			this._sendTerminated();
		});
		this._debuggerDriver = new DebugCharacterDeviceDriver();

		// Wait for debuggee to emit first bit of output before continuing
		await this._waitForPdbOutput('command', () => {
			return this._launcher!.debug(this.context, args.program.replace(/\\/g, '/'), this._terminal!, this._debuggerDriver!, PdbTerminator);
		});

		// Setup an alias for printing exc info
		await this._executecommand(SetupExceptionMessage);
		await this._executecommand(SetupExceptionTraceback);

		// Send a message to the debug console to indicate started debugging
		this._sendToDebugConsole(`PDB debugger connected.\r\n`);

		// PDB should have stopped at the entry point and printed out the first line

		// Start listening for user input
		this._terminal.setMode(TerminalMode.inUse);

		// Send back the response
		this._sendResponse<DebugProtocol.LaunchResponse>({
			type: 'response',
			request_seq: message.seq,
			success: !!this._launcher,
			command: message.command,
			seq: 1
		});

	}

	private async _stepInto() {
		// see https://docs.python.org/3/library/pdb.html#pdbcommand-step
		return this._executerun('s');
	}

	private async _stepOver() {
		// see https://docs.python.org/3/library/pdb.html#pdbcommand-next
		return this._executerun('n');
	}

	private async _stepOutOf() {
		// see https://docs.python.org/3/library/pdb.html#pdbcommand-return
		return this._executerun('r');
	}

	private _handleContinue(message: DebugProtocol.ContinueRequest) {
		this._sendResponse<DebugProtocol.ContinueResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				allThreadsContinued: true
			}
		});
		void this._continue();
	}

	private _handleNext(message: DebugProtocol.NextRequest) {
		this._sendResponse<DebugProtocol.NextResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				allThreadsContinued: true
			}
		});
		void this._stepOver();
	}

	private _handleStepIn(message: DebugProtocol.StepInRequest) {
		this._sendResponse<DebugProtocol.StepInResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				allThreadsContinued: true
			}
		});
		void this._stepInto();
	}

	private _handleStepOut(message: DebugProtocol.StepOutRequest) {
		this._sendResponse<DebugProtocol.StepOutResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				allThreadsContinued: true
			}
		});
		void this._stepOutOf();
	}

	private async _handleEvaluate(message: DebugProtocol.EvaluateRequest) {
		// Might have to switch frames
		const startingFrame = this._currentFrame;
		if (message.arguments.frameId && message.arguments.frameId !== this._currentFrame) {
			await this._switchCurrentFrame(message.arguments.frameId);
		}

		// Special case `print(` to just call print. Otherwise we get
		// the return value of 'None' in the output, and it's unlikely the user
		// wanted that
		const command = message.arguments.expression.startsWith(`print(`)
			? message.arguments.expression
			: `p ${message.arguments.expression}`;
		const output = await this._executecommand(command);

		// Switch back to the starting frame if necessary
		if (this._currentFrame !== startingFrame) {
			await this._switchCurrentFrame(startingFrame);
		}

		// Send the response with our result
		this._sendResponse<DebugProtocol.EvaluateResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				result: output,
				variablesReference: 0
			}
		});
	}

	private async _handleExceptionInfo(message: DebugProtocol.ExceptionInfoRequest) {
		// Get the current exception traceback
		const msg = await this._executecommand(PrintExceptionMessage);
		const traceback = await this._executecommand(PrintExceptionTraceback);

		// Turn it into something VS code understands
		this._sendResponse<DebugProtocol.ExceptionInfoResponse>({
			success: true,
			command: message.command,
			type: 'response',
			seq: 1,
			request_seq: message.seq,
			body: {
				exceptionId: msg,
				breakMode: this._uncaughtException ? 'unhandled' : 'userUnhandled',
				details: {
					stackTrace: traceback
				}
			}
		});

	}

	private _writetostdin(text: string) {
		void this._debuggerDriver?.input(text);
	}

	private async _executecommand(command: string): Promise<string> {
		if (!this._stopped && this._outputChain) {
			// If we're not currently stopped, then we must be waiting for output
			await this._outputChain;
		}

		// Send a 'command' to pdb
		return this._waitForPdbOutput('command', () => this._writetostdin(`${command}\n`));
	}

	private _sendToUserConsole(data: string) {
		this._terminal?.writeString(data);
	}

	private _sendToDebugConsole(data: string) {
		this._sendEvent<DebugProtocol.OutputEvent>({
			type: 'event',
			seq: 1,
			event: 'output',
			body: {
				output: data
			}
		});
	}
}

