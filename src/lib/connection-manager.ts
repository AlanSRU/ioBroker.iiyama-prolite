/**
 * Connection Manager for iiyama displays
 * Supports both TCP/IP and Serial connections
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { SerialPort } from 'serialport';
import { IiyamaResponse, IiyamaProtocol } from './iiyama-protocol';

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

export class ConnectionManager extends EventEmitter {
	private client: net.Socket | SerialPort | null = null;
	private connected = false;
	private buffer = Buffer.alloc(0);
	private responseTimeout: NodeJS.Timeout | null = null;
	private reconnectTimeout: NodeJS.Timeout | null = null;
	private reconnectAttempts = 0;
	private readonly maxReconnectAttempts = 10;
	private readonly reconnectDelay = 5000;
	private autoReconnectEnabled = true;

	constructor(
		private readonly config: ConnectionConfig,
		private readonly log: Logger,
	) {
		super();
	}

	/**
	 * Enable or disable auto-reconnect
	 */
	public setAutoReconnect(enabled: boolean): void {
		this.autoReconnectEnabled = enabled;
		if (!enabled && this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
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
		return new Promise((resolve, reject) => {
			if (this.connected) {
				return resolve();
			}

			if (this.config.type === 'tcp') {
				this.connectTCP(resolve, reject);
			} else {
				this.connectSerial(resolve, reject);
			}
		});
	}

	/**
	 * Connect via TCP/IP
	 */
	private connectTCP(resolve: () => void, reject: (error: Error) => void): void {
		if (!this.config.host || !this.config.port) {
			return reject(new Error('TCP connection requires host and port'));
		}

		this.client = new net.Socket();
		const tcpClient = this.client as net.Socket;

		tcpClient.connect(this.config.port, this.config.host, () => {
			this.connected = true;
			this.reconnectAttempts = 0;

			// Enable TCP keepalive to detect dead connections
			tcpClient.setKeepAlive(true, 10000); // Send keepalive probe every 10 seconds

			this.emit('connected');
			resolve();
		});

		tcpClient.on('data', (data: Buffer) => {
			this.handleData(data);
		});

		tcpClient.on('error', (error: Error) => {
			this.emit('error', error);
			if (!this.connected) {
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

		const serialClient = this.client as SerialPort;

		serialClient.on('open', () => {
			this.connected = true;
			this.reconnectAttempts = 0;
			this.emit('connected');
			resolve();
		});

		serialClient.on('data', (data: Buffer) => {
			this.handleData(data);
		});

		serialClient.on('error', (error: Error) => {
			this.emit('error', error);
			if (!this.connected) {
				reject(error);
			}
		});

		serialClient.on('close', () => {
			this.handleDisconnect();
		});
	}

	/**
	 * Handle incoming data
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
				this.log.debug(`Valid response received: monitorId=${response.monitorId}, commandCode=0x${response.commandCode.toString(16)}, isAck=${response.isAck}, data=[${response.data}]`);
				this.emit('response', response);
			} else {
				this.log.error(`Invalid response checksum! Packet: ${packet.toString('hex')}`);
				this.emit('error', new Error('Invalid response checksum'));
			}
		}
	}

	/**
	 * Send command to display
	 */
	public async sendCommand(command: Buffer, waitForResponse = true): Promise<IiyamaResponse | null> {
		if (!this.connected || !this.client) {
			throw new Error('Not connected');
		}

		return new Promise((resolve, reject) => {
			if (waitForResponse) {
				// Set up response handler
				const onResponse = (response: IiyamaResponse): void => {
					if (this.responseTimeout) {
						clearTimeout(this.responseTimeout);
						this.responseTimeout = null;
					}
					this.removeListener('response', onResponse);
					resolve(response);
				};

				this.once('response', onResponse);

				// Set timeout (increased to 2000ms for slower displays)
				this.responseTimeout = setTimeout(() => {
					this.log.error('Response timeout! No valid response received within 2000ms');
					this.log.error(`Current buffer: ${this.buffer.toString('hex')} (${this.buffer.length} bytes)`);
					this.removeListener('response', onResponse);
					reject(new Error('Response timeout'));
				}, 2000);
			}

			// DEBUG: Log command being sent
			this.log.debug(`Sending command: ${command.toString('hex')} (${command.length} bytes)`);

			// Send command
			if (this.config.type === 'tcp') {
				(this.client as net.Socket).write(command, (error: Error | null | undefined) => {
					if (error) {
						if (this.responseTimeout) {
							clearTimeout(this.responseTimeout);
							this.responseTimeout = null;
						}
						reject(error);
					} else if (!waitForResponse) {
						resolve(null);
					}
				});
			} else {
				(this.client as SerialPort).write(command, (error: Error | null | undefined) => {
					if (error) {
						if (this.responseTimeout) {
							clearTimeout(this.responseTimeout);
							this.responseTimeout = null;
						}
						reject(error);
					} else if (!waitForResponse) {
						resolve(null);
					}
				});
			}
		});
	}

	/**
	 * Handle disconnection
	 */
	private handleDisconnect(): void {
		const wasConnected = this.connected;
		this.connected = false;

		if (this.responseTimeout) {
			clearTimeout(this.responseTimeout);
			this.responseTimeout = null;
		}

		if (wasConnected) {
			this.emit('disconnected');
		}

		// Attempt reconnection (if enabled)
		if (this.autoReconnectEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
			this.reconnectAttempts++;
			this.emit('reconnecting', this.reconnectAttempts);

			this.reconnectTimeout = setTimeout(() => {
				this.connect().catch(() => {
					// Error is already emitted by connect(), don't emit again
				});
			}, this.reconnectDelay);
		} else if (this.autoReconnectEnabled) {
			// Max attempts reached - emit specific event instead of error
			this.emit('maxReconnectReached');
		}
	}

	/**
	 * Disconnect from display
	 */
	public disconnect(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		if (this.responseTimeout) {
			clearTimeout(this.responseTimeout);
			this.responseTimeout = null;
		}

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
