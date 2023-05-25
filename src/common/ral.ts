/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import type { Disposable } from 'vscode';

interface _Path {
	dirname(path: string): string;
	normalize(path: string): string;
	isAbsolute(path: string): boolean;
	join(...paths: string[]): string;
	basename(path: string, ext?: string): string;
	extname(path: string): string;
	sep: string;
	delimiter: string;
}

interface _TextEncoder {
	encode(input?: string): Uint8Array;
}

interface _TextDecoder {
	decode(input?: Uint8Array): string;
}

interface RAL {
	readonly isCrossOriginIsolated: boolean;
	readonly TextEncoder: {
		create(encoding?: string): _TextEncoder;
	};
	readonly TextDecoder: {
		create(encoding?: string): _TextDecoder;
	};
	readonly path: _Path;
	readonly console: {
	    info(message?: any, ...optionalParams: any[]): void;
	    log(message?: any, ...optionalParams: any[]): void;
	    warn(message?: any, ...optionalParams: any[]): void;
	    error(message?: any, ...optionalParams: any[]): void;
	};
	readonly timer: {
		setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): Disposable;
		setImmediate(callback: (...args: any[]) => void, ...args: any[]): Disposable;
		setInterval(callback: (...args: any[]) => void, ms: number, ...args: any[]): Disposable;
	};
}

let _ral: RAL | undefined;

function RAL(): RAL {
	if (_ral === undefined) {
		throw new Error(`No runtime abstraction layer installed`);
	}
	return _ral;
}

namespace RAL {
	export type TextEncoder = _TextEncoder;
	export type TextDecoder = _TextDecoder;
	export type Path = _Path;
	export function install(ral: RAL): void {
		if (ral === undefined) {
			throw new Error(`No runtime abstraction layer provided`);
		}
		_ral = ral;
	}
	export function isInstalled(): boolean {
		return _ral !== undefined;
	}
}

export default RAL;