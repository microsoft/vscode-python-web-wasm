/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import RAL from './ral';
const path = RAL().path;

import * as sync from '@vscode/sync-api-service';

import {
	Disposable, Event, EventEmitter, FileChangeEvent, FileChangeType, FileStat, FileSystem, FileSystemError, FileSystemProvider,
	FileType, Uri
} from 'vscode';

class File implements FileStat {

	type: FileType;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	data?: Uint8Array;

	constructor(name: string) {
		this.type = FileType.File;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;
		this.name = name;
	}
}

class Directory implements FileStat {

	type: FileType;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	entries: Map<string, File | Directory>;

	constructor(name: string) {
		this.type = FileType.Directory;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;
		this.name = name;
		this.entries = new Map();
	}
}

type Entry = File | Directory;

export class MemFS implements FileSystemProvider {

	root = new Directory('');

	// --- manage file metadata

	stat(uri: Uri): FileStat {
		return this.lookup(uri, false);
	}

	readDirectory(uri: Uri): [string, FileType][] {
		const entry = this.lookupAsDirectory(uri, false);
		const result: [string, FileType][] = [];
		for (const [name, child] of entry.entries) {
			result.push([name, child.type]);
		}
		return result;
	}

	// --- manage file contents

	readFile(uri: Uri): Uint8Array {
		const data = this.lookupAsFile(uri, false).data;
		if (data) {
			return data;
		}
		throw FileSystemError.FileNotFound();
	}

	writeFile(uri: Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
		const basename = path.basename(uri.path);
		const parent = this.lookupParentDirectory(uri);
		let entry = parent.entries.get(basename);
		if (entry instanceof Directory) {
			throw FileSystemError.FileIsADirectory(uri);
		}
		if (!entry && !options.create) {
			throw FileSystemError.FileNotFound(uri);
		}
		if (entry && options.create && !options.overwrite) {
			throw FileSystemError.FileExists(uri);
		}
		if (!entry) {
			entry = new File(basename);
			parent.entries.set(basename, entry);
			this._fireSoon({ type: FileChangeType.Created, uri });
		}
		entry.mtime = Date.now();
		entry.size = content.byteLength;
		entry.data = content;

		this._fireSoon({ type: FileChangeType.Changed, uri });
	}

	// --- manage files/folders

	rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): void {

		if (!options.overwrite && this.lookup(newUri, true)) {
			throw FileSystemError.FileExists(newUri);
		}

		const entry = this.lookup(oldUri, false);
		const oldParent = this.lookupParentDirectory(oldUri);

		const newParent = this.lookupParentDirectory(newUri);
		const newName = path.basename(newUri.path);

		oldParent.entries.delete(entry.name);
		entry.name = newName;
		newParent.entries.set(newName, entry);

		this._fireSoon(
			{ type: FileChangeType.Deleted, uri: oldUri },
			{ type: FileChangeType.Created, uri: newUri }
		);
	}

	delete(uri: Uri): void {
		const dirname = uri.with({ path: path.dirname(uri.path) });
		const basename = path.basename(uri.path);
		const parent = this.lookupAsDirectory(dirname, false);
		if (!parent.entries.has(basename)) {
			throw FileSystemError.FileNotFound(uri);
		}
		parent.entries.delete(basename);
		parent.mtime = Date.now();
		parent.size -= 1;
		this._fireSoon({ type: FileChangeType.Changed, uri: dirname }, { uri, type: FileChangeType.Deleted });
	}

	createDirectory(uri: Uri): void {
		const basename = path.basename(uri.path);
		const dirname = uri.with({ path: path.dirname(uri.path) });
		const parent = this.lookupAsDirectory(dirname, false);

		const entry = new Directory(basename);
		parent.entries.set(entry.name, entry);
		parent.mtime = Date.now();
		parent.size += 1;
		this._fireSoon({ type: FileChangeType.Changed, uri: dirname }, { type: FileChangeType.Created, uri });
	}

	// --- lookup

	private lookup(uri: Uri, silent: false): Entry;
	private lookup(uri: Uri, silent: boolean): Entry | undefined;
	private lookup(uri: Uri, silent: boolean): Entry | undefined {
		const parts = uri.path.split('/');
		let entry: Entry = this.root;
		for (const part of parts) {
			if (!part) {
				continue;
			}
			let child: Entry | undefined;
			if (entry instanceof Directory) {
				child = entry.entries.get(part);
			}
			if (!child) {
				if (!silent) {
					throw FileSystemError.FileNotFound(uri);
				} else {
					return undefined;
				}
			}
			entry = child;
		}
		return entry;
	}

	private lookupAsDirectory(uri: Uri, silent: boolean): Directory {
		const entry = this.lookup(uri, silent);
		if (entry instanceof Directory) {
			return entry;
		}
		throw FileSystemError.FileNotADirectory(uri);
	}

	private lookupAsFile(uri: Uri, silent: boolean): File {
		const entry = this.lookup(uri, silent);
		if (entry instanceof File) {
			return entry;
		}
		throw FileSystemError.FileIsADirectory(uri);
	}

	private lookupParentDirectory(uri: Uri): Directory {
		const dirname = uri.with({ path: path.dirname(uri.path) });
		return this.lookupAsDirectory(dirname, false);
	}

	// --- manage file events

	private emitter = new EventEmitter<FileChangeEvent[]>();
	private bufferedEvents: FileChangeEvent[] = [];
	private fireSoonHandle: Disposable | undefined;

	readonly onDidChangeFile: Event<FileChangeEvent[]> = this.emitter.event;

	watch(_resource: Uri): Disposable {
		// ignore, fires for all changes...
		return new Disposable(() => { });
	}

	private _fireSoon(...events: FileChangeEvent[]): void {
		this.bufferedEvents.push(...events);

		if (this.fireSoonHandle) {
			this.fireSoonHandle.dispose();
			this.fireSoonHandle = undefined;
		}

		this.fireSoonHandle = sync.RAL().timer.setTimeout(() => {
			this.emitter.fire(this.bufferedEvents);
			this.bufferedEvents.length = 0;
		}, 5);
	}
}


class DebugFileSystem extends MemFS {
	public static scheme = 'python-wasm-pdb' as const;

	public addSession(uuid: string): void {
		this.createDirectory()
	}
}