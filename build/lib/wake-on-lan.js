"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var wake_on_lan_exports = {};
__export(wake_on_lan_exports, {
  WakeOnLan: () => WakeOnLan
});
module.exports = __toCommonJS(wake_on_lan_exports);
var dgram = __toESM(require("dgram"));
class WakeOnLan {
  /**
   * Send a Wake-on-LAN magic packet to wake up a device
   * @param macAddress MAC address in format AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF
   * @param broadcastAddress Broadcast address (default: 255.255.255.255)
   * @param port UDP port (default: 9)
   */
  static async wake(macAddress, broadcastAddress = "255.255.255.255", port = 9) {
    const macBuffer = this.parseMacAddress(macAddress);
    const magicPacket = this.createMagicPacket(macBuffer);
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      socket.on("error", (err) => {
        socket.close();
        reject(err);
      });
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(magicPacket, 0, magicPacket.length, port, broadcastAddress, (err) => {
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
   */
  static parseMacAddress(macAddress) {
    const cleanMac = macAddress.replace(/[:\-]/g, "").toUpperCase();
    if (cleanMac.length !== 12 || !/^[0-9A-F]+$/.test(cleanMac)) {
      throw new Error(`Invalid MAC address: ${macAddress}`);
    }
    const bytes = [];
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
   */
  static createMagicPacket(macBuffer) {
    const packet = Buffer.alloc(6 + 16 * 6);
    for (let i = 0; i < 6; i++) {
      packet[i] = 255;
    }
    for (let i = 0; i < 16; i++) {
      macBuffer.copy(packet, 6 + i * 6);
    }
    return packet;
  }
  /**
   * Validate a MAC address format
   */
  static isValidMacAddress(macAddress) {
    if (!macAddress) {
      return false;
    }
    const cleanMac = macAddress.replace(/[:\-]/g, "").toUpperCase();
    return cleanMac.length === 12 && /^[0-9A-F]+$/.test(cleanMac);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  WakeOnLan
});
//# sourceMappingURL=wake-on-lan.js.map
