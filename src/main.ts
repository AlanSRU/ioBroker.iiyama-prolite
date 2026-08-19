/*
 * Created with @iobroker/create-adapter v3.1.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';
import { ConnectionManager } from './lib/connection-manager';
import { CommandCode, IiyamaProtocol, InputSource } from './lib/iiyama-protocol';
import { WakeOnLan } from './lib/wake-on-lan';

class Iiyama extends utils.Adapter {
	private connection: ConnectionManager | null = null;
	private pollInterval: ioBroker.Interval | undefined;
	private commandQueue: Array<{ run: () => Promise<void>; revertIds?: string[] }> = [];
	private processingQueue = false;
	private wolInProgress = false; // Flag to prevent polling during WOL wake sequence
	/** Last value the display confirmed, used to roll a control back when a command fails. */
	private lastAcked = new Map<string, ioBroker.StateValue>();
	private consecutiveCommandFailures = 0;
	private connectionDegraded = false;
	private readonly maxCommandFailures = 3; // Consecutive failures before info.connection is cleared
	private readonly failureDrainMs = 1000; // Quiet window after a failure, to absorb a late reply
	private standbyReported = false; // Log the 'display is off' notice once per standby period
	private consecutiveConnectionErrors = 0; // Report a repeating connection error once, then demote

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'iiyama-prolite',
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
		// Channel objects, so every state has an intermediate parent object (repochecker E3009)
		const channels: Record<string, string> = {
			info: 'Information',
			volume: 'Volume',
			video: 'Video settings',
			audio: 'Audio settings',
			commands: 'Commands',
		};
		for (const [id, name] of Object.entries(channels)) {
			await this.extendObject(id, {
				type: 'channel',
				common: { name },
				native: {},
			});
		}

		// Connection state - tracks actual device connectivity
		await this.extendObject('info.connection', {
			type: 'state',
			common: {
				name: 'Connection status',
				type: 'boolean',
				def: false,
				role: 'indicator.connected',
				read: true,
				write: false,
			},
			native: {},
		});

		// Standby state (display is off/unreachable but adapter is working)
		await this.extendObject('info.standby', {
			type: 'state',
			common: {
				name: 'Display in standby',
				type: 'boolean',
				def: false,
				role: 'indicator',
				read: true,
				write: false,
			},
			native: {},
		});

		// Power control
		await this.extendObject('power', {
			type: 'state',
			common: {
				name: 'Power',
				type: 'boolean',
				def: false,
				role: 'switch.power',
				read: true,
				write: true,
			},
			native: {},
		});

		// Input source
		await this.extendObject('inputSource', {
			type: 'state',
			common: {
				name: 'Input Source',
				type: 'number',
				def: 0,
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
		await this.extendObject('volume.main', {
			type: 'state',
			common: {
				name: 'Main Volume',
				type: 'number',
				def: 0,
				role: 'level.volume',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.extendObject('volume.audioOut', {
			type: 'state',
			common: {
				name: 'Audio Out Volume',
				type: 'number',
				def: 0,
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
		await this.extendObject('video.brightness', {
			type: 'state',
			common: {
				name: 'Brightness',
				type: 'number',
				def: 0,
				role: 'level.dimmer',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.extendObject('video.contrast', {
			type: 'state',
			common: {
				name: 'Contrast',
				type: 'number',
				def: 0,
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.extendObject('video.color', {
			type: 'state',
			common: {
				name: 'Color',
				type: 'number',
				def: 0,
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.extendObject('video.sharpness', {
			type: 'state',
			common: {
				name: 'Sharpness',
				type: 'number',
				def: 0,
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.extendObject('video.tint', {
			type: 'state',
			common: {
				name: 'Tint',
				type: 'number',
				def: 0,
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.extendObject('video.blackLevel', {
			type: 'state',
			common: {
				name: 'Black Level',
				type: 'number',
				def: 0,
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
				unit: '%',
			},
			native: {},
		});

		await this.extendObject('video.gamma', {
			type: 'state',
			common: {
				name: 'Gamma',
				type: 'number',
				def: 0,
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
		await this.extendObject('video.colorTemperature', {
			type: 'state',
			common: {
				name: 'Color Temperature',
				type: 'number',
				def: 0,
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
		await this.extendObject('video.pictureFormat', {
			type: 'state',
			common: {
				name: 'Picture Format',
				type: 'number',
				def: 0,
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
		await this.extendObject('audio.treble', {
			type: 'state',
			common: {
				name: 'Treble',
				type: 'number',
				def: 0,
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
			},
			native: {},
		});

		await this.extendObject('audio.bass', {
			type: 'state',
			common: {
				name: 'Bass',
				type: 'number',
				def: 0,
				role: 'level',
				read: true,
				write: true,
				min: 0,
				max: 100,
			},
			native: {},
		});

		// Information
		await this.extendObject('info.operatingHours', {
			type: 'state',
			common: {
				name: 'Operating Hours',
				type: 'number',
				def: 0,
				role: 'value',
				read: true,
				write: false,
				unit: 'hours',
			},
			native: {},
		});

		await this.extendObject('info.serialCode', {
			type: 'state',
			common: {
				name: 'Serial Code',
				type: 'string',
				def: '',
				role: 'text',
				read: true,
				write: false,
			},
			native: {},
		});

		// Commands
		await this.extendObject('commands.autoAdjust', {
			type: 'state',
			common: {
				name: 'Auto Adjust (VGA only)',
				type: 'boolean',
				def: false,
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
		await this.ackState('info.connection', false);
		await this.ackState('info.standby', false);

		try {
			this.connection = new ConnectionManager(
				{
					type: this.config.connectionType,
					host: this.config.host,
					port: this.config.port,
					serialPort: this.config.serialPort,
					baudRate: this.config.baudRate,
				},
				this,
			);

			this.connection.on('connected', () => {
				this.log.info('Connected to display');
				// Start the failure tracking fresh. The handler below reports the link as up, so
				// leaving connectionDegraded latched would block onCommandFailure from ever
				// clearing info.connection again - a display that reconnects but still answers
				// nothing (a mismatched monitor ID does this) would read as healthy forever.
				this.consecutiveCommandFailures = 0;
				this.connectionDegraded = false;
				this.standbyReported = false;
				this.consecutiveConnectionErrors = 0;
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
				this.consecutiveCommandFailures = 0;
				this.connectionDegraded = false;
				this.setState('info.connection', false, true);
				this.stopPolling();
			});

			this.connection.on('error', (error: Error) => {
				// EHOSTUNREACH/ECONNREFUSED are expected while a display is off or in standby.
				const expected = error.message.includes('EHOSTUNREACH') || error.message.includes('ECONNREFUSED');
				this.consecutiveConnectionErrors++;

				// Every other repeating failure in the adapter reports once and then demotes; this
				// path needs the same treatment. A serial port that cannot be opened (dongle
				// unplugged, wrong path, missing dialout group) retries ten times and then once
				// every 30 s indefinitely, which would otherwise be ~2,880 error lines a day and a
				// permanently lit error badge in admin.
				if (expected || this.consecutiveConnectionErrors > 1) {
					this.log.debug(
						`Connection error (${this.consecutiveConnectionErrors} consecutive, display may be off): ${error.message}`,
					);
				} else {
					this.log.error(`Connection error: ${error.message}`);
				}
			});

			this.connection.on('reconnecting', (attempt: number) => {
				this.log.debug(`Reconnecting to display (attempt ${attempt})`);
			});

			this.connection.on('maxReconnectReached', () => {
				// Fires again on every standby poll cycle for as long as the display stays off, so
				// report it once. A display switched off overnight would otherwise log ~2,880
				// identical lines and write info.standby just as often, inflating any history on it.
				if (this.standbyReported) {
					return;
				}

				this.standbyReported = true;
				this.log.info(
					'Max reconnection attempts reached - display appears to be off. ' +
						'The adapter keeps checking and reconnects automatically when it comes back on.',
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

		// Skip this poll cycle if the previous one (or a user command) has not drained yet.
		// Each cycle enqueues 9 commands with a 5 s response timeout each; on a slow/unresponsive
		// display the queue could otherwise grow faster than it drains and back up indefinitely.
		// Also skip while a command is still in-flight (queue empty but processingQueue set), so a
		// tick landing in that window can't append another batch to the running loop.
		if (this.commandQueue.length > 0 || this.processingQueue) {
			this.log.debug('Skipping poll cycle: previous cycle still processing');
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
	 * Write a value the display has confirmed, remembering it so a later failed command can
	 * roll the control back to it.
	 *
	 * @param id - State id, relative to the instance namespace
	 * @param value - The confirmed value
	 */
	private async ackState(id: string, value: ioBroker.StateValue): Promise<void> {
		this.lastAcked.set(id, value);
		await this.setState(id, value, true);
	}

	/**
	 * Queue a command for execution
	 *
	 * @param command
	 * @param revertIds - States to roll back to their last confirmed values if the command fails,
	 *   so the UI does not keep showing values the display never accepted.
	 */
	private queueCommand(command: () => Promise<void>, revertIds?: string[]): void {
		this.commandQueue.push({ run: command, revertIds });
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
			const entry = this.commandQueue.shift();
			if (entry) {
				try {
					await entry.run();
					this.onCommandSuccess();
					// Small delay between commands
					await this.delay(100);
				} catch (error) {
					await this.onCommandFailure(entry.revertIds, error as Error);
					// Let a late reply to the command that just failed land while nothing is
					// waiting for it, so it is discarded instead of resolving the NEXT command.
					// Read commands are correlated by command code, but the protocol spec does not
					// document the reply code for write commands, so those cannot be matched the
					// same way - this quiet window is what protects them.
					await this.delay(this.failureDrainMs);
				}
			}
		}

		this.processingQueue = false;
	}

	/**
	 * Note that the display answered, clearing any degraded state.
	 */
	private onCommandSuccess(): void {
		this.consecutiveCommandFailures = 0;

		if (this.connectionDegraded) {
			this.connectionDegraded = false;
			this.log.info('Display is responding again');
			void this.ackState('info.connection', true);
			void this.ackState('info.standby', false);
		}
	}

	/**
	 * Handle a command that could not be delivered or was never answered.
	 *
	 * @param revertIds - States to roll back to their last confirmed values, if any
	 * @param error - The failure
	 */
	private async onCommandFailure(revertIds: string[] | undefined, error: Error): Promise<void> {
		this.consecutiveCommandFailures++;

		// Report the first failure of a run loudly, then demote. An unresponsive display would
		// otherwise emit one error line per command on every poll cycle, indefinitely.
		if (this.consecutiveCommandFailures === 1) {
			this.log.error(`Error executing command: ${error.message}`);
		} else {
			this.log.debug(
				`Error executing command (${this.consecutiveCommandFailures} consecutive): ${error.message}`,
			);
		}

		// Roll the control back, so a switch or slider does not sit there showing a value the
		// display never accepted with nothing to correct it.
		for (const id of revertIds ?? []) {
			if (this.lastAcked.has(id)) {
				await this.setState(id, this.lastAcked.get(id)!, true);
			}
		}

		// The socket can be up while the display answers nothing at all - a monitor ID that does
		// not match the display does exactly this - so socket state alone is not a liveness
		// signal. Require several consecutive failures so one timeout cannot flap the flag.
		if (!this.connectionDegraded && this.consecutiveCommandFailures >= this.maxCommandFailures) {
			this.connectionDegraded = true;
			this.log.warn(
				`Display has not answered ${this.consecutiveCommandFailures} consecutive commands - ` +
					`marking the connection as down (check that Monitor ID ${this.config.monitorId} matches the display)`,
			);
			await this.ackState('info.connection', false);
			await this.ackState('info.standby', true);
		}
	}

	/**
	 * Get power state
	 */
	private async getPowerState(): Promise<void> {
		if (!this.connection) {
			return;
		}

		const cmd = IiyamaProtocol.buildGetPowerCommand(this.config.monitorId);
		const response = await this.connection.sendCommand(cmd, true, CommandCode.POWER_STATE_GET);

		if (response) {
			const powerOn = IiyamaProtocol.parsePowerState(response);
			if (powerOn !== null) {
				await this.ackState('power', powerOn);
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
		const response = await this.connection.sendCommand(cmd, true, CommandCode.CURRENT_SOURCE_GET);

		if (response) {
			const source = IiyamaProtocol.parseInputSource(response);
			if (source !== null) {
				await this.ackState('inputSource', source);
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
		const response = await this.connection.sendCommand(cmd, true, CommandCode.VOLUME_GET);

		if (response) {
			const volume = IiyamaProtocol.parseVolume(response);
			if (volume) {
				await this.ackState('volume.main', volume.volume);
				await this.ackState('volume.audioOut', volume.audioOut);
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
		const response = await this.connection.sendCommand(cmd, true, CommandCode.VIDEO_PARAMS_GET);

		if (response) {
			const params = IiyamaProtocol.parseVideoParams(response);
			if (params) {
				await this.ackState('video.brightness', params.brightness);
				await this.ackState('video.color', params.color);
				await this.ackState('video.contrast', params.contrast);
				await this.ackState('video.sharpness', params.sharpness);
				await this.ackState('video.tint', params.tint);
				await this.ackState('video.blackLevel', params.blackLevel);
				await this.ackState('video.gamma', params.gamma);
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
		const response = await this.connection.sendCommand(cmd, true, CommandCode.COLOR_TEMP_GET);

		if (response && response.data.length >= 1) {
			await this.ackState('video.colorTemperature', response.data[0]);
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
		const response = await this.connection.sendCommand(cmd, true, CommandCode.PICTURE_FORMAT_GET);

		if (response && response.data.length >= 1) {
			await this.ackState('video.pictureFormat', response.data[0]);
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
		const response = await this.connection.sendCommand(cmd, true, CommandCode.AUDIO_PARAMS_GET);

		if (response && response.data.length >= 2) {
			await this.ackState('audio.treble', response.data[0]);
			await this.ackState('audio.bass', response.data[1]);
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
		const response = await this.connection.sendCommand(cmd, true, CommandCode.OPERATING_HOURS_GET);

		if (response) {
			const hours = IiyamaProtocol.parseOperatingHours(response);
			if (hours !== null) {
				await this.ackState('info.operatingHours', hours);
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
		const response = await this.connection.sendCommand(cmd, true, CommandCode.SERIAL_CODE_GET);

		if (response) {
			const serialCode = IiyamaProtocol.parseSerialCode(response);
			if (serialCode !== null) {
				await this.ackState('info.serialCode', serialCode);
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
	 * Redact a MAC address for logging, keeping only the last three octets.
	 * MAC addresses can be treated as personal data in some jurisdictions, so we
	 * avoid writing them to the log in full. e.g. AA:BB:CC:DD:EE:FF -> **:**:**:DD:EE:FF
	 *
	 * @param mac - MAC address (any common separator) or undefined
	 */
	private redactMac(mac: string | undefined): string {
		if (!mac) {
			return '(none)';
		}
		const octets = mac.split(/[:-]/);
		if (octets.length !== 6) {
			// Not a well-formed MAC - redact everything rather than leak an unexpected value
			return '**:**:**:**:**:**';
		}
		return ['**', '**', '**', octets[3], octets[4], octets[5]].join(':');
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
			// Modes 1 and 2 govern how an OFF display can be woken, so they only apply when the
			// display is actually unreachable. With the socket up the display is already on and
			// the power command is simply sent below - otherwise a scene asserting power=true on
			// a display that is on would warn and drive the state to false until the next poll.
			// (Modes 3/4 are deliberately not gated this way: with WOL enabled the display keeps
			// its LAN interface alive in standby, so the socket can be up while it is off.)
			const displayReachable = this.connection.isConnected();

			// Mode 1: WOL off, source input wake off - cannot wake via network at all
			if (powerSaveMode === 1 && !displayReachable) {
				this.log.warn(
					`Power Save Mode ${powerSaveMode}: Cannot wake display via network. ` +
						`WOL and source input wake are both disabled. ` +
						`Please use IR remote/front panel button to wake the display, ` +
						`or change to Mode 3 or 4 (WOL enabled) in display settings.`,
				);
				// The display stays off, so snap the control back - nothing else will correct it
				// while the socket is down and polling is stopped.
				await this.ackState('power', false);
				return;
			}

			// Mode 2: WOL off, source input wake on - can only wake by providing a source signal
			if (powerSaveMode === 2 && !displayReachable) {
				this.log.warn(
					`Power Save Mode ${powerSaveMode}: Cannot wake display via network command. ` +
						`WOL is disabled. Display will only wake when it detects a source input signal. ` +
						`Change to Mode 3 or 4 (WOL enabled) for network wake capability.`,
				);
				await this.ackState('power', false);
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
							`Sending Wake-on-LAN packets to ${this.redactMac(this.config.macAddress)} via broadcast ${broadcastAddr} (ports 9 and 7, 3 packets each)`,
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
								this.endWolSequence();
								// The display never came back, so the switch must not stay on.
								await this.ackState('power', false);
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
						this.endWolSequence();
					}
				} else {
					this.log.warn(`Invalid MAC address configured: ${this.redactMac(this.config.macAddress)}`);
				}
			}
		}

		this.queueCommand(async () => {
			try {
				const cmd = IiyamaProtocol.buildPowerCommand(this.config.monitorId, powerOn);
				await this.connection!.sendCommand(cmd);
				await this.ackState('power', powerOn);
			} finally {
				// Must run even when the power command fails. The WOL branch stopped polling and
				// set wolInProgress; if a failure left that flag set, the 'connected' handler
				// (gated on !wolInProgress) could never restart polling either, so the instance
				// would go silent until it was restarted by hand.
				this.endWolSequence();
			}
		}, ['power']);
	}

	/**
	 * Clear the WOL guard and resume polling, if a WOL sequence was in progress.
	 *
	 * Safe to call unconditionally and more than once.
	 */
	private endWolSequence(): void {
		if (!this.wolInProgress) {
			return;
		}

		this.wolInProgress = false;

		if (this.connection?.isConnected()) {
			this.log.info('WOL sequence finished, resuming polling');
			this.startPolling();
		} else {
			// Not connected: leave polling stopped. Clearing the flag is what matters - the
			// 'connected' handler is gated on it and will start polling once the display is back.
			this.log.debug('WOL sequence finished while disconnected; polling resumes on reconnect');
		}
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
			await this.ackState('inputSource', source);
		}, ['inputSource']);
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
				await this.ackState('volume.main', main);
				await this.ackState('volume.audioOut', audioOut);
			}, ['volume.main', 'volume.audioOut']);
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
				await this.ackState('video.brightness', brightness);
				await this.ackState('video.color', color);
				await this.ackState('video.contrast', contrast);
				await this.ackState('video.sharpness', sharpness);
				await this.ackState('video.tint', tint);
				await this.ackState('video.blackLevel', blackLevel);
				await this.ackState('video.gamma', gamma);
			}, [
				'video.brightness',
				'video.color',
				'video.contrast',
				'video.sharpness',
				'video.tint',
				'video.blackLevel',
				'video.gamma',
			]);
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
			await this.ackState('video.colorTemperature', temp);
		}, ['video.colorTemperature']);
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
			await this.ackState('video.pictureFormat', format);
		}, ['video.pictureFormat']);
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
				await this.ackState('audio.treble', treble);
				await this.ackState('audio.bass', bass);
			}, ['audio.treble', 'audio.bass']);
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
			await this.ackState('commands.autoAdjust', false);
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
