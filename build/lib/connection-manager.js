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
var connection_manager_exports = {};
__export(connection_manager_exports, {
  ConnectionManager: () => ConnectionManager
});
module.exports = __toCommonJS(connection_manager_exports);
var import_events = require("events");
var net = __toESM(require("net"));
var import_serialport = require("serialport");
var import_iiyama_protocol = require("./iiyama-protocol");
class ConnectionManager extends import_events.EventEmitter {
  constructor(config, log) {
    super();
    this.config = config;
    this.log = log;
  }
  client = null;
  connected = false;
  buffer = Buffer.alloc(0);
  responseTimeout = null;
  reconnectTimeout = null;
  reconnectAttempts = 0;
  maxReconnectAttempts = 10;
  reconnectDelay = 5e3;
  autoReconnectEnabled = true;
  /**
   * Enable or disable auto-reconnect
   */
  setAutoReconnect(enabled) {
    this.autoReconnectEnabled = enabled;
    if (!enabled && this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
  /**
   * Reset reconnect attempts counter
   */
  resetReconnectAttempts() {
    this.reconnectAttempts = 0;
  }
  /**
   * Connect to the display
   */
  async connect() {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        return resolve();
      }
      if (this.config.type === "tcp") {
        this.connectTCP(resolve, reject);
      } else {
        this.connectSerial(resolve, reject);
      }
    });
  }
  /**
   * Connect via TCP/IP
   */
  connectTCP(resolve, reject) {
    if (!this.config.host || !this.config.port) {
      return reject(new Error("TCP connection requires host and port"));
    }
    this.client = new net.Socket();
    const tcpClient = this.client;
    tcpClient.connect(this.config.port, this.config.host, () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      tcpClient.setKeepAlive(true, 1e4);
      this.emit("connected");
      resolve();
    });
    tcpClient.on("data", (data) => {
      this.handleData(data);
    });
    tcpClient.on("error", (error) => {
      this.emit("error", error);
      if (!this.connected) {
        reject(error);
      }
    });
    tcpClient.on("close", () => {
      this.handleDisconnect();
    });
    tcpClient.on("timeout", () => {
      this.log.warn("TCP connection idle timeout - connection may be stale");
    });
  }
  /**
   * Connect via Serial
   */
  connectSerial(resolve, reject) {
    if (!this.config.serialPort || !this.config.baudRate) {
      return reject(new Error("Serial connection requires serialPort and baudRate"));
    }
    this.client = new import_serialport.SerialPort({
      path: this.config.serialPort,
      baudRate: this.config.baudRate,
      dataBits: 8,
      parity: "none",
      stopBits: 1
    });
    const serialClient = this.client;
    serialClient.on("open", () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit("connected");
      resolve();
    });
    serialClient.on("data", (data) => {
      this.handleData(data);
    });
    serialClient.on("error", (error) => {
      this.emit("error", error);
      if (!this.connected) {
        reject(error);
      }
    });
    serialClient.on("close", () => {
      this.handleDisconnect();
    });
  }
  /**
   * Handle incoming data
   */
  handleData(data) {
    this.log.debug(`Received data: ${data.toString("hex")} (${data.length} bytes)`);
    this.buffer = Buffer.concat([this.buffer, data]);
    this.parseBuffer();
  }
  /**
   * Parse buffer for complete responses
   * Note: Response format does NOT have message type byte (unlike commands)
   */
  parseBuffer() {
    while (this.buffer.length >= 9) {
      const headerIndex = this.buffer.indexOf(33);
      if (headerIndex === -1) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (headerIndex > 0) {
        this.buffer = this.buffer.slice(headerIndex);
      }
      if (this.buffer.length < 5) {
        return;
      }
      const length = this.buffer[4];
      const totalLength = length + 5;
      if (this.buffer.length < totalLength) {
        return;
      }
      const packet = this.buffer.slice(0, totalLength);
      this.buffer = this.buffer.slice(totalLength);
      const response = import_iiyama_protocol.IiyamaProtocol.parseResponse(packet);
      if (response) {
        this.log.debug(`Valid response received: monitorId=${response.monitorId}, commandCode=0x${response.commandCode.toString(16)}, isAck=${response.isAck}, data=[${response.data}]`);
        this.emit("response", response);
      } else {
        this.log.error(`Invalid response checksum! Packet: ${packet.toString("hex")}`);
        this.emit("error", new Error("Invalid response checksum"));
      }
    }
  }
  /**
   * Send command to display
   */
  async sendCommand(command, waitForResponse = true) {
    if (!this.connected || !this.client) {
      throw new Error("Not connected");
    }
    return new Promise((resolve, reject) => {
      if (waitForResponse) {
        const onResponse = (response) => {
          if (this.responseTimeout) {
            clearTimeout(this.responseTimeout);
            this.responseTimeout = null;
          }
          this.removeListener("response", onResponse);
          resolve(response);
        };
        this.once("response", onResponse);
        this.responseTimeout = setTimeout(() => {
          this.log.error("Response timeout! No valid response received within 2000ms");
          this.log.error(`Current buffer: ${this.buffer.toString("hex")} (${this.buffer.length} bytes)`);
          this.removeListener("response", onResponse);
          reject(new Error("Response timeout"));
        }, 2e3);
      }
      this.log.debug(`Sending command: ${command.toString("hex")} (${command.length} bytes)`);
      if (this.config.type === "tcp") {
        this.client.write(command, (error) => {
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
        this.client.write(command, (error) => {
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
  handleDisconnect() {
    const wasConnected = this.connected;
    this.connected = false;
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout);
      this.responseTimeout = null;
    }
    if (wasConnected) {
      this.emit("disconnected");
    }
    if (this.autoReconnectEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.emit("reconnecting", this.reconnectAttempts);
      this.reconnectTimeout = setTimeout(() => {
        this.connect().catch(() => {
        });
      }, this.reconnectDelay);
    } else if (this.autoReconnectEnabled) {
      this.emit("maxReconnectReached");
    }
  }
  /**
   * Disconnect from display
   */
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout);
      this.responseTimeout = null;
    }
    if (this.client) {
      if (this.config.type === "tcp") {
        this.client.destroy();
      } else {
        this.client.close();
      }
      this.client = null;
    }
    this.connected = false;
    this.buffer = Buffer.alloc(0);
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConnectionManager
});
//# sourceMappingURL=connection-manager.js.map
