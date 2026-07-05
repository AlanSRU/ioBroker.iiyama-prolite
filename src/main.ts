/*
 * Created with @iobroker/create-adapter v3.1.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';
import { ConnectionManager } from './lib/connection-manager';
import { IiyamaProtocol, InputSource } from './lib/iiyama-protocol';
import { WakeOnLan } from './lib/wake-on-lan';

class Iiyama extends utils.Adapter {
	private connection: ConnectionManager | null = null;
	private pollInterval: ioBroker.Interval | undefined;
	private commandQueue: Array<() => Promise<void>> = [];
	private processingQueue = false;
	private wolInProgress = false; // Flag to prevent polling during WOL wake sequence

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'iiyama',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		this.log.info('Starting iiyama adapter');

		// Log Power Save mode configuration
		const powerSaveMode = this.config.powerSaveMode || 1;
		if (this.config.connectionType === 'tcp') {
			const modeDescriptions = {
				1: 'WOL off, source input wake off - Cannot wake via network',
				2: 'WOL off, source input wake on - Wakes on source signal only, no network control',
				3: 'WOL on, source input wake off - Use WOL + power command',
				4: 'WOL on, source input wake on - Use WOL + power command (recommended)',
			};
			this.log.info(`Power Save Mode ${powerSaveMode}: ${modeDescriptions[powerSaveMode] || 'Unknown mode'}`);
		}

		// Validate configuration
		if (this.config.connectionType === 'tcp') {
			if (!this.config.host || !this.config.port) {
				this.log.error('TCP connection requires host and port configuration');
				return;
			}
		} else {
			if (!this.config.serialPort || !this.config.baudRate) {
				this.log.error('Serial connection requires serialPort and baudRate configuration');
				return;
			}
		}

		if (!this.config.monitorId || this.config.monitorId < 1 || this.config.monitorId > 255) {
			this.log.error('Monitor ID must be between 1 and 255');
			return;
		}

		// Clamp/validate numeric config in code — the admin UI min/max is not enforced
		// for values set via CLI or by editing the instance config directly.
		this.config.pollInterval = Math.min(300, Math.max(5, parseInt(String(this.config.pollInterval), 10) || 30));
		if (this.config.connectionType === 'tcp') {
			const port = parseInt(String(this.config.port), 10);
			if (!(port >= 1 && port <= 65535)) {
				this.log.error(`TCP port must be between 1 and 65535 (got ${this.config.port})`);
				return;
			}
			this.config.port = port;
		}

		// Create state objects
		await this.createStateObjects();

		// Initialize connection
		await this.initConnection();

		// Subscribe to state changes
		this.subscribeStates('*');
	}

	/**
	 * Create all state objects
	 */
	private async createStateObjects(): Promise<void> {
		// Connection state - tracks actual device connectivity
		await this.setObjectNotExistsAsync('info.connection', {
			type: 'state',
			common: {
				name: 'Connection status',
				type: 'boolean',
				role: 'indicator.connected',
				read: true,
				write: false,
			},
			native: {},
		});

		// Standby state (display is off/unreachable but adapter is working)
		await this.setObjectNotExistsAsync('info.standby', {
			type: 'state',
			common: {
				name: 'Display in standby',
				type: 'boolean',
				role: 'indicator',
				read: true,
				write: false,
			},
			native: {},
		});

		// Power control
		await this.setObjectNotExistsAsync('power', {
			type: 'state',
			common: {
				name: 'Power',
				type: 'boolean',
				role: 'switch.power',
				read: true,
				write: true,
			},
			native: {},
		});

		// Input source
		await this.setObjectNotExistsAsync('inputSource', {
			type: 'state',
			common: {
				name: 'Input Source',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				states: {
					[InputSource.HDMI]: 'HDMI',
					[InputSource.HDMI_2]: 'HDMI 2',
					[InputSource.HDMI_3]: 'HDMI 3',
					[InputSource.HDMI_4]: 'HDMI 4',
					[InputSource.DVI_D]: 'DVI-D',
					[InputSource.DISPLAY_PORT]: 'DisplayPort',
					[InputSource.DISPLAY_PORT_2]: 'DisplayPort 2',
					[InputSource.VGA]: 'VGA',
					[InputSource.USB]: 'USB',
					[InputSource.USB_2]: 'USB 2',
				},
			},
			native: {},
		});

		// Volume
		await this.setObjectNotExistsAsync('volume.main', {
			type: 'state',
			common: {
				name: 'Main Volume',
				type: 'number',
				role: 'level.volume',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('volume.audioOut', {
			type: 'state',
			common: {
				name: 'Audio Out Volume',
				type: 'number',
				role: 'level.volume',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		// Video parameters
		await this.setObjectNotExistsAsync('video.brightness', {
			type: 'state',
			common: {
				name: 'Brightness',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('video.contrast', {
			type: 'state',
			common: {
				name: 'Contrast',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('video.color', {
			type: 'state',
			common: {
				name: 'Color',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('video.sharpness', {
			type: 'state',
			common: {
				name: 'Sharpness',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('video.tint', {
			type: 'state',
			common: {
				name: 'Tint',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('video.blackLevel', {
			type: 'state',
			common: {
				name: 'Black Level',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('video.gamma', {
			type: 'state',
			common: {
				name: 'Gamma',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				states: {
					1: 'Native',
					2: 'S Gamma',
					3: '2.2',
					4: '2.4',
					5: 'DICOM',
				},
			},
			native: {},
		});

		// Color temperature
		await this.setObjectNotExistsAsync('video.colorTemperature', {
			type: 'state',
			common: {
				name: 'Color Temperature',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				states: {
					0x00: 'User 1',
					0x01: 'Native',
					0x03: '10000K',
					0x04: '9300K',
					0x05: '7500K',
					0x06: '6500K',
					0x09: '5000K',
					0x0a: '4000K',
					0x0d: '3000K',
					0x12: 'User 2',
				},
			},
			native: {},
		});

		// Picture format
		await this.setObjectNotExistsAsync('video.pictureFormat', {
			type: 'state',
			common: {
				name: 'Picture Format',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				states: {
					0x00: 'Normal (4:3)',
					0x01: 'Custom',
					0x02: 'Real (1:1)',
					0x03: 'Full',
					0x04: '21:9',
					0x05: 'Dynamic',
					0x06: '16:9',
				},
			},
			native: {},
		});

		// Audio parameters
		await this.setObjectNotExistsAsync('audio.treble', {
			type: 'state',
			common: {
				name: 'Treble',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('audio.bass', {
			type: 'state',
			common: {
				name: 'Bass',
				type: 'number',
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
			},
			native: {},
		});

		// Information
		await this.setObjectNotExistsAsync('info.operatingHours', {
			type: 'state',
			common: {
				name: 'Operating Hours',
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				unit: 'hours',
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('info.serialCode', {
			type: 'state',
			common: {
				name: 'Serial Code',
				type: 'string',
				role: 'text',
				read: true,
				write: false,
			},
			native: {},
		});

		// Commands
		await this.setObjectNotExistsAsync('commands.autoAdjust', {
			type: 'state',
			common: {
				name: 'Auto Adjust (VGA only)',
				type: 'boolean',
				role: 'button',
				read: false,
				write: true,
			},
			native: {},
		});
	}

	/**
	 * Initialize connection to display
	 */
	private async initConnection(): Promise<void> {
		// Initialize device states
		await this.setState('info.connection', false, true);
		await this.setState('info.standby', false, true);

		try {
			this.connection = new ConnectionManager(
				{
					type: this.config.connectionType,
					host: this.config.host,
					port: this.config.port,
					serialPort: this.config.serialPort,
					baudRate: this.config.baudRate,
				},
				this.log,
			);

			this.connection.on('connected', () => {
				this.log.info('Connected to display');
				this.setState('info.connection', true, true);
				this.setState('info.standby', false, true);
				// Don't start polling during WOL wake sequence - it will be started after power command
				if (!this.wolInProgress) {
					// Give display time to be ready for protocol commands after TCP connect
					this.setTimeout(() => {
						this.startPolling();
						this.pollStatus();
					}, 2000);
				}
			});

			this.connection.on('disconnected', () => {
				this.log.info('Disconnected from display');
				this.setState('info.connection', false, true);
				this.stopPolling();
			});

			this.connection.on('error', (error: Error) => {
				// EHOSTUNREACH is expected when display is off/in standby - log as debug
				if (error.message.includes('EHOSTUNREACH') || error.message.includes('ECONNREFUSED')) {
					this.log.debug(`Connection error (display may be off): ${error.message}`);
				} else {
					this.log.error(`Connection error: ${error.message}`);
				}
			});

			this.connection.on('reconnecting', (attempt: number) => {
				this.log.debug(`Reconnecting to display (attempt ${attempt})`);
			});

			this.connection.on('maxReconnectReached', () => {
				this.log.info(
					'Max reconnection attempts reached - display appears to be off. Will reconnect on power-on command.',
				);
				this.setState('info.standby', true, true);
			});

			await this.connection.connect();
		} catch (error) {
			// Don't log as error if display is simply off/unreachable - this is expected
			const errorMsg = (error as Error).message;
			if (
				errorMsg.includes('EHOSTUNREACH') ||
				errorMsg.includes('ECONNREFUSED') ||
				errorMsg.includes('ETIMEDOUT')
			) {
				this.log.info(`Display not reachable (may be off/in standby): ${errorMsg}`);
				this.setState('info.standby', true, true);
			} else {
				this.log.error(`Failed to connect to display: ${errorMsg}`);
			}
			// Adapter is still running correctly even if display is unreachable
		}
	}

	/**
	 * Start polling for status updates
	 */
	private startPolling(): void {
		if (this.pollInterval) {
			return;
		}

		const interval = (this.config.pollInterval || 30) * 1000;
		this.pollInterval = this.setInterval(() => {
			this.pollStatus();
		}, interval);
	}

	/**
	 * Stop polling
	 */
	private stopPolling(): void {
		if (this.pollInterval) {
			this.clearInterval(this.pollInterval);
			this.pollInterval = undefined;
		}
	}

	/**
	 * Poll display status
	 */
	private pollStatus(): void {
		if (!this.connection || !this.connection.isConnected()) {
			return;
		}

		try {
			// Queue status commands
			this.queueCommand(() => this.getPowerState());
			this.queueCommand(() => this.getCurrentSource());
			this.queueCommand(() => this.getVolume());
			this.queueCommand(() => this.getVideoParams());
			this.queueCommand(() => this.getColorTemperature());
			this.queueCommand(() => this.getPictureFormat());
			this.queueCommand(() => this.getAudioParams());
			this.queueCommand(() => this.getOperatingHours());
			this.queueCommand(() => this.getSerialCode());
		} catch (error) {
			this.log.error(`Error polling status: ${(error as Error).message}`);
		}
	}

	/**
	 * Queue a command for execution
	 *
	 * @param command
	 */
	private queueCommand(command: () => Promise<void>): void {
		this.commandQueue.push(command);
		this.processQueue();
	}

	/**
	 * Process command queue
	 */
	private async processQueue(): Promise<void> {
		if (this.processingQueue || this.commandQueue.length === 0) {
			return;
		}

		this.processingQueue = true;

		while (this.commandQueue.length > 0) {
			const command = this.commandQueue.shift();
			if (command) {
				try {
					await command();
					// Small delay between commands
					await this.delay(100);
				} catch (error) {
					this.log.error(`Error executing command: ${(error as Error).message}`);
				}
			}
		}

		this.processingQueue = false;
	}

	/**
	 * Get power state
	 */
	private async getPowerState(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetPowerCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response) {
			const powerOn = IiyamaProtocol.parsePowerState(response);
			if (powerOn !== null) {
				await this.setState('power', powerOn, true);
			}
		}
	}

	/**
	 * Get current source
	 */
	private async getCurrentSource(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetCurrentSourceCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response) {
			const source = IiyamaProtocol.parseInputSource(response);
			if (source !== null) {
				await this.setState('inputSource', source, true);
			}
		}
	}

	/**
	 * Get volume
	 */
	private async getVolume(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetVolumeCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response) {
			const volume = IiyamaProtocol.parseVolume(response);
			if (volume) {
				await this.setState('volume.main', volume.volume, true);
				await this.setState('volume.audioOut', volume.audioOut, true);
			}
		}
	}

	/**
	 * Get video parameters
	 */
	private async getVideoParams(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetVideoParamsCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response) {
			const params = IiyamaProtocol.parseVideoParams(response);
			if (params) {
				await this.setState('video.brightness', params.brightness, true);
				await this.setState('video.color', params.color, true);
				await this.setState('video.contrast', params.contrast, true);
				await this.setState('video.sharpness', params.sharpness, true);
				await this.setState('video.tint', params.tint, true);
				await this.setState('video.blackLevel', params.blackLevel, true);
				await this.setState('video.gamma', params.gamma, true);
			}
		}
	}

	/**
	 * Get color temperature
	 */
	private async getColorTemperature(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetColorTempCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response && response.data.length >= 1) {
			await this.setState('video.colorTemperature', response.data[0], true);
		}
	}

	/**
	 * Get picture format
	 */
	private async getPictureFormat(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetPictureFormatCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response && response.data.length >= 1) {
			await this.setState('video.pictureFormat', response.data[0], true);
		}
	}

	/**
	 * Get audio parameters
	 */
	private async getAudioParams(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetAudioParamsCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response && response.data.length >= 2) {
			await this.setState('audio.treble', response.data[0], true);
			await this.setState('audio.bass', response.data[1], true);
		}
	}

	/**
	 * Get operating hours
	 */
	private async getOperatingHours(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetOperatingHoursCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response) {
			const hours = IiyamaProtocol.parseOperatingHours(response);
			if (hours !== null) {
				await this.setState('info.operatingHours', hours, true);
			}
		}
	}

	/**
	 * Get serial code
	 */
	private async getSerialCode(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetSerialCodeCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd);

		if (response) {
			const serialCode = IiyamaProtocol.parseSerialCode(response);
			if (serialCode !== null) {
				await this.setState('info.serialCode', serialCode, true);
			}
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param callback - Callback function
	 */
	private onUnload(callback: () => void): void {
		try {
			this.stopPolling();

			if (this.connection) {
				this.connection.disconnect();
				this.connection = null;
			}

			callback();
		} catch (error) {
			this.log.error(`Error during unloading: ${(error as Error).message}`);
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 *
	 * @param id - State ID
	 * @param state - State object
	 */
	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack || !this.connection) {
			return;
		}

		// This is a command from the user
		const stateId = id.substring(this.namespace.length + 1);
		this.log.debug(`User command received for ${stateId}: ${state.val}`);

		try {
			switch (stateId) {
				case 'power':
					await this.setPower(state.val as boolean);
					break;

				case 'inputSource':
					this.setInputSource(state.val as number);
					break;

				case 'volume.main':
				case 'volume.audioOut':
					await this.setVolume();
					break;

				case 'video.brightness':
				case 'video.color':
				case 'video.contrast':
				case 'video.sharpness':
				case 'video.tint':
				case 'video.blackLevel':
				case 'video.gamma':
					await this.setVideoParams();
					break;

				case 'video.colorTemperature':
					this.setColorTemperature(state.val as number);
					break;

				case 'video.pictureFormat':
					this.setPictureFormat(state.val as number);
					break;

				case 'audio.treble':
				case 'audio.bass':
					await this.setAudioParams();
					break;

				case 'commands.autoAdjust':
					if (state.val) {
						this.autoAdjust();
					}
					break;
			}
		} catch (error) {
			this.log.error(`Error handling state change: ${(error as Error).message}`);
		}
	}

	/**
	 * Set power state
	 * Power Save Mode behavior (as per display OSD):
	 * - Mode 1: WOL off, source input wake off, backlight off → cannot wake via network
	 * - Mode 2: WOL off, source input wake on, backlight off → wakes on source signal only
	 * - Mode 3: WOL on, source input wake off, backlight off → use WOL then send power command
	 * - Mode 4: WOL on, source input wake on, backlight off → use WOL + power command (recommended)
	 *
	 * @param powerOn
	 */
	private async setPower(powerOn: boolean): Promise<void> {
		if (!this.connection) {
			return;
		}

		// Determine power control method based on Power Save mode
		// Mode 1: WOL off, source input wake off (cannot wake via network)
		// Mode 2: WOL off, source input wake on (wakes on source signal, no network control)
		// Mode 3: WOL on, source input wake off (use WOL + power command)
		// Mode 4: WOL on, source input wake on (use WOL + power command, recommended)
		const powerSaveMode = this.config.powerSaveMode || 1;
		const needsWol = powerSaveMode === 3 || powerSaveMode === 4; // Modes 3 & 4 have WOL enabled

		// Check if network power-on is possible
		if (powerOn && this.config.connectionType === 'tcp') {
			// Mode 1: WOL off, source input wake off - cannot wake via network at all
			if (powerSaveMode === 1) {
				this.log.warn(
					`Power Save Mode ${powerSaveMode}: Cannot wake display via network. ` +
						`WOL and source input wake are both disabled. ` +
						`Please use IR remote/front panel button to wake the display, ` +
						`or change to Mode 3 or 4 (WOL enabled) in display settings.`,
				);
				return;
			}

			// Mode 2: WOL off, source input wake on - can only wake by providing a source signal
			if (powerSaveMode === 2) {
				this.log.warn(
					`Power Save Mode ${powerSaveMode}: Cannot wake display via network command. ` +
						`WOL is disabled. Display will only wake when it detects a source input signal. ` +
						`Change to Mode 3 or 4 (WOL enabled) for network wake capability.`,
				);
				return;
			}

			// Mode 3/4: Send WOL packet first if MAC address is configured
			if (needsWol && this.config.macAddress) {
				if (WakeOnLan.isValidMacAddress(this.config.macAddress)) {
					// Set flag to prevent polling during WOL sequence
					this.wolInProgress = true;
					this.stopPolling();
					// Clear any pending commands that might interfere
					this.commandQueue = [];

					try {
						// Determine broadcast address: use configured value, or derive subnet broadcast from host IP
						const broadcastAddr =
							this.config.broadcastAddress || this.config.host.replace(/\.\d+$/, '.255');
						this.log.info(
							`Sending Wake-on-LAN packets to ${this.config.macAddress} via broadcast ${broadcastAddr} (ports 9 and 7, 3 packets each)`,
						);
						await WakeOnLan.wake(this.config.macAddress, broadcastAddr);
						this.log.info('Wake-on-LAN packets sent successfully');

						// Wait for display to wake up and reconnect with retries
						if (!this.connection.isConnected()) {
							// Disable auto-reconnect during WOL sequence to avoid conflicts
							this.connection.setAutoReconnect(false);
							this.connection.resetReconnectAttempts();

							const maxRetries = 5;
							const retryDelay = 3000; // 3 seconds between retries
							let connected = false;

							for (let attempt = 1; attempt <= maxRetries; attempt++) {
								this.log.info(`Waiting for display to wake up... (attempt ${attempt}/${maxRetries})`);
								await this.delay(retryDelay);

								try {
									this.log.info('Attempting to reconnect to display...');
									await this.connection.connect();
									this.log.info('Reconnected to display');
									connected = true;
									break;
								} catch (connError) {
									if (attempt === maxRetries) {
										this.log.error(
											`Failed to reconnect after WOL: ${(connError as Error).message}`,
										);
									} else {
										this.log.debug(`Reconnect attempt ${attempt} failed, retrying...`);
									}
								}
							}

							// Re-enable auto-reconnect
							this.connection.setAutoReconnect(true);

							if (!connected) {
								this.wolInProgress = false;
								return;
							}

							// Give display time to fully initialize after TCP connect
							this.log.info('Waiting for display to initialize...');
							await this.delay(3000);
						}
					} catch (error) {
						this.log.warn(`Failed to send WOL packet: ${(error as Error).message}`);
						// Re-enable auto-reconnect in case of error
						this.connection.setAutoReconnect(true);
						this.wolInProgress = false;
					}
				} else {
					this.log.warn(`Invalid MAC address configured: ${this.config.macAddress}`);
				}
			}
		}

		this.queueCommand(async () => {
			const cmd = IiyamaProtocol.buildPowerCommand(this.config.monitorId, powerOn);
			await this.connection!.sendCommand(cmd);
			await this.setState('power', powerOn, true);

			// If this was a WOL power-on, now start polling
			if (this.wolInProgress) {
				this.wolInProgress = false;
				this.log.info('WOL sequence complete, starting polling');
				this.startPolling();
			}
		});
	}

	/**
	 * Set input source
	 *
	 * @param source
	 */
	private setInputSource(source: number): void {
		if (!this.connection) {
			return;
		}

		this.queueCommand(async () => {
			const cmd = IiyamaProtocol.buildInputSourceCommand(this.config.monitorId, source);
			await this.connection!.sendCommand(cmd);
			await this.setState('inputSource', source, true);
		});
	}

	/**
	 * Set volume
	 */
	private async setVolume(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const mainVol = await this.getStateAsync('volume.main');
		const audioOutVol = await this.getStateAsync('volume.audioOut');

		if (mainVol && audioOutVol) {
			const main = mainVol.val as number;
			const audioOut = audioOutVol.val as number;

			this.queueCommand(async () => {
				const cmd = IiyamaProtocol.buildVolumeCommand(this.config.monitorId, main, audioOut);
				await this.connection!.sendCommand(cmd);
				await this.setState('volume.main', main, true);
				await this.setState('volume.audioOut', audioOut, true);
			});
		}
	}

	/**
	 * Set video parameters
	 */
	private async setVideoParams(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const brightness = (await this.getStateAsync('video.brightness'))?.val as number;
		const color = (await this.getStateAsync('video.color'))?.val as number;
		const contrast = (await this.getStateAsync('video.contrast'))?.val as number;
		const sharpness = (await this.getStateAsync('video.sharpness'))?.val as number;
		const tint = (await this.getStateAsync('video.tint'))?.val as number;
		const blackLevel = (await this.getStateAsync('video.blackLevel'))?.val as number;
		const gamma = (await this.getStateAsync('video.gamma'))?.val as number;

		if (
			brightness !== undefined &&
			color !== undefined &&
			contrast !== undefined &&
			sharpness !== undefined &&
			tint !== undefined &&
			blackLevel !== undefined &&
			gamma !== undefined
		) {
			this.queueCommand(async () => {
				const cmd = IiyamaProtocol.buildVideoParamsCommand(
					this.config.monitorId,
					brightness,
					color,
					contrast,
					sharpness,
					tint,
					blackLevel,
					gamma,
				);
				await this.connection!.sendCommand(cmd);
				await this.setState('video.brightness', brightness, true);
				await this.setState('video.color', color, true);
				await this.setState('video.contrast', contrast, true);
				await this.setState('video.sharpness', sharpness, true);
				await this.setState('video.tint', tint, true);
				await this.setState('video.blackLevel', blackLevel, true);
				await this.setState('video.gamma', gamma, true);
			});
		}
	}

	/**
	 * Set color temperature
	 *
	 * @param temp
	 */
	private setColorTemperature(temp: number): void {
		if (!this.connection) {
			return;
		}

		this.queueCommand(async () => {
			const cmd = IiyamaProtocol.buildColorTempCommand(this.config.monitorId, temp);
			await this.connection!.sendCommand(cmd);
			await this.setState('video.colorTemperature', temp, true);
		});
	}

	/**
	 * Set picture format
	 *
	 * @param format
	 */
	private setPictureFormat(format: number): void {
		if (!this.connection) {
			return;
		}

		this.queueCommand(async () => {
			const cmd = IiyamaProtocol.buildPictureFormatCommand(this.config.monitorId, format);
			await this.connection!.sendCommand(cmd);
			await this.setState('video.pictureFormat', format, true);
		});
	}

	/**
	 * Set audio parameters
	 */
	private async setAudioParams(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const treble = (await this.getStateAsync('audio.treble'))?.val as number;
		const bass = (await this.getStateAsync('audio.bass'))?.val as number;

		if (treble !== undefined && bass !== undefined) {
			this.queueCommand(async () => {
				const cmd = IiyamaProtocol.buildAudioParamsCommand(this.config.monitorId, treble, bass);
				await this.connection!.sendCommand(cmd);
				await this.setState('audio.treble', treble, true);
				await this.setState('audio.bass', bass, true);
			});
		}
	}

	/**
	 * Auto adjust (VGA only)
	 */
	private autoAdjust(): void {
		if (!this.connection) {
			return;
		}

		this.queueCommand(async () => {
			const cmd = IiyamaProtocol.buildAutoAdjustCommand(this.config.monitorId);
			await this.connection!.sendCommand(cmd, false);
			await this.setState('commands.autoAdjust', false, true);
		});
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Iiyama(options);
} else {
	// otherwise start the instance directly
	(() => new Iiyama())();
}
