/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@ts-check
import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch');

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
};

/** @type BuildOptions */
const webOptions = {
	entryPoints: ['src/web/extension.ts'],
	outfile: 'dist/web/extension.js',
	format: 'cjs',
	...sharedBrowserOptions,
};

/** @type BuildOptions */
const webWorkerOptions = {
	entryPoints: ['src/web/pythonWasmWorker.ts'],
	outfile: 'dist/web/pythonWasmWorker.js',
	format: 'iife',
	...sharedBrowserOptions,
};

/** @type BuildOptions */
const sharedDesktopOptions = {
	bundle: true,
	external: ['vscode'],
	target: 'es2020',
	platform: 'node',
	sourcemap: true,
};

/** @type BuildOptions */
const desktopOptions = {
	entryPoints: ['src/desktop/extension.ts'],
	outfile: 'dist/desktop/extension.js',
	format: 'cjs',
	...sharedDesktopOptions,
};

/** @type BuildOptions */
const desktopWorkerOptions = {
	entryPoints: ['src/desktop/pythonWasmWorker.ts'],
	outfile: 'dist/desktop/pythonWasmWorker.js',
	format: 'iife',
	...sharedDesktopOptions,
};

if (watch) {
	await Promise.all([
		(await esbuild.context(webOptions)).watch(),
		(await esbuild.context(webWorkerOptions)).watch(),
		(await esbuild.context(desktopOptions)).watch(),
		(await esbuild.context(desktopWorkerOptions)).watch()
	]);
} else {
	await Promise.all([esbuild.build(webOptions), esbuild.build(webWorkerOptions), esbuild.build(desktopOptions), esbuild.build(desktopWorkerOptions)]);
}