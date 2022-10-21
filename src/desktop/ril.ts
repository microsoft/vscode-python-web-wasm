/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import path from 'path';

import RAL from '../common/ral';
import { Launcher } from '../common/launcher';
import { DesktopLauncher } from './launcher';
import { DesktopSpawner } from './spawner';
import { Spawner } from '../common/spawner';

const _ril: RAL = Object.freeze<RAL>({
	launcher: Object.freeze({
		create(): Launcher {
			return new DesktopLauncher();
		}
	}),
	spawner: Object.freeze({
		create(): Spawner {
			return new DesktopSpawner();
		}
	}),
	timer: Object.freeze({
		setTimeout(callback: () => void, timeoutMs: number): any {
			return setTimeout(callback,timeoutMs);
		}
	}),
	path: path.posix,
	isCrossOriginIsolated: true
});


function RIL(): RAL {
	return _ril;
}

namespace RIL {
	export function install(): void {
		RAL.install(_ril);
	}
}

export default RIL;