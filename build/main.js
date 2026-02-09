"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_connection_manager = require("./lib/connection-manager");
var import_iiyama_protocol = require("./lib/iiyama-protocol");
var import_wake_on_lan = require("./lib/wake-on-lan");
class Iiyama extends utils.Adapter {
  connection = null;
  pollInterval = null;
  commandQueue = [];
  processingQueue = false;
  wolInProgress = false;
  // Flag to prevent polling during WOL wake sequence
  constructor(options = {}) {
    super({
      ...options,
      name: "iiyama"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.log.info("Starting iiyama adapter");
    const powerSaveMode = this.config.powerSaveMode || 1;
    if (this.config.connectionType === "tcp") {
      if (powerSaveMode === 1 || powerSaveMode === 2) {
        this.log.info(`Power Save Mode ${powerSaveMode}: TCP off when display off, WOL required for power-on`);
      } else {
        this.log.info(`Power Save Mode ${powerSaveMode}: TCP always on, power commands sent directly via TCP`);
      }
    }
    if (this.config.connectionType === "tcp") {
      if (!this.config.host || !this.config.port) {
        this.log.error("TCP connection requires host and port configuration");
        return;
      }
    } else {
      if (!this.config.serialPort || !this.config.baudRate) {
        this.log.error("Serial connection requires serialPort and baudRate configuration");
        return;
      }
    }
    if (!this.config.monitorId || this.config.monitorId < 1 || this.config.monitorId > 255) {
      this.log.error("Monitor ID must be between 1 and 255");
      return;
    }
    await this.createStateObjects();
    await this.initConnection();
    this.subscribeStates("*");
  }
  /**
   * Create all state objects
   */
  async createStateObjects() {
    await this.setObjectNotExistsAsync("info.connection", {
      type: "state",
      common: {
        name: "Connection status",
        type: "boolean",
        role: "indicator.connected",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("info.standby", {
      type: "state",
      common: {
        name: "Display in standby",
        type: "boolean",
        role: "indicator",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("power", {
      type: "state",
      common: {
        name: "Power",
        type: "boolean",
        role: "switch.power",
        read: true,
        write: true
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("inputSource", {
      type: "state",
      common: {
        name: "Input Source",
        type: "number",
        role: "level",
        read: true,
        write: true,
        states: {
          [import_iiyama_protocol.InputSource.HDMI]: "HDMI",
          [import_iiyama_protocol.InputSource.HDMI_2]: "HDMI 2",
          [import_iiyama_protocol.InputSource.HDMI_3]: "HDMI 3",
          [import_iiyama_protocol.InputSource.HDMI_4]: "HDMI 4",
          [import_iiyama_protocol.InputSource.DVI_D]: "DVI-D",
          [import_iiyama_protocol.InputSource.DISPLAY_PORT]: "DisplayPort",
          [import_iiyama_protocol.InputSource.DISPLAY_PORT_2]: "DisplayPort 2",
          [import_iiyama_protocol.InputSource.VGA]: "VGA",
          [import_iiyama_protocol.InputSource.USB]: "USB",
          [import_iiyama_protocol.InputSource.USB_2]: "USB 2"
        }
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("volume.main", {
      type: "state",
      common: {
        name: "Main Volume",
        type: "number",
        role: "level.volume",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("volume.audioOut", {
      type: "state",
      common: {
        name: "Audio Out Volume",
        type: "number",
        role: "level.volume",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.brightness", {
      type: "state",
      common: {
        name: "Brightness",
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.contrast", {
      type: "state",
      common: {
        name: "Contrast",
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.color", {
      type: "state",
      common: {
        name: "Color",
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.sharpness", {
      type: "state",
      common: {
        name: "Sharpness",
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.tint", {
      type: "state",
      common: {
        name: "Tint",
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.blackLevel", {
      type: "state",
      common: {
        name: "Black Level",
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.gamma", {
      type: "state",
      common: {
        name: "Gamma",
        type: "number",
        role: "level",
        read: true,
        write: true,
        states: {
          1: "Native",
          2: "S Gamma",
          3: "2.2",
          4: "2.4",
          5: "DICOM"
        }
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.colorTemperature", {
      type: "state",
      common: {
        name: "Color Temperature",
        type: "number",
        role: "level",
        read: true,
        write: true,
        states: {
          0: "User 1",
          1: "Native",
          3: "10000K",
          4: "9300K",
          5: "7500K",
          6: "6500K",
          9: "5000K",
          10: "4000K",
          13: "3000K",
          18: "User 2"
        }
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("video.pictureFormat", {
      type: "state",
      common: {
        name: "Picture Format",
        type: "number",
        role: "level",
        read: true,
        write: true,
        states: {
          0: "Normal (4:3)",
          1: "Custom",
          2: "Real (1:1)",
          3: "Full",
          4: "21:9",
          5: "Dynamic",
          6: "16:9"
        }
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("audio.treble", {
      type: "state",
      common: {
        name: "Treble",
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("audio.bass", {
      type: "state",
      common: {
        name: "Bass",
        type: "number",
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("info.operatingHours", {
      type: "state",
      common: {
        name: "Operating Hours",
        type: "number",
        role: "value",
        read: true,
        write: false,
        unit: "hours"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("info.serialCode", {
      type: "state",
      common: {
        name: "Serial Code",
        type: "string",
        role: "text",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("commands.autoAdjust", {
      type: "state",
      common: {
        name: "Auto Adjust (VGA only)",
        type: "boolean",
        role: "button",
        read: false,
        write: true
      },
      native: {}
    });
  }
  /**
   * Initialize connection to display
   */
  async initConnection() {
    await this.setState("info.connection", false, true);
    await this.setState("info.standby", false, true);
    try {
      this.connection = new import_connection_manager.ConnectionManager(
        {
          type: this.config.connectionType,
          host: this.config.host,
          port: this.config.port,
          serialPort: this.config.serialPort,
          baudRate: this.config.baudRate
        },
        this.log
      );
      this.connection.on("connected", () => {
        this.log.info("Connected to display");
        this.setState("info.connection", true, true);
        this.setState("info.standby", false, true);
        if (!this.wolInProgress) {
          this.startPolling();
          this.pollStatus();
        }
      });
      this.connection.on("disconnected", () => {
        this.log.info("Disconnected from display");
        this.setState("info.connection", false, true);
        this.stopPolling();
      });
      this.connection.on("error", (error) => {
        if (error.message.includes("EHOSTUNREACH") || error.message.includes("ECONNREFUSED")) {
          this.log.debug(`Connection error (display may be off): ${error.message}`);
        } else {
          this.log.error(`Connection error: ${error.message}`);
        }
      });
      this.connection.on("reconnecting", (attempt) => {
        this.log.debug(`Reconnecting to display (attempt ${attempt})`);
      });
      this.connection.on("maxReconnectReached", () => {
        this.log.info("Max reconnection attempts reached - display appears to be off. Will reconnect on power-on command.");
        this.setState("info.standby", true, true);
      });
      await this.connection.connect();
    } catch (error) {
      const errorMsg = error.message;
      if (errorMsg.includes("EHOSTUNREACH") || errorMsg.includes("ECONNREFUSED") || errorMsg.includes("ETIMEDOUT")) {
        this.log.info(`Display not reachable (may be off/in standby): ${errorMsg}`);
        this.setState("info.standby", true, true);
      } else {
        this.log.error(`Failed to connect to display: ${errorMsg}`);
      }
    }
  }
  /**
   * Start polling for status updates
   */
  startPolling() {
    if (this.pollInterval) {
      return;
    }
    const interval = (this.config.pollInterval || 30) * 1e3;
    this.pollInterval = setInterval(() => {
      this.pollStatus();
    }, interval);
  }
  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
  /**
   * Poll display status
   */
  async pollStatus() {
    if (!this.connection || !this.connection.isConnected()) {
      return;
    }
    try {
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
      this.log.error(`Error polling status: ${error.message}`);
    }
  }
  /**
   * Queue a command for execution
   */
  queueCommand(command) {
    this.commandQueue.push(command);
    this.processQueue();
  }
  /**
   * Process command queue
   */
  async processQueue() {
    if (this.processingQueue || this.commandQueue.length === 0) {
      return;
    }
    this.processingQueue = true;
    while (this.commandQueue.length > 0) {
      const command = this.commandQueue.shift();
      if (command) {
        try {
          await command();
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          this.log.error(`Error executing command: ${error.message}`);
        }
      }
    }
    this.processingQueue = false;
  }
  /**
   * Get power state
   */
  async getPowerState() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetPowerCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response) {
      const powerOn = import_iiyama_protocol.IiyamaProtocol.parsePowerState(response);
      if (powerOn !== null) {
        await this.setState("power", powerOn, true);
      }
    }
  }
  /**
   * Get current source
   */
  async getCurrentSource() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetCurrentSourceCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response) {
      const source = import_iiyama_protocol.IiyamaProtocol.parseInputSource(response);
      if (source !== null) {
        await this.setState("inputSource", source, true);
      }
    }
  }
  /**
   * Get volume
   */
  async getVolume() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetVolumeCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response) {
      const volume = import_iiyama_protocol.IiyamaProtocol.parseVolume(response);
      if (volume) {
        await this.setState("volume.main", volume.volume, true);
        await this.setState("volume.audioOut", volume.audioOut, true);
      }
    }
  }
  /**
   * Get video parameters
   */
  async getVideoParams() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetVideoParamsCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response) {
      const params = import_iiyama_protocol.IiyamaProtocol.parseVideoParams(response);
      if (params) {
        await this.setState("video.brightness", params.brightness, true);
        await this.setState("video.color", params.color, true);
        await this.setState("video.contrast", params.contrast, true);
        await this.setState("video.sharpness", params.sharpness, true);
        await this.setState("video.tint", params.tint, true);
        await this.setState("video.blackLevel", params.blackLevel, true);
        await this.setState("video.gamma", params.gamma, true);
      }
    }
  }
  /**
   * Get color temperature
   */
  async getColorTemperature() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetColorTempCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response && response.data.length >= 1) {
      await this.setState("video.colorTemperature", response.data[0], true);
    }
  }
  /**
   * Get picture format
   */
  async getPictureFormat() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetPictureFormatCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response && response.data.length >= 1) {
      await this.setState("video.pictureFormat", response.data[0], true);
    }
  }
  /**
   * Get audio parameters
   */
  async getAudioParams() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetAudioParamsCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response && response.data.length >= 2) {
      await this.setState("audio.treble", response.data[0], true);
      await this.setState("audio.bass", response.data[1], true);
    }
  }
  /**
   * Get operating hours
   */
  async getOperatingHours() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetOperatingHoursCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response) {
      const hours = import_iiyama_protocol.IiyamaProtocol.parseOperatingHours(response);
      if (hours !== null) {
        await this.setState("info.operatingHours", hours, true);
      }
    }
  }
  /**
   * Get serial code
   */
  async getSerialCode() {
    if (!this.connection) return;
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetSerialCodeCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd);
    if (response) {
      const serialCode = import_iiyama_protocol.IiyamaProtocol.parseSerialCode(response);
      if (serialCode !== null) {
        await this.setState("info.serialCode", serialCode, true);
      }
    }
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
      this.stopPolling();
      if (this.connection) {
        this.connection.disconnect();
        this.connection = null;
      }
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
      callback();
    }
  }
  /**
   * Is called if a subscribed state changes
   *
   * @param id - State ID
   * @param state - State object
   */
  async onStateChange(id, state) {
    if (!state || state.ack || !this.connection) {
      return;
    }
    const stateId = id.substring(this.namespace.length + 1);
    this.log.debug(`User command received for ${stateId}: ${state.val}`);
    try {
      switch (stateId) {
        case "power":
          await this.setPower(state.val);
          break;
        case "inputSource":
          await this.setInputSource(state.val);
          break;
        case "volume.main":
        case "volume.audioOut":
          await this.setVolume();
          break;
        case "video.brightness":
        case "video.color":
        case "video.contrast":
        case "video.sharpness":
        case "video.tint":
        case "video.blackLevel":
        case "video.gamma":
          await this.setVideoParams();
          break;
        case "video.colorTemperature":
          await this.setColorTemperature(state.val);
          break;
        case "video.pictureFormat":
          await this.setPictureFormat(state.val);
          break;
        case "audio.treble":
        case "audio.bass":
          await this.setAudioParams();
          break;
        case "commands.autoAdjust":
          if (state.val) {
            await this.autoAdjust();
          }
          break;
      }
    } catch (error) {
      this.log.error(`Error handling state change: ${error.message}`);
    }
  }
  /**
   * Set power state
   * When powering on via TCP with Power Save Mode 1 or 2, sends a Wake-on-LAN packet first
   * Mode 1/2: TCP is off when display is off, WOL is required to wake
   * Mode 3/4: TCP stays on even when display is off, power command sent directly via TCP
   */
  async setPower(powerOn) {
    if (!this.connection) return;
    const powerSaveMode = this.config.powerSaveMode || 1;
    const needsWol = powerSaveMode === 1 || powerSaveMode === 2;
    if (powerOn && this.config.connectionType === "tcp" && this.config.macAddress && needsWol) {
      if (import_wake_on_lan.WakeOnLan.isValidMacAddress(this.config.macAddress)) {
        this.wolInProgress = true;
        this.stopPolling();
        this.commandQueue = [];
        try {
          this.log.info(`Sending Wake-on-LAN packet to ${this.config.macAddress}`);
          await import_wake_on_lan.WakeOnLan.wake(this.config.macAddress);
          if (!this.connection.isConnected()) {
            this.connection.setAutoReconnect(false);
            this.connection.resetReconnectAttempts();
            const maxRetries = 5;
            const retryDelay = 3e3;
            let connected = false;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              this.log.info(`Waiting for display to wake up... (attempt ${attempt}/${maxRetries})`);
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
              try {
                this.log.info("Attempting to reconnect to display...");
                await this.connection.connect();
                this.log.info("Reconnected to display");
                connected = true;
                break;
              } catch (connError) {
                if (attempt === maxRetries) {
                  this.log.error(`Failed to reconnect after WOL: ${connError.message}`);
                } else {
                  this.log.debug(`Reconnect attempt ${attempt} failed, retrying...`);
                }
              }
            }
            this.connection.setAutoReconnect(true);
            if (!connected) {
              this.wolInProgress = false;
              return;
            }
            this.log.info("Waiting for display to initialize...");
            await new Promise((resolve) => setTimeout(resolve, 3e3));
          }
        } catch (error) {
          this.log.warn(`Failed to send WOL packet: ${error.message}`);
          this.connection.setAutoReconnect(true);
          this.wolInProgress = false;
        }
      } else {
        this.log.warn(`Invalid MAC address configured: ${this.config.macAddress}`);
      }
    }
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildPowerCommand(this.config.monitorId, powerOn);
      await this.connection.sendCommand(cmd);
      await this.setState("power", powerOn, true);
      if (this.wolInProgress) {
        this.wolInProgress = false;
        this.log.info("WOL sequence complete, starting polling");
        this.startPolling();
      }
    });
  }
  /**
   * Set input source
   */
  async setInputSource(source) {
    if (!this.connection) return;
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildInputSourceCommand(this.config.monitorId, source);
      await this.connection.sendCommand(cmd);
      await this.setState("inputSource", source, true);
    });
  }
  /**
   * Set volume
   */
  async setVolume() {
    if (!this.connection) return;
    const mainVol = await this.getStateAsync("volume.main");
    const audioOutVol = await this.getStateAsync("volume.audioOut");
    if (mainVol && audioOutVol) {
      const main = mainVol.val;
      const audioOut = audioOutVol.val;
      this.queueCommand(async () => {
        const cmd = import_iiyama_protocol.IiyamaProtocol.buildVolumeCommand(this.config.monitorId, main, audioOut);
        await this.connection.sendCommand(cmd);
        await this.setState("volume.main", main, true);
        await this.setState("volume.audioOut", audioOut, true);
      });
    }
  }
  /**
   * Set video parameters
   */
  async setVideoParams() {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!this.connection) return;
    const brightness = (_a = await this.getStateAsync("video.brightness")) == null ? void 0 : _a.val;
    const color = (_b = await this.getStateAsync("video.color")) == null ? void 0 : _b.val;
    const contrast = (_c = await this.getStateAsync("video.contrast")) == null ? void 0 : _c.val;
    const sharpness = (_d = await this.getStateAsync("video.sharpness")) == null ? void 0 : _d.val;
    const tint = (_e = await this.getStateAsync("video.tint")) == null ? void 0 : _e.val;
    const blackLevel = (_f = await this.getStateAsync("video.blackLevel")) == null ? void 0 : _f.val;
    const gamma = (_g = await this.getStateAsync("video.gamma")) == null ? void 0 : _g.val;
    if (brightness !== void 0 && color !== void 0 && contrast !== void 0 && sharpness !== void 0 && tint !== void 0 && blackLevel !== void 0 && gamma !== void 0) {
      this.queueCommand(async () => {
        const cmd = import_iiyama_protocol.IiyamaProtocol.buildVideoParamsCommand(
          this.config.monitorId,
          brightness,
          color,
          contrast,
          sharpness,
          tint,
          blackLevel,
          gamma
        );
        await this.connection.sendCommand(cmd);
        await this.setState("video.brightness", brightness, true);
        await this.setState("video.color", color, true);
        await this.setState("video.contrast", contrast, true);
        await this.setState("video.sharpness", sharpness, true);
        await this.setState("video.tint", tint, true);
        await this.setState("video.blackLevel", blackLevel, true);
        await this.setState("video.gamma", gamma, true);
      });
    }
  }
  /**
   * Set color temperature
   */
  async setColorTemperature(temp) {
    if (!this.connection) return;
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildColorTempCommand(this.config.monitorId, temp);
      await this.connection.sendCommand(cmd);
      await this.setState("video.colorTemperature", temp, true);
    });
  }
  /**
   * Set picture format
   */
  async setPictureFormat(format) {
    if (!this.connection) return;
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildPictureFormatCommand(this.config.monitorId, format);
      await this.connection.sendCommand(cmd);
      await this.setState("video.pictureFormat", format, true);
    });
  }
  /**
   * Set audio parameters
   */
  async setAudioParams() {
    var _a, _b;
    if (!this.connection) return;
    const treble = (_a = await this.getStateAsync("audio.treble")) == null ? void 0 : _a.val;
    const bass = (_b = await this.getStateAsync("audio.bass")) == null ? void 0 : _b.val;
    if (treble !== void 0 && bass !== void 0) {
      this.queueCommand(async () => {
        const cmd = import_iiyama_protocol.IiyamaProtocol.buildAudioParamsCommand(this.config.monitorId, treble, bass);
        await this.connection.sendCommand(cmd);
        await this.setState("audio.treble", treble, true);
        await this.setState("audio.bass", bass, true);
      });
    }
  }
  /**
   * Auto adjust (VGA only)
   */
  async autoAdjust() {
    if (!this.connection) return;
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildAutoAdjustCommand(this.config.monitorId);
      await this.connection.sendCommand(cmd, false);
      await this.setState("commands.autoAdjust", false, true);
    });
  }
}
if (require.main !== module) {
  module.exports = (options) => new Iiyama(options);
} else {
  (() => new Iiyama())();
}
//# sourceMappingURL=main.js.map
