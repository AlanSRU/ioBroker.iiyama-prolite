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
var import_node_events = require("node:events");
var net = __toESM(require("node:net"));
var import_serialport = require("serialport");
var import_iiyama_protocol = require("./iiyama-protocol");
class ConnectionManager extends import_node_events.EventEmitter {
  constructor(config, adapter) {
    super();
    this.config = config;
    this.adapter = adapter;
    this.log = adapter.log;
  }
  client = null;
  connected = false;
  buffer = Buffer.alloc(0);
  responseTimeout;
  consecutiveTimeouts = 0;
  /** In-flight sendCommand awaiting a reply, so a disconnect can settle it instead of hanging. */
  pendingRequest;
  reconnectTimeout;
  connectTimeout;
  standbyPollTimeout;
  connectPromise;
  reconnectAttempts = 0;
  maxReconnectAttempts = 10;
  reconnectDelay = 5e3;
  connectTimeoutMs = 1e4;
  // Reject a TCP connect that hangs (unreachable host)
  standbyPollInterval = 3e4;
  // Check every 30s if display came back
  autoReconnectEnabled = true;
  log;
  /**
   * Enable or disable auto-reconnect
   *
   * @param enabled
   */
  setAutoReconnect(enabled) {
    this.autoReconnectEnabled = enabled;
    if (!enabled) {
      if (this.reconnectTimeout) {
        this.adapter.clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = void 0;
      }
      this.stopStandbyPolling();
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
    if (this.connected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = new Promise((resolve, reject) => {
      if (this.config.type === "tcp") {
        this.connectTCP(resolve, reject);
      } else {
        this.connectSerial(resolve, reject);
      }
    });
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = void 0;
    }
  }
  /**
   * Connect via TCP/IP
   *
   * @param resolve
   * @param reject
   */
  connectTCP(resolve, reject) {
    if (!this.config.host || !this.config.port) {
      return reject(new Error("TCP connection requires host and port"));
    }
    this.client = new net.Socket();
    const tcpClient = this.client;
    let settled = false;
    this.connectTimeout = this.adapter.setTimeout(() => {
      this.connectTimeout = void 0;
      if (this.connected || settled) {
        return;
      }
      settled = true;
      this.log.debug(`TCP connect timeout after ${this.connectTimeoutMs}ms (host may be off/unreachable)`);
      tcpClient.destroy();
      reject(new Error("ETIMEDOUT: TCP connection timed out"));
    }, this.connectTimeoutMs);
    tcpClient.connect(this.config.port, this.config.host, () => {
      if (this.connectTimeout) {
        this.adapter.clearTimeout(this.connectTimeout);
        this.connectTimeout = void 0;
      }
      settled = true;
      this.connected = true;
      this.reconnectAttempts = 0;
      this.stopStandbyPolling();
      tcpClient.setKeepAlive(true, 1e4);
      this.emit("connected");
      resolve();
    });
    tcpClient.on("data", (data) => {
      this.handleData(data);
    });
    tcpClient.on("error", (error) => {
      if (this.connectTimeout) {
        this.adapter.clearTimeout(this.connectTimeout);
        this.connectTimeout = void 0;
      }
      this.emit("error", error);
      if (!this.connected && !settled) {
        settled = true;
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
   *
   * @param resolve
   * @param reject
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
      this.stopStandbyPolling();
      this.emit("connected");
      resolve();
    });
    serialClient.on("data", (data) => {
      this.handleData(data);
    });
    let openFailureHandled = false;
    serialClient.on("error", (error) => {
      this.emit("error", error);
      if (!this.connected) {
        reject(error);
        if (!openFailureHandled) {
          openFailureHandled = true;
          this.handleDisconnect();
        }
      }
    });
    serialClient.on("close", () => {
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
        this.log.debug(
          `Valid response received: monitorId=${response.monitorId}, commandCode=0x${response.commandCode.toString(16)}, isAck=${response.isAck}, data=[${response.data.join(",")}]`
        );
        this.emit("response", response);
      } else {
        this.log.error(`Invalid response checksum! Packet: ${packet.toString("hex")}`);
        this.emit("error", new Error("Invalid response checksum"));
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
  async sendCommand(command, waitForResponse = true, expectedCode) {
    if (!this.connected || !this.client) {
      throw new Error("Not connected");
    }
    return new Promise((resolve, reject) => {
      const finish = () => {
        var _a;
        if (this.responseTimeout) {
          this.adapter.clearTimeout(this.responseTimeout);
          this.responseTimeout = void 0;
        }
        (_a = this.pendingRequest) == null ? void 0 : _a.cleanup();
        this.pendingRequest = void 0;
      };
      if (waitForResponse) {
        const onResponse = (response) => {
          if (expectedCode !== void 0 && response.commandCode !== expectedCode) {
            this.log.debug(
              `Ignoring response 0x${response.commandCode.toString(16)} while waiting for 0x${expectedCode.toString(16)}`
            );
            return;
          }
          this.consecutiveTimeouts = 0;
          finish();
          resolve(response);
        };
        this.on("response", onResponse);
        this.pendingRequest = {
          reject,
          cleanup: () => this.removeListener("response", onResponse)
        };
        this.responseTimeout = this.adapter.setTimeout(() => {
          if (this.consecutiveTimeouts === 0) {
            this.log.error("Response timeout! No valid response received within 5000ms");
            this.log.error(`Current buffer: ${this.buffer.toString("hex")} (${this.buffer.length} bytes)`);
          } else {
            this.log.debug(
              `Response timeout (${this.consecutiveTimeouts + 1} consecutive). Buffer: ${this.buffer.toString("hex")} (${this.buffer.length} bytes)`
            );
          }
          this.consecutiveTimeouts++;
          this.buffer = Buffer.alloc(0);
          finish();
          reject(new Error("Response timeout"));
        }, 5e3);
      }
      this.log.debug(`Sending command: ${command.toString("hex")} (${command.length} bytes)`);
      const onWriteComplete = (error) => {
        if (error) {
          finish();
          reject(error);
        } else if (!waitForResponse) {
          resolve(null);
        }
      };
      if (this.config.type === "tcp") {
        this.client.write(command, onWriteComplete);
      } else {
        this.client.write(command, onWriteComplete);
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
  settlePendingRequest(reason) {
    if (this.responseTimeout) {
      this.adapter.clearTimeout(this.responseTimeout);
      this.responseTimeout = void 0;
    }
    const pending = this.pendingRequest;
    this.pendingRequest = void 0;
    if (pending) {
      pending.cleanup();
      pending.reject(new Error(reason));
    }
  }
  /**
   * Handle disconnection
   */
  handleDisconnect() {
    const wasConnected = this.connected;
    this.connected = false;
    this.settlePendingRequest("Connection closed while awaiting response");
    if (wasConnected) {
      this.emit("disconnected");
    }
    if (this.autoReconnectEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.emit("reconnecting", this.reconnectAttempts);
      this.reconnectTimeout = this.adapter.setTimeout(() => {
        this.connect().catch(() => {
        });
      }, this.reconnectDelay);
    } else if (this.autoReconnectEnabled) {
      this.emit("maxReconnectReached");
      this.startStandbyPolling();
    }
  }
  /**
   * Start slow periodic reconnection attempts while display is in standby.
   * This ensures the adapter reconnects when the display is turned on manually.
   */
  startStandbyPolling() {
    this.stopStandbyPolling();
    this.standbyPollTimeout = this.adapter.setInterval(() => {
      if (this.connected) {
        this.stopStandbyPolling();
        return;
      }
      this.log.debug("Standby poll: checking if display is reachable...");
      this.connect().catch(() => {
      });
    }, this.standbyPollInterval);
  }
  /**
   * Stop standby polling
   */
  stopStandbyPolling() {
    if (this.standbyPollTimeout) {
      this.adapter.clearInterval(this.standbyPollTimeout);
      this.standbyPollTimeout = void 0;
    }
  }
  /**
   * Disconnect from display
   */
  disconnect() {
    this.stopStandbyPolling();
    if (this.reconnectTimeout) {
      this.adapter.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = void 0;
    }
    if (this.connectTimeout) {
      this.adapter.clearTimeout(this.connectTimeout);
      this.connectTimeout = void 0;
    }
    this.settlePendingRequest("Disconnected while awaiting response");
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
