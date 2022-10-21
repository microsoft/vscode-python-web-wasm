import { Event, EventEmitter } from 'vscode';

export interface Spawnee {
	stdout: Event<string>;
	stderr: Event<string>;
	stdin(data: string): void;
	exit: Event<number>;
	killed: boolean;
	kill(): void;
}


export interface Spawner {
	/**
	 * Spawn a python `process`
	 *
	 * @param args: arguments to pass to the python
	 * @returns an object that can be listened to for stdout/stderr/stdin
	 */
	spawn(args: string[], cwd: string | undefined): Promise<Spawnee>;
}

export abstract class BaseSpawnee {
	_stdoutEmitter = new EventEmitter<string>();
	_stderrEmitter = new EventEmitter<string>();
	_exitEmitter = new EventEmitter<number>();

	protected fireStdout(data: string) {
		this._stdoutEmitter.fire(data);
	}

	protected fireStderr(data: string) {
		this._stderrEmitter.fire(data);
	}

	protected fireExit(code: number) {
		this._exitEmitter.fire(code);
	}

	get stdout(): Event<string> {
		return this._stdoutEmitter.event;
	}
	get stderr(): Event<string> {
		return this._stderrEmitter.event;
	}
	get exit(): Event<number> {
		return this._exitEmitter.event;
	}

}