/**
 * iiyama RS232/TCP Protocol Handler
 * Implements the iiyama ProLite communication protocol
 */

export enum CommandCode {
	// Platform and version
	PLATFORM_VERSION = 0xa2,
	MODEL_NUMBER_FW = 0xa1,

	// Power control
	POWER_STATE_GET = 0x19,
	POWER_STATE_SET = 0x18,
	POWER_COLD_START_GET = 0xa4,
	POWER_COLD_START_SET = 0xa3,

	// Lock functions
	IR_LOCK_GET = 0x1d,
	IR_LOCK_SET = 0x1c,
	KEYPAD_LOCK_GET = 0x1b,
	KEYPAD_LOCK_SET = 0x1a,

	// Input sources
	INPUT_SOURCE_SET = 0xac,
	CURRENT_SOURCE_GET = 0xad,

	// Video parameters
	VIDEO_PARAMS_GET = 0x33,
	VIDEO_PARAMS_SET = 0x32,
	COLOR_TEMP_GET = 0x35,
	COLOR_TEMP_SET = 0x34,
	COLOR_PARAMS_GET = 0x37,
	COLOR_PARAMS_SET = 0x36,
	PICTURE_FORMAT_GET = 0x3b,
	PICTURE_FORMAT_SET = 0x3a,

	// Audio
	VOLUME_GET = 0x45,
	VOLUME_SET = 0x44,
	VOLUME_LIMITS_SET = 0xb8,
	AUDIO_PARAMS_GET = 0x43,
	AUDIO_PARAMS_SET = 0x42,

	// Miscellaneous
	OPERATING_HOURS_GET = 0x0f,
	AUTO_ADJUST = 0x70,
	SERIAL_CODE_GET = 0x15,

	// Scheduling
	SCHEDULING_GET = 0x5b,
	SCHEDULING_SET = 0x5a,

	// Language
	LANGUAGE_GET = 0xc0,
	LANGUAGE_SET = 0xc1,

	// Pixel Shift
	PIXEL_SHIFT_GET = 0xb1,
	PIXEL_SHIFT_SET = 0xb2,
}

export enum InputSource {
	NULL = 0x00,
	VIDEO = 0x01,
	S_VIDEO = 0x02,
	COMPONENT = 0x03,
	VGA = 0x05,
	HDMI_2 = 0x06,
	DISPLAY_PORT_2 = 0x07,
	USB_2 = 0x08,
	CARD_DVI_D = 0x09,
	DISPLAY_PORT = 0x0a,
	CARD_OPS = 0x0b,
	USB = 0x0c,
	HDMI = 0x0d,
	DVI_D = 0x0e,
	HDMI_3 = 0x0f,
	BROWSER = 0x10,
	SMARTCMS = 0x11,
	DMS = 0x12,
	INTERNAL_STORAGE = 0x13,
	MEDIA_PLAYER = 0x16,
	PDF_PLAYER = 0x17,
	CUSTOM = 0x18,
	HDMI_4 = 0x19,
}

export enum PowerState {
	OFF = 0x01,
	ON = 0x02,
}

export enum ResponseHeader {
	REPORT = 0x21,
}

export interface IiyamaCommand {
	monitorId: number;
	commandCode: number;
	data: number[];
}

export interface IiyamaResponse {
	monitorId: number;
	commandCode: number;
	data: number[];
	isAck: boolean;
}

export class IiyamaProtocol {
	private static readonly HEADER = 0xa6;
	private static readonly CATEGORY = 0x00;
	private static readonly PAGE = 0x00;
	private static readonly DATA_CONTROL = 0x01;

	/**
	 * Build a command packet
	 * Packet format: [HEADER][MONITOR_ID][CATEGORY][PAGE][MSG_TYPE][LENGTH][DATA_CONTROL][CMD_CODE][DATA...][CHECKSUM]
	 */
	public static buildCommand(monitorId: number, commandCode: number, data: number[] = []): Buffer {
		const length = data.length + 3; // data control + command code + data + 1
		const packet: number[] = [
			this.HEADER,
			monitorId,
			this.CATEGORY,
			this.PAGE,
			0x00, // Message type
			length,
			this.DATA_CONTROL,
			commandCode,
			...data,
		];

		// Calculate checksum (XOR of all bytes)
		const checksum = packet.reduce((acc, byte) => acc ^ byte, 0);
		packet.push(checksum);

		return Buffer.from(packet);
	}

	/**
	 * Parse a response packet
	 * Response format: [HEADER][MONITOR_ID][CATEGORY][PAGE][LENGTH][DATA_CONTROL][CMD_CODE][DATA...][CHECKSUM]
	 * Note: Response format does NOT have the message type byte that commands have
	 */
	public static parseResponse(buffer: Buffer): IiyamaResponse | null {
		if (buffer.length < 9) {
			return null;
		}

		// Verify checksum
		const receivedChecksum = buffer[buffer.length - 1];
		let calculatedChecksum = 0;
		for (let i = 0; i < buffer.length - 1; i++) {
			calculatedChecksum ^= buffer[i];
		}

		if (receivedChecksum !== calculatedChecksum) {
			return null;
		}

		const header = buffer[0];
		const monitorId = buffer[1];
		// buffer[2] = category
		// buffer[3] = page
		// buffer[4] = length
		// buffer[5] = data control
		const commandCode = buffer[6];
		const data: number[] = [];

		for (let i = 7; i < buffer.length - 1; i++) {
			data.push(buffer[i]);
		}

		return {
			monitorId,
			commandCode,
			data,
			isAck: header === ResponseHeader.REPORT,
		};
	}

	/**
	 * Build power state command
	 */
	public static buildPowerCommand(monitorId: number, powerOn: boolean): Buffer {
		return this.buildCommand(monitorId, CommandCode.POWER_STATE_SET, [powerOn ? PowerState.ON : PowerState.OFF]);
	}

	/**
	 * Build get power state command
	 */
	public static buildGetPowerCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.POWER_STATE_GET);
	}

	/**
	 * Build input source command
	 */
	public static buildInputSourceCommand(monitorId: number, source: InputSource): Buffer {
		return this.buildCommand(monitorId, CommandCode.INPUT_SOURCE_SET, [source, 0x00, 0x00, 0x00]);
	}

	/**
	 * Build get current source command
	 */
	public static buildGetCurrentSourceCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.CURRENT_SOURCE_GET);
	}

	/**
	 * Build volume command
	 */
	public static buildVolumeCommand(monitorId: number, volume: number, audioOut: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.VOLUME_SET, [volume, audioOut]);
	}

	/**
	 * Build get volume command
	 */
	public static buildGetVolumeCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.VOLUME_GET);
	}

	/**
	 * Build video parameters command
	 */
	public static buildVideoParamsCommand(
		monitorId: number,
		brightness: number,
		color: number,
		contrast: number,
		sharpness: number,
		tint: number,
		blackLevel: number,
		gamma: number,
	): Buffer {
		return this.buildCommand(monitorId, CommandCode.VIDEO_PARAMS_SET, [
			brightness,
			color,
			contrast,
			sharpness,
			tint,
			blackLevel,
			gamma,
		]);
	}

	/**
	 * Build get video parameters command
	 */
	public static buildGetVideoParamsCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.VIDEO_PARAMS_GET);
	}

	/**
	 * Build color temperature command
	 */
	public static buildColorTempCommand(monitorId: number, colorTemp: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.COLOR_TEMP_SET, [colorTemp]);
	}

	/**
	 * Build get color temperature command
	 */
	public static buildGetColorTempCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.COLOR_TEMP_GET);
	}

	/**
	 * Build picture format command
	 */
	public static buildPictureFormatCommand(monitorId: number, format: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.PICTURE_FORMAT_SET, [format]);
	}

	/**
	 * Build get picture format command
	 */
	public static buildGetPictureFormatCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.PICTURE_FORMAT_GET);
	}

	/**
	 * Build audio parameters command
	 */
	public static buildAudioParamsCommand(monitorId: number, treble: number, bass: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.AUDIO_PARAMS_SET, [treble, bass]);
	}

	/**
	 * Build get audio parameters command
	 */
	public static buildGetAudioParamsCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.AUDIO_PARAMS_GET);
	}

	/**
	 * Build get operating hours command
	 */
	public static buildGetOperatingHoursCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.OPERATING_HOURS_GET, [0x02]);
	}

	/**
	 * Build get serial code command
	 */
	public static buildGetSerialCodeCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.SERIAL_CODE_GET);
	}

	/**
	 * Build auto adjust command (VGA only)
	 */
	public static buildAutoAdjustCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.AUTO_ADJUST, [0x40, 0x00]);
	}

	/**
	 * Build IR lock command
	 */
	public static buildIRLockCommand(monitorId: number, lockState: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.IR_LOCK_SET, [lockState]);
	}

	/**
	 * Build get IR lock command
	 */
	public static buildGetIRLockCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.IR_LOCK_GET);
	}

	/**
	 * Build keypad lock command
	 */
	public static buildKeypadLockCommand(monitorId: number, lockState: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.KEYPAD_LOCK_SET, [lockState]);
	}

	/**
	 * Build get keypad lock command
	 */
	public static buildGetKeypadLockCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.KEYPAD_LOCK_GET);
	}

	/**
	 * Build language command
	 */
	public static buildLanguageCommand(monitorId: number, language: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.LANGUAGE_SET, [language]);
	}

	/**
	 * Build get language command
	 */
	public static buildGetLanguageCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.LANGUAGE_GET);
	}

	/**
	 * Build pixel shift command
	 */
	public static buildPixelShiftCommand(monitorId: number, value: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.PIXEL_SHIFT_SET, [value]);
	}

	/**
	 * Build get pixel shift command
	 */
	public static buildGetPixelShiftCommand(monitorId: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.PIXEL_SHIFT_GET);
	}

	/**
	 * Build get model/FW version command
	 */
	public static buildGetModelFWCommand(monitorId: number, type: number): Buffer {
		return this.buildCommand(monitorId, CommandCode.MODEL_NUMBER_FW, [type]);
	}

	/**
	 * Parse power state from response
	 */
	public static parsePowerState(response: IiyamaResponse): boolean | null {
		if (response.commandCode === CommandCode.POWER_STATE_GET && response.data.length >= 1) {
			return response.data[0] === PowerState.ON;
		}
		return null;
	}

	/**
	 * Parse input source from response
	 */
	public static parseInputSource(response: IiyamaResponse): InputSource | null {
		if (response.commandCode === CommandCode.CURRENT_SOURCE_GET && response.data.length >= 1) {
			return response.data[0] as InputSource;
		}
		return null;
	}

	/**
	 * Parse volume from response
	 */
	public static parseVolume(response: IiyamaResponse): { volume: number; audioOut: number } | null {
		if (response.commandCode === CommandCode.VOLUME_GET && response.data.length >= 2) {
			return {
				volume: response.data[0],
				audioOut: response.data[1],
			};
		}
		return null;
	}

	/**
	 * Parse video parameters from response
	 */
	public static parseVideoParams(response: IiyamaResponse): {
		brightness: number;
		color: number;
		contrast: number;
		sharpness: number;
		tint: number;
		blackLevel: number;
		gamma: number;
	} | null {
		if (response.commandCode === CommandCode.VIDEO_PARAMS_GET && response.data.length >= 7) {
			return {
				brightness: response.data[0],
				color: response.data[1],
				contrast: response.data[2],
				sharpness: response.data[3],
				tint: response.data[4],
				blackLevel: response.data[5],
				gamma: response.data[6],
			};
		}
		return null;
	}

	/**
	 * Parse operating hours from response
	 */
	public static parseOperatingHours(response: IiyamaResponse): number | null {
		if (response.commandCode === CommandCode.OPERATING_HOURS_GET && response.data.length >= 2) {
			// MSByte and LSByte form 16-bit value
			return (response.data[0] << 8) | response.data[1];
		}
		return null;
	}

	/**
	 * Parse serial code from response
	 */
	public static parseSerialCode(response: IiyamaResponse): string | null {
		if (response.commandCode === CommandCode.SERIAL_CODE_GET && response.data.length >= 1) {
			// Convert ASCII bytes to string
			return String.fromCharCode(...response.data);
		}
		return null;
	}
}
