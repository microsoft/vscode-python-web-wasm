/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@ts-check

const esbuild = require('esbuild');

let watch;
if (process.argv.includes('--watch')) {
	watch = {
		onRebuild(error, result) {
			if (error) {
				console.error(`Build failed with ${error}. Watching for file changes.`);
			} else {
				console.log(`Build successful. Watching for file changes.`);
			}
		}
		
	};
}

/**
 * @typedef {import('esbuild').BuildOptions} BuildOptions
 */

/** @type BuildOptions */
const sharedBrowserOptions = {
	bundle: true,
	external: ['vscode'],
	target: 'es2020',
	platform: 'browser',
	sourcemap: true,
	watch
};

const webExtension = esbuild.build({
	entryPoints: ['src/web/extension.ts'],
	outfile: 'dist/web/extension.js',
	format: 'cjs',
	...sharedBrowserOptions,
}).catch(console.error);

const webWorker = esbuild.build({
	entryPoints: ['src/web/pythonWasmWorker.ts'],
	outfile: 'dist/web/pythonWasmWorker.js',
	format: 'iife',
	...sharedBrowserOptions,
}).catch(console.error);

/** @type BuildOptions */
const sharedDesktopOptions = {
	bundle: true,
	external: ['vscode'],
	target: 'es2020',
	platform: 'node',
	sourcemap: true,
	watch
};

const desktopExtension = esbuild.build({
	entryPoints: ['src/desktop/extension.ts'],
	outfile: 'dist/desktop/extension.js',
	format: 'cjs',
	...sharedDesktopOptions,
}).catch(console.error);

const desktopWorker = esbuild.build({
	entryPoints: ['src/desktop/pythonWasmWorker.ts'],
	outfile: 'dist/desktop/pythonWasmWorker.js',
	format: 'iife',
	...sharedDesktopOptions,
}).catch(console.error);


Promise.all([webExtension, webWorker, desktopExtension, desktopWorker]).catch(console.error);