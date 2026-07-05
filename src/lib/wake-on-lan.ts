/**
 * Wake-on-LAN utility for iiyama displays
 */

import * as dgram from 'node:dgram';

export class WakeOnLan {
	/**
	 * Send Wake-on-LAN magic packets to wake up a device.
	 * Sends multiple packets to both standard WOL ports for reliability.
	 *
	 * @param macAddress MAC address in format AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF
	 * @param broadcastAddress Broadcast address (default: 255.255.255.255)
	 */
	public static async wake(macAddress: string, broadcastAddress = '255.255.255.255'): Promise<void> {
		const macBuffer = this.parseMacAddress(macAddress);
		const magicPacket = this.createMagicPacket(macBuffer);

		// Send to both standard WOL ports, 3 packets each, for reliability
		const ports = [9, 7];
		const sendCount = 3;
		const delayMs = 100;

		for (const port of ports) {
			for (let i = 0; i < sendCount; i++) {
				await this.sendPacket(magicPacket, broadcastAddress, port);
				if (i < sendCount - 1) {
					await new Promise(resolve => setTimeout(resolve, delayMs));
				}
			}
		}
	}

	/**
	 * Send a single UDP broadcast packet
	 *
	 * @param packet
	 * @param broadcastAddress
	 * @param port
	 */
	private static async sendPacket(packet: Buffer, broadcastAddress: string, port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

			socket.on('error', err => {
				socket.close();
				reject(err);
			});

			socket.bind(0, '0.0.0.0', () => {
				socket.setBroadcast(true);
				socket.send(packet, 0, packet.length, port, broadcastAddress, err => {
					socket.close();
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		});
	}

	/**
	 * Parse a MAC address string into a Buffer
	 *
	 * @param macAddress
	 */
	private static parseMacAddress(macAddress: string): Buffer {
		// Remove any separators and convert to uppercase
		const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();

		if (cleanMac.length !== 12 || !/^[0-9A-F]+$/.test(cleanMac)) {
			throw new Error(`Invalid MAC address: ${macAddress}`);
		}

		const bytes: number[] = [];
		for (let i = 0; i < 12; i += 2) {
			bytes.push(parseInt(cleanMac.substring(i, i + 2), 16));
		}

		return Buffer.from(bytes);
	}

	/**
	 * Create a Wake-on-LAN magic packet
	 * The magic packet consists of:
	 * - 6 bytes of 0xFF (synchronization stream)
	 * - Target MAC address repeated 16 times
	 *
	 * @param macBuffer
	 */
	private static createMagicPacket(macBuffer: Buffer): Buffer {
		const packet = Buffer.alloc(6 + 16 * 6);

		// Fill first 6 bytes with 0xFF
		for (let i = 0; i < 6; i++) {
			packet[i] = 0xff;
		}

		// Repeat MAC address 16 times
		for (let i = 0; i < 16; i++) {
			macBuffer.copy(packet, 6 + i * 6);
		}

		return packet;
	}

	/**
	 * Validate a MAC address format
	 *
	 * @param macAddress
	 */
	public static isValidMacAddress(macAddress: string): boolean {
		if (!macAddress) {
			return false;
		}
		const cleanMac = macAddress.replace(/[:-]/g, '').toUpperCase();
		return cleanMac.length === 12 && /^[0-9A-F]+$/.test(cleanMac);
	}
}
