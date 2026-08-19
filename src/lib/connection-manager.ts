/**
 * Connection Manager for iiyama displays
 * Supports both TCP/IP and Serial connections
 */

import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import { SerialPort } from 'serialport';
import type { IiyamaResponse } from './iiyama-protocol';
import { IiyamaProtocol } from './iiyama-protocol';

export interface ConnectionConfig {
	type: 'tcp' | 'serial';
	host?: string;
	port?: number;
	serialPort?: string;
	baudRate?: number;
}

export interface Logger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/**
 * Minimal surface of the ioBroker adapter used by the connection manager.
 * Injecting the adapter lets us use its framework-managed timers, which are
 * cleared automatically on unload.
 */
export type AdapterLike = Pick<
	ioBroker.Adapter,
	'log' | 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'
>;

export class ConnectionManager extends EventEmitter {
	private client: net.Socket | SerialPort | null = null;
	private connected = false;
	private buffer = Buffer.alloc(0);
	private responseTimeout: ioBroker.Timeout | undefined;
	private consecutiveTimeouts = 0;
	/** In-flight sendCommand awaiting a reply, so a disconnect can settle it instead of hanging. */
	private pendingRequest: { reject: (error: Error) => void; cleanup: () => void } | undefined;
	private reconnectTimeout: ioBroker.Timeout | undefined;
	private connectTimeout: ioBroker.Timeout | undefined;
	private standbyPollTimeout: ioBroker.Interval | undefined;
	private connectPromise: Promise<void> | undefined;
	private reconnectAttempts = 0;
	private readonly maxReconnectAttempts = 10;
	private readonly reconnectDelay = 5000;
	private readonly connectTimeoutMs = 10000; // Reject a TCP connect that hangs (unreachable host)
	private readonly standbyPollInterval = 30000; // Check every 30s if display came back
	private autoReconnectEnabled = true;
	private readonly log: Logger;

	constructor(
		private readonly config: ConnectionConfig,
		private readonly adapter: AdapterLike,
	) {
		super();
		this.log = adapter.log;
	}

	/**
	 * Enable or disable auto-reconnect
	 *
	 * @param enabled
	 */
	public setAutoReconnect(enabled: boolean): void {
		this.autoReconnectEnabled = enabled;
		if (!enabled) {
			if (this.reconnectTimeout) {
				this.adapter.clearTimeout(this.reconnectTimeout);
				this.reconnectTimeout = undefined;
			}
			// Standby polling calls connect() too, so leaving it running would race the caller
			// that just took ownership of the connection (the WOL wake sequence does exactly this).
			this.stopStandbyPolling();
		}
	}

	/**
	 * Reset reconnect attempts counter
	 */
	public resetReconnectAttempts(): void {
		this.reconnectAttempts = 0;
	}

	/**
	 * Connect to the display
	 */
	public async connect(): Promise<void> {
		if (this.connected) {
			return;
		}

		// Reuse an attempt that is already running. The WOL retry loop and the standby poll tick
		// can both call connect() while one is in flight; each would otherwise build its own
		// socket and overwrite this.client, leaving the earlier one ESTABLISHED but unreferenced.
		// disconnect() only destroys the current client, so that socket would never be closed.
		if (this.connectPromise) {
			return this.connectPromise;
		}

		this.connectPromise = new Promise<void>((resolve, reject) => {
			if (this.config.type === 'tcp') {
				this.connectTCP(resolve, reject);
			} else {
				this.connectSerial(resolve, reject);
			}
		});

		try {
			await this.connectPromise;
		} finally {
			this.connectPromise = undefined;
		}
	}

	/**
	 * Connect via TCP/IP
	 *
	 * @param resolve
	 * @param reject
	 */
	private connectTCP(resolve: () => void, reject: (error: Error) => void): void {
		if (!this.config.host || !this.config.port) {
			return reject(new Error('TCP connection requires host and port'));
		}

		this.client = new net.Socket();
		const tcpClient = this.client;

		// Guard against a connect that hangs (host unreachable but not refusing):
		// net.Socket.connect() otherwise relies on the OS default TCP timeout (20-130s),
		// making the adapter appear frozen. Reject after connectTimeoutMs instead.
		let settled = false;
		this.connectTimeout = this.adapter.setTimeout(() => {
			this.connectTimeout = undefined;
			if (this.connected || settled) {
				return;
			}
			settled = true;
			this.log.debug(`TCP connect timeout after ${this.connectTimeoutMs}ms (host may be off/unreachable)`);
			tcpClient.destroy();
			reject(new Error('ETIMEDOUT: TCP connection timed out'));
		}, this.connectTimeoutMs);

		tcpClient.connect(this.config.port, this.config.host, () => {
			if (this.connectTimeout) {
				this.adapter.clearTimeout(this.connectTimeout);
				this.connectTimeout = undefined;
			}
			settled = true;
			this.connected = true;
			this.reconnectAttempts = 0;
			this.stopStandbyPolling();

			// Enable TCP keepalive to detect dead connections
			tcpClient.setKeepAlive(true, 10000); // Send keepalive probe every 10 seconds

			this.emit('connected');
			resolve();
		});

		tcpClient.on('data', (data: Buffer) => {
			this.handleData(data);
		});

		tcpClient.on('error', (error: Error) => {
			if (this.connectTimeout) {
				this.adapter.clearTimeout(this.connectTimeout);
				this.connectTimeout = undefined;
			}
			this.emit('error', error);
			if (!this.connected && !settled) {
				settled = true;
				reject(error);
			}
		});

		tcpClient.on('close', () => {
			this.handleDisconnect();
		});

		// Handle connection timeout (only fires after extended inactivity)
		tcpClient.on('timeout', () => {
			this.log.warn('TCP connection idle timeout - connection may be stale');
			// Don't destroy immediately - let keepalive handle dead connection detection
			// This just logs a warning that the connection has been idle
		});
	}

	/**
	 * Connect via Serial
	 *
	 * @param resolve
	 * @param reject
	 */
	private connectSerial(resolve: () => void, reject: (error: Error) => void): void {
		if (!this.config.serialPort || !this.config.baudRate) {
			return reject(new Error('Serial connection requires serialPort and baudRate'));
		}

		this.client = new SerialPort({
			path: this.config.serialPort,
			baudRate: this.config.baudRate,
			dataBits: 8,
			parity: 'none',
			stopBits: 1,
		});

		const serialClient = this.client;

		serialClient.on('open', () => {
			this.connected = true;
			this.reconnectAttempts = 0;
			this.stopStandbyPolling();
			this.emit('connected');
			resolve();
		});

		serialClient.on('data', (data: Buffer) => {
			this.handleData(data);
		});

		// serialport emits ONLY 'error' when opening the port fails - never 'close'. Since
		// handleDisconnect() is the sole scheduler of both the reconnect chain and standby
		// polling, an open failure would otherwise leave the adapter idle for good: a dongle
		// enumerated after ioBroker starts, or a missing dialout group membership, would never
		// recover without a manual instance restart. TCP does not need this because the socket
		// always emits 'close' after an error.
		let openFailureHandled = false;

		serialClient.on('error', (error: Error) => {
			this.emit('error', error);
			if (!this.connected) {
				reject(error);
				if (!openFailureHandled) {
					openFailureHandled = true;
					this.handleDisconnect();
				}
			}
		});

		serialClient.on('close', () => {
			// Skip if the open already failed, so the retry is scheduled exactly once.
			if (openFailureHandled) {
				return;
			}
			this.handleDisconnect();
		});
	}

	/**
	 * Handle incoming data
	 *
	 * @param data
	 */
	private handleData(data: Buffer): void {
		// DEBUG: Log received data
		this.log.debug(`Received data: ${data.toString('hex')} (${data.length} bytes)`);

		// Append to buffer
		this.buffer = Buffer.concat([this.buffer, data]);

		// Try to parse complete responses
		this.parseBuffer();
	}

	/**
	 * Parse buffer for complete responses
	 * Note: Response format does NOT have message type byte (unlike commands)
	 */
	private parseBuffer(): void {
		// Minimum packet size is 9 bytes
		while (this.buffer.length >= 9) {
			// Look for response header (0x21)
			const headerIndex = this.buffer.indexOf(0x21);

			if (headerIndex === -1) {
				// No header found, clear buffer
				this.buffer = Buffer.alloc(0);
				return;
			}

			if (headerIndex > 0) {
				// Remove bytes before header
				this.buffer = this.buffer.slice(headerIndex);
			}

			// Check if we have enough data for length field
			if (this.buffer.length < 5) {
				return;
			}

			// Get expected packet length (length field is at position 4)
			// Length value includes everything after the length field (data_control + cmd + data + checksum)
			const length = this.buffer[4];
			const totalLength = length + 5; // header(1) + monitorId(1) + category(1) + page(1) + length_field(1) + length_value

			if (this.buffer.length < totalLength) {
				// Not enough data yet
				return;
			}

			// Extract packet
			const packet = this.buffer.slice(0, totalLength);
			this.buffer = this.buffer.slice(totalLength);

			// Parse response
			const response = IiyamaProtocol.parseResponse(packet);
			if (response) {
				this.log.debug(
					`Valid response received: monitorId=${response.monitorId}, commandCode=0x${response.commandCode.toString(16)}, isAck=${response.isAck}, data=[${response.data.join(',')}]`,
				);
				this.emit('response', response);
			} else {
				this.log.error(`Invalid response checksum! Packet: ${packet.toString('hex')}`);
				this.emit('error', new Error('Invalid response checksum'));
			}
		}
	}

	/**
	 * Send command to display
	 *
	 * @param command
	 * @param waitForResponse
	 * @param expectedCode - Command code the reply must carry. Replies with any other code are
	 *   ignored rather than resolving this request (see correlation note below).
	 */
	public async sendCommand(
		command: Buffer,
		waitForResponse = true,
		expectedCode?: number,
	): Promise<IiyamaResponse | null> {
		if (!this.connected || !this.client) {
			throw new Error('Not connected');
		}

		return new Promise((resolve, reject) => {
			// Settled by whichever of resolve/reject/timeout/disconnect happens first.
			const finish = (): void => {
				if (this.responseTimeout) {
					this.adapter.clearTimeout(this.responseTimeout);
					this.responseTimeout = undefined;
				}
				this.pendingRequest?.cleanup();
				this.pendingRequest = undefined;
			};

			if (waitForResponse) {
				// Set up response handler
				const onResponse = (response: IiyamaResponse): void => {
					// Correlate the reply with the request. After a response timeout a late reply can
					// still arrive while the *next* command is already waiting on its own listener,
					// which would otherwise resolve that command with the previous command's payload
					// and write the wrong value into its state.
					if (expectedCode !== undefined && response.commandCode !== expectedCode) {
						this.log.debug(
							`Ignoring response 0x${response.commandCode.toString(16)} while waiting for 0x${expectedCode.toString(16)}`,
						);
						return; // keep waiting for a matching reply, or the timeout
					}
					this.consecutiveTimeouts = 0;
					finish();
					resolve(response);
				};

				this.on('response', onResponse);
				this.pendingRequest = {
					reject,
					cleanup: () => this.removeListener('response', onResponse),
				};

				// Set timeout for response
				this.responseTimeout = this.adapter.setTimeout(() => {
					// A display that accepts TCP but never answers the protocol (a mismatched monitor
					// ID is the common cause) would otherwise log two error lines per command on every
					// poll cycle, indefinitely. Report the first loudly, then demote until a reply lands.
					if (this.consecutiveTimeouts === 0) {
						this.log.error('Response timeout! No valid response received within 5000ms');
						this.log.error(`Current buffer: ${this.buffer.toString('hex')} (${this.buffer.length} bytes)`);
					} else {
						this.log.debug(
							`Response timeout (${this.consecutiveTimeouts + 1} consecutive). ` +
								`Buffer: ${this.buffer.toString('hex')} (${this.buffer.length} bytes)`,
						);
					}
					this.consecutiveTimeouts++;
					// Drop any partial frame: whatever is buffered belongs to a request that has
					// already been abandoned, and keeping it would corrupt the next parse.
					this.buffer = Buffer.alloc(0);
					finish();
					reject(new Error('Response timeout'));
				}, 5000);
			}

			// DEBUG: Log command being sent
			this.log.debug(`Sending command: ${command.toString('hex')} (${command.length} bytes)`);

			const onWriteComplete = (error: Error | null | undefined): void => {
				if (error) {
					finish();
					reject(error);
				} else if (!waitForResponse) {
					resolve(null);
				}
			};

			// Send command
			if (this.config.type === 'tcp') {
				(this.client as net.Socket).write(command, onWriteComplete);
			} else {
				(this.client as SerialPort).write(command, onWriteComplete);
			}
		});
	}

	/**
	 * Reject an in-flight sendCommand so its caller cannot wait forever.
	 *
	 * Disconnecting clears the response timeout, so without this the promise would never settle:
	 * processQueue would stay awaiting it, processingQueue would remain true, and every later poll
	 * cycle would be dropped by the "previous cycle still processing" guard until a restart.
	 *
	 * @param reason - Message for the rejection error
	 */
	private settlePendingRequest(reason: string): void {
		if (this.responseTimeout) {
			this.adapter.clearTimeout(this.responseTimeout);
			this.responseTimeout = undefined;
		}

		const pending = this.pendingRequest;
		this.pendingRequest = undefined;
		if (pending) {
			pending.cleanup();
			pending.reject(new Error(reason));
		}
	}

	/**
	 * Handle disconnection
	 */
	private handleDisconnect(): void {
		const wasConnected = this.connected;
		this.connected = false;

		this.settlePendingRequest('Connection closed while awaiting response');

		if (wasConnected) {
			this.emit('disconnected');
		}

		// Attempt reconnection (if enabled)
		if (this.autoReconnectEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
			this.reconnectAttempts++;
			this.emit('reconnecting', this.reconnectAttempts);

			this.reconnectTimeout = this.adapter.setTimeout(() => {
				this.connect().catch(() => {
					// Error is already emitted by connect(), don't emit again
				});
			}, this.reconnectDelay);
		} else if (this.autoReconnectEnabled) {
			// Max attempts reached - emit specific event instead of error
			this.emit('maxReconnectReached');
			// Start slow standby polling to detect when display comes back online
			this.startStandbyPolling();
		}
	}

	/**
	 * Start slow periodic reconnection attempts while display is in standby.
	 * This ensures the adapter reconnects when the display is turned on manually.
	 */
	private startStandbyPolling(): void {
		this.stopStandbyPolling();
		this.standbyPollTimeout = this.adapter.setInterval(() => {
			if (this.connected) {
				this.stopStandbyPolling();
				return;
			}
			this.log.debug('Standby poll: checking if display is reachable...');
			// Do NOT reset reconnectAttempts here. Doing so lifts the maxReconnectAttempts cap on
			// every tick, so handleDisconnect starts a fresh 5 s reconnect chain each time and the
			// slow standby cadence never actually replaces the fast loop. A successful connect
			// resets the counter on its own.
			this.connect().catch(() => {
				// Expected when display is still off
			});
		}, this.standbyPollInterval);
	}

	/**
	 * Stop standby polling
	 */
	private stopStandbyPolling(): void {
		if (this.standbyPollTimeout) {
			this.adapter.clearInterval(this.standbyPollTimeout);
			this.standbyPollTimeout = undefined;
		}
	}

	/**
	 * Disconnect from display
	 */
	public disconnect(): void {
		this.stopStandbyPolling();

		if (this.reconnectTimeout) {
			this.adapter.clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = undefined;
		}

		if (this.connectTimeout) {
			this.adapter.clearTimeout(this.connectTimeout);
			this.connectTimeout = undefined;
		}

		this.settlePendingRequest('Disconnected while awaiting response');

		if (this.client) {
			if (this.config.type === 'tcp') {
				(this.client as net.Socket).destroy();
			} else {
				(this.client as SerialPort).close();
			}
			this.client = null;
		}

		this.connected = false;
		this.buffer = Buffer.alloc(0);
	}

	/**
	 * Check if connected
	 */
	public isConnected(): boolean {
		return this.connected;
	}
}
