/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import type { IPath } from './path';
import type { Launcher } from './launcher';
interface RAL {
	readonly launcher: {
		create(): Launcher;
	}
	readonly path: IPath;
	readonly isCrossOriginIsolated: boolean;
	readonly timer: {
		setTimeout(callback: () => void, timeout: number): any;
	}
}

let _ral: RAL | undefined;

function RAL(): RAL {
	if (_ral === undefined) {
		throw new Error(`No runtime abstraction layer installed`);
	}
	return _ral;
}

namespace RAL {
	export function install(ral: RAL): void {
		if (ral === undefined) {
			throw new Error(`No runtime abstraction layer provided`);
		}
		_ral = ral;
	}
}

export default RAL;