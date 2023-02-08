/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vscode-uri';

import {
	ApiClient, BaseFileDescriptor, BigInts, DeviceIds, Errno, fd, fdflags, fdstat, FileDescriptor, filestat, FileSystemDeviceDriver, Filetype, filetype,
	lookupflags, NoSysDeviceDriver, oflags, RAL, Rights, rights, size, WasiError, Whence, VSCodeFS, ApiShape
} from '@vscode/wasm-wasi';

class DebugFileDescriptor extends BaseFileDescriptor {

	constructor(deviceId: bigint, fd: fd, filetype: filetype, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint) {
		super(deviceId, fd, filetype, rights_base, rights_inheriting, fdflags, inode);
	}
}

class DebugCharacterDeviceFD extends DebugFileDescriptor {

	constructor(deviceId: bigint, fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint) {
		super(deviceId, fd, Filetype.character_device, rights_base, rights_inheriting, fdflags, inode);
	}
}

class DebugDirectoryFD extends DebugFileDescriptor {

	constructor(deviceId: bigint, fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint) {
		super(deviceId, fd, Filetype.directory, rights_base, rights_inheriting, fdflags, inode);
	}
}

class DebugFileFD extends DebugFileDescriptor {

	public cursor: number;

	constructor(deviceId: bigint, fd: fd, rights_base: rights, rights_inheriting: rights, fdflags: fdflags, inode: bigint) {
		super(deviceId, fd, Filetype.regular_file, rights_base, rights_inheriting, fdflags, inode);
		this.cursor = 0;
	}
}

export function create(apiClient: ApiShape, textEncoder: RAL.TextEncoder, fileDescriptorId: { next(): number }, posix_path: { readonly join: (...paths: string[]) => string, readonly sep: string }, uri: URI, mainContent: string): FileSystemDeviceDriver {

	const mainContentBytes = textEncoder.encode(mainContent);
	const deviceId = DeviceIds.next();
	const preOpenDirectories: string[] = ['/$debug'];

	let _root: DebugDirectoryFD | undefined;
	function rootFd(fd?: fd): DebugDirectoryFD {
		if (_root === undefined) {
			if (fd === undefined) {
				throw new WasiError(Errno.inval);
			}
			_root = new DebugDirectoryFD(deviceId, fd, VSCodeFS.DirectoryRights.base, VSCodeFS.DirectoryRights.inheriting, 0, 0n);
		}
		return _root;
	}

	let _main: DebugFileFD | undefined;
	function mainFd(): DebugFileFD {
		if (_main === undefined) {
			_main = new DebugFileFD(deviceId, fileDescriptorId.next(), VSCodeFS.FileRights.base, VSCodeFS.FileRights.inheriting, 0, 1n);
		}
		return _main;
	}

	let _input: DebugCharacterDeviceFD | undefined;
	const InputRights = Rights.fd_read | Rights.fd_filestat_get| Rights.poll_fd_readwrite;
	function inputFd(): DebugCharacterDeviceFD {
		if (_input === undefined) {
			_input = new DebugCharacterDeviceFD(deviceId, fileDescriptorId.next(), InputRights, Rights.None, 0, 2n);
		}
		return _input;
	}

	let _output: DebugCharacterDeviceFD | undefined;
	const OutputRights = Rights.fd_write | Rights.fd_filestat_get | Rights.poll_fd_readwrite;
	function outputFd(): DebugCharacterDeviceFD {
		if (_output === undefined) {
			_output = new DebugCharacterDeviceFD(deviceId, fileDescriptorId.next(), OutputRights, Rights.None, 0, 3n);
		}
		return _output;
	}

	function getFileDescriptor(path: string): DebugFileDescriptor {
		switch (path) {
			case '/':
				return rootFd();
			case '/main.py':
				return mainFd();
			case '/input':
				return inputFd();
			case '/output':
				return outputFd();
			default:
				throw new WasiError(Errno.noent);
		}
	}
	function assertDebugFileDescriptor(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugFileDescriptor {
		if (!(fileDescriptor instanceof DebugFileDescriptor)) {
			throw new WasiError(Errno.badf);
		}
	}

	function assertCharacterDevice(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugCharacterDeviceFD {
		if (!(fileDescriptor instanceof DebugCharacterDeviceFD)) {
			throw new WasiError(Errno.badf);
		}
	}

	function assertDirectory(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugDirectoryFD {
		if (!(fileDescriptor instanceof DebugDirectoryFD)) {
			throw new WasiError(Errno.badf);
		}
	}

	function assertFile(fileDescriptor: FileDescriptor): asserts fileDescriptor is DebugFileFD {
		if (!(fileDescriptor instanceof DebugFileFD)) {
			throw new WasiError(Errno.badf);
		}
	}

	return Object.assign({}, NoSysDeviceDriver, {
		id: deviceId,
		createStdioFileDescriptor(): FileDescriptor {
			throw new WasiError(Errno.nosys);
		},
		fd_prestat_get(fd: fd): [string, FileDescriptor] | undefined {
			const next = preOpenDirectories.shift();
			if (next === undefined) {
				return undefined;
			}
			return [
				next,
				rootFd(fd)
			];
		},
		path_open(parentDescriptor: FileDescriptor, _dirflags: lookupflags, path: string, _oflags: oflags, fs_rights_base: rights, fs_rights_inheriting: rights, fdflags: fdflags): FileDescriptor {
			assertDirectory(parentDescriptor);
			if (parentDescriptor !== rootFd()) {
				throw new WasiError(Errno.notdir);
			}

			return getFileDescriptor(posix_path.join('/', path));
		},
		fd_fdstat_get(fileDescriptor: FileDescriptor, result: fdstat): void {
			result.fs_filetype = fileDescriptor.fileType;
			result.fs_flags = fileDescriptor.fdflags;
			result.fs_rights_base = fileDescriptor.rights_base;
			result.fs_rights_inheriting = fileDescriptor.rights_inheriting;
		},
		fd_filestat_get(fileDescriptor: FileDescriptor, result: filestat): void {
			result.dev = fileDescriptor.deviceId;
			result.ino = fileDescriptor.inode;
			result.filetype = fileDescriptor.fileType;
			result.nlink = 0n;
			const now = BigInt(Date.now());
			result.atim = now;
			result.ctim = now;
			result.mtim = now;
			if (fileDescriptor instanceof DebugCharacterDeviceFD) {
				result.size = 101n;
			} else if (fileDescriptor instanceof DebugFileFD) {
				result.size = BigInt(mainContentBytes.byteLength);
			} else {
				result.size = 0n;
			}
		},
		fd_seek(fileDescriptor: FileDescriptor, _offset: bigint, whence: number): bigint {
			// we can't really seek on the input / output character device.
			if (fileDescriptor instanceof DebugCharacterDeviceFD) {
				return _offset;
			}
			assertFile(fileDescriptor);

			const offset = BigInts.asNumber(_offset);
			switch(whence) {
				case Whence.set:
					fileDescriptor.cursor = offset;
					break;
				case Whence.cur:
					fileDescriptor.cursor = fileDescriptor.cursor + offset;
					break;
				case Whence.end:
					fileDescriptor.cursor = Math.max(0, mainContentBytes.byteLength - offset);
					break;
			}
			return BigInt(fileDescriptor.cursor);
		},
		fd_read(fileDescriptor: FileDescriptor, buffers: Uint8Array[]): size {
			if (buffers.length === 0) {
				return 0;
			}
			const maxBytesToRead = buffers.reduce<number>((prev, current) => prev + current.length, 0);
			let content: Uint8Array | undefined;
			let offset: number | undefined;
			let fileFD: DebugFileFD | undefined;
			assertDebugFileDescriptor(fileDescriptor);
			if (fileDescriptor === inputFd()) {
				content = apiClient.byteSource.read(uri, maxBytesToRead);
				offset = 0;
			} else if (fileDescriptor === mainFd()) {
				assertFile(fileDescriptor);
				fileFD = fileDescriptor;
				content = textEncoder.encode(mainContent);
				offset= fileDescriptor.cursor;
			}
			if (content === undefined || offset === undefined) {
				throw new WasiError(Errno.badf);
			}
			let totalBytesRead = 0;
			for (const buffer of buffers) {
				const toCopy = Math.min(buffer.length, content.length - offset);
				buffer.set(content.subarray(offset, toCopy));
				offset += toCopy;
				totalBytesRead += toCopy;
				if (toCopy < buffer.length) {
					break;
				}
			}
			if (fileFD !== undefined) {
				fileFD.cursor = fileFD.cursor + totalBytesRead;
			}
			return totalBytesRead;
		},
		fd_write(fileDescriptor: FileDescriptor, buffers: Uint8Array[]): size {
			assertCharacterDevice(fileDescriptor);

			if (fileDescriptor !== outputFd()) {
				throw new WasiError(Errno.badf);
			}
			let buffer: Uint8Array;
			if (buffers.length === 1) {
				buffer = buffers[0];
			} else {
				const byteLength: number = buffers.reduce<number>((prev, current) => prev + current.length, 0);
				buffer = new Uint8Array(byteLength);
				let offset = 0;
				for (const item of buffers) {
					buffer.set(item, offset);
					offset = item.byteLength;
				}
			}
			apiClient.byteSink.write(uri, buffer);
			return buffer.byteLength;
		},
		fd_close(_fileDescriptor: FileDescriptor): void {
		},
	});
}