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
  pollInterval;
  commandQueue = [];
  processingQueue = false;
  wolInProgress = false;
  // Flag to prevent polling during WOL wake sequence
  /** Last value the display confirmed, used to roll a control back when a command fails. */
  lastAcked = /* @__PURE__ */ new Map();
  consecutiveCommandFailures = 0;
  connectionDegraded = false;
  maxCommandFailures = 3;
  // Consecutive failures before info.connection is cleared
  failureDrainMs = 1e3;
  // Quiet window after a failure, to absorb a late reply
  standbyReported = false;
  // Log the 'display is off' notice once per standby period
  consecutiveConnectionErrors = 0;
  // Report a repeating connection error once, then demote
  constructor(options = {}) {
    super({
      ...options,
      name: "iiyama-prolite"
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
      const modeDescriptions = {
        1: "WOL off, source input wake off - Cannot wake via network",
        2: "WOL off, source input wake on - Wakes on source signal only, no network control",
        3: "WOL on, source input wake off - Use WOL + power command",
        4: "WOL on, source input wake on - Use WOL + power command (recommended)"
      };
      this.log.info(`Power Save Mode ${powerSaveMode}: ${modeDescriptions[powerSaveMode] || "Unknown mode"}`);
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
    this.config.pollInterval = Math.min(300, Math.max(5, parseInt(String(this.config.pollInterval), 10) || 30));
    if (this.config.connectionType === "tcp") {
      const port = parseInt(String(this.config.port), 10);
      if (!(port >= 1 && port <= 65535)) {
        this.log.error(`TCP port must be between 1 and 65535 (got ${this.config.port})`);
        return;
      }
      this.config.port = port;
    }
    await this.createStateObjects();
    await this.initConnection();
    this.subscribeStates("*");
  }
  /**
   * Create all state objects
   */
  async createStateObjects() {
    const channels = {
      info: "Information",
      volume: "Volume",
      video: "Video settings",
      audio: "Audio settings",
      commands: "Commands"
    };
    for (const [id, name] of Object.entries(channels)) {
      await this.extendObject(id, {
        type: "channel",
        common: { name },
        native: {}
      });
    }
    await this.extendObject("info.connection", {
      type: "state",
      common: {
        name: "Connection status",
        type: "boolean",
        def: false,
        role: "indicator.connected",
        read: true,
        write: false
      },
      native: {}
    });
    await this.extendObject("info.standby", {
      type: "state",
      common: {
        name: "Display in standby",
        type: "boolean",
        def: false,
        role: "indicator",
        read: true,
        write: false
      },
      native: {}
    });
    await this.extendObject("power", {
      type: "state",
      common: {
        name: "Power",
        type: "boolean",
        def: false,
        role: "switch.power",
        read: true,
        write: true
      },
      native: {}
    });
    await this.extendObject("inputSource", {
      type: "state",
      common: {
        name: "Input Source",
        type: "number",
        def: 0,
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
    await this.extendObject("volume.main", {
      type: "state",
      common: {
        name: "Main Volume",
        type: "number",
        def: 0,
        role: "level.volume",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.extendObject("volume.audioOut", {
      type: "state",
      common: {
        name: "Audio Out Volume",
        type: "number",
        def: 0,
        role: "level.volume",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.extendObject("video.brightness", {
      type: "state",
      common: {
        name: "Brightness",
        type: "number",
        def: 0,
        role: "level.dimmer",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.extendObject("video.contrast", {
      type: "state",
      common: {
        name: "Contrast",
        type: "number",
        def: 0,
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.extendObject("video.color", {
      type: "state",
      common: {
        name: "Color",
        type: "number",
        def: 0,
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.extendObject("video.sharpness", {
      type: "state",
      common: {
        name: "Sharpness",
        type: "number",
        def: 0,
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.extendObject("video.tint", {
      type: "state",
      common: {
        name: "Tint",
        type: "number",
        def: 0,
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.extendObject("video.blackLevel", {
      type: "state",
      common: {
        name: "Black Level",
        type: "number",
        def: 0,
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100,
        unit: "%"
      },
      native: {}
    });
    await this.extendObject("video.gamma", {
      type: "state",
      common: {
        name: "Gamma",
        type: "number",
        def: 0,
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
    await this.extendObject("video.colorTemperature", {
      type: "state",
      common: {
        name: "Color Temperature",
        type: "number",
        def: 0,
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
    await this.extendObject("video.pictureFormat", {
      type: "state",
      common: {
        name: "Picture Format",
        type: "number",
        def: 0,
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
    await this.extendObject("audio.treble", {
      type: "state",
      common: {
        name: "Treble",
        type: "number",
        def: 0,
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100
      },
      native: {}
    });
    await this.extendObject("audio.bass", {
      type: "state",
      common: {
        name: "Bass",
        type: "number",
        def: 0,
        role: "level",
        read: true,
        write: true,
        min: 0,
        max: 100
      },
      native: {}
    });
    await this.extendObject("info.operatingHours", {
      type: "state",
      common: {
        name: "Operating Hours",
        type: "number",
        def: 0,
        role: "value",
        read: true,
        write: false,
        unit: "hours"
      },
      native: {}
    });
    await this.extendObject("info.serialCode", {
      type: "state",
      common: {
        name: "Serial Code",
        type: "string",
        def: "",
        role: "text",
        read: true,
        write: false
      },
      native: {}
    });
    await this.extendObject("commands.autoAdjust", {
      type: "state",
      common: {
        name: "Auto Adjust (VGA only)",
        type: "boolean",
        def: false,
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
    await this.ackState("info.connection", false);
    await this.ackState("info.standby", false);
    try {
      this.connection = new import_connection_manager.ConnectionManager(
        {
          type: this.config.connectionType,
          host: this.config.host,
          port: this.config.port,
          serialPort: this.config.serialPort,
          baudRate: this.config.baudRate
        },
        this
      );
      this.connection.on("connected", () => {
        this.log.info("Connected to display");
        this.consecutiveCommandFailures = 0;
        this.connectionDegraded = false;
        this.standbyReported = false;
        this.consecutiveConnectionErrors = 0;
        this.setState("info.connection", true, true);
        this.setState("info.standby", false, true);
        if (!this.wolInProgress) {
          this.setTimeout(() => {
            this.startPolling();
            this.pollStatus();
          }, 2e3);
        }
      });
      this.connection.on("disconnected", () => {
        this.log.info("Disconnected from display");
        this.consecutiveCommandFailures = 0;
        this.connectionDegraded = false;
        this.setState("info.connection", false, true);
        this.stopPolling();
      });
      this.connection.on("error", (error) => {
        const expected = error.message.includes("EHOSTUNREACH") || error.message.includes("ECONNREFUSED");
        this.consecutiveConnectionErrors++;
        if (expected || this.consecutiveConnectionErrors > 1) {
          this.log.debug(
            `Connection error (${this.consecutiveConnectionErrors} consecutive, display may be off): ${error.message}`
          );
        } else {
          this.log.error(`Connection error: ${error.message}`);
        }
      });
      this.connection.on("reconnecting", (attempt) => {
        this.log.debug(`Reconnecting to display (attempt ${attempt})`);
      });
      this.connection.on("maxReconnectReached", () => {
        if (this.standbyReported) {
          return;
        }
        this.standbyReported = true;
        this.log.info(
          "Max reconnection attempts reached - display appears to be off. The adapter keeps checking and reconnects automatically when it comes back on."
        );
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
    this.pollInterval = this.setInterval(() => {
      this.pollStatus();
    }, interval);
  }
  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      this.clearInterval(this.pollInterval);
      this.pollInterval = void 0;
    }
  }
  /**
   * Poll display status
   */
  pollStatus() {
    if (!this.connection || !this.connection.isConnected()) {
      return;
    }
    if (this.commandQueue.length > 0 || this.processingQueue) {
      this.log.debug("Skipping poll cycle: previous cycle still processing");
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
   * Write a value the display has confirmed, remembering it so a later failed command can
   * roll the control back to it.
   *
   * @param id - State id, relative to the instance namespace
   * @param value - The confirmed value
   */
  async ackState(id, value) {
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
  queueCommand(command, revertIds) {
    this.commandQueue.push({ run: command, revertIds });
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
      const entry = this.commandQueue.shift();
      if (entry) {
        try {
          await entry.run();
          this.onCommandSuccess();
          await this.delay(100);
        } catch (error) {
          await this.onCommandFailure(entry.revertIds, error);
          await this.delay(this.failureDrainMs);
        }
      }
    }
    this.processingQueue = false;
  }
  /**
   * Note that the display answered, clearing any degraded state.
   */
  onCommandSuccess() {
    this.consecutiveCommandFailures = 0;
    if (this.connectionDegraded) {
      this.connectionDegraded = false;
      this.log.info("Display is responding again");
      void this.ackState("info.connection", true);
      void this.ackState("info.standby", false);
    }
  }
  /**
   * Handle a command that could not be delivered or was never answered.
   *
   * @param revertIds - States to roll back to their last confirmed values, if any
   * @param error - The failure
   */
  async onCommandFailure(revertIds, error) {
    this.consecutiveCommandFailures++;
    if (this.consecutiveCommandFailures === 1) {
      this.log.error(`Error executing command: ${error.message}`);
    } else {
      this.log.debug(
        `Error executing command (${this.consecutiveCommandFailures} consecutive): ${error.message}`
      );
    }
    for (const id of revertIds != null ? revertIds : []) {
      if (this.lastAcked.has(id)) {
        await this.setState(id, this.lastAcked.get(id), true);
      }
    }
    if (!this.connectionDegraded && this.consecutiveCommandFailures >= this.maxCommandFailures) {
      this.connectionDegraded = true;
      this.log.warn(
        `Display has not answered ${this.consecutiveCommandFailures} consecutive commands - marking the connection as down (check that Monitor ID ${this.config.monitorId} matches the display)`
      );
      await this.ackState("info.connection", false);
      await this.ackState("info.standby", true);
    }
  }
  /**
   * Get power state
   */
  async getPowerState() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetPowerCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.POWER_STATE_GET);
    if (response) {
      const powerOn = import_iiyama_protocol.IiyamaProtocol.parsePowerState(response);
      if (powerOn !== null) {
        await this.ackState("power", powerOn);
      }
    }
  }
  /**
   * Get current source
   */
  async getCurrentSource() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetCurrentSourceCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.CURRENT_SOURCE_GET);
    if (response) {
      const source = import_iiyama_protocol.IiyamaProtocol.parseInputSource(response);
      if (source !== null) {
        await this.ackState("inputSource", source);
      }
    }
  }
  /**
   * Get volume
   */
  async getVolume() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetVolumeCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.VOLUME_GET);
    if (response) {
      const volume = import_iiyama_protocol.IiyamaProtocol.parseVolume(response);
      if (volume) {
        await this.ackState("volume.main", volume.volume);
        await this.ackState("volume.audioOut", volume.audioOut);
      }
    }
  }
  /**
   * Get video parameters
   */
  async getVideoParams() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetVideoParamsCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.VIDEO_PARAMS_GET);
    if (response) {
      const params = import_iiyama_protocol.IiyamaProtocol.parseVideoParams(response);
      if (params) {
        await this.ackState("video.brightness", params.brightness);
        await this.ackState("video.color", params.color);
        await this.ackState("video.contrast", params.contrast);
        await this.ackState("video.sharpness", params.sharpness);
        await this.ackState("video.tint", params.tint);
        await this.ackState("video.blackLevel", params.blackLevel);
        await this.ackState("video.gamma", params.gamma);
      }
    }
  }
  /**
   * Get color temperature
   */
  async getColorTemperature() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetColorTempCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.COLOR_TEMP_GET);
    if (response && response.data.length >= 1) {
      await this.ackState("video.colorTemperature", response.data[0]);
    }
  }
  /**
   * Get picture format
   */
  async getPictureFormat() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetPictureFormatCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.PICTURE_FORMAT_GET);
    if (response && response.data.length >= 1) {
      await this.ackState("video.pictureFormat", response.data[0]);
    }
  }
  /**
   * Get audio parameters
   */
  async getAudioParams() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetAudioParamsCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.AUDIO_PARAMS_GET);
    if (response && response.data.length >= 2) {
      await this.ackState("audio.treble", response.data[0]);
      await this.ackState("audio.bass", response.data[1]);
    }
  }
  /**
   * Get operating hours
   */
  async getOperatingHours() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetOperatingHoursCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.OPERATING_HOURS_GET);
    if (response) {
      const hours = import_iiyama_protocol.IiyamaProtocol.parseOperatingHours(response);
      if (hours !== null) {
        await this.ackState("info.operatingHours", hours);
      }
    }
  }
  /**
   * Get serial code
   */
  async getSerialCode() {
    if (!this.connection) {
      return;
    }
    const cmd = import_iiyama_protocol.IiyamaProtocol.buildGetSerialCodeCommand(this.config.monitorId);
    const response = await this.connection.sendCommand(cmd, true, import_iiyama_protocol.CommandCode.SERIAL_CODE_GET);
    if (response) {
      const serialCode = import_iiyama_protocol.IiyamaProtocol.parseSerialCode(response);
      if (serialCode !== null) {
        await this.ackState("info.serialCode", serialCode);
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
          this.setInputSource(state.val);
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
          this.setColorTemperature(state.val);
          break;
        case "video.pictureFormat":
          this.setPictureFormat(state.val);
          break;
        case "audio.treble":
        case "audio.bass":
          await this.setAudioParams();
          break;
        case "commands.autoAdjust":
          if (state.val) {
            this.autoAdjust();
          }
          break;
      }
    } catch (error) {
      this.log.error(`Error handling state change: ${error.message}`);
    }
  }
  /**
   * Redact a MAC address for logging, keeping only the last three octets.
   * MAC addresses can be treated as personal data in some jurisdictions, so we
   * avoid writing them to the log in full. e.g. AA:BB:CC:DD:EE:FF -> **:**:**:DD:EE:FF
   *
   * @param mac - MAC address (any common separator) or undefined
   */
  redactMac(mac) {
    if (!mac) {
      return "(none)";
    }
    const octets = mac.split(/[:-]/);
    if (octets.length !== 6) {
      return "**:**:**:**:**:**";
    }
    return ["**", "**", "**", octets[3], octets[4], octets[5]].join(":");
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
  async setPower(powerOn) {
    if (!this.connection) {
      return;
    }
    const powerSaveMode = this.config.powerSaveMode || 1;
    const needsWol = powerSaveMode === 3 || powerSaveMode === 4;
    if (powerOn && this.config.connectionType === "tcp") {
      const displayReachable = this.connection.isConnected();
      if (powerSaveMode === 1 && !displayReachable) {
        this.log.warn(
          `Power Save Mode ${powerSaveMode}: Cannot wake display via network. WOL and source input wake are both disabled. Please use IR remote/front panel button to wake the display, or change to Mode 3 or 4 (WOL enabled) in display settings.`
        );
        await this.ackState("power", false);
        return;
      }
      if (powerSaveMode === 2 && !displayReachable) {
        this.log.warn(
          `Power Save Mode ${powerSaveMode}: Cannot wake display via network command. WOL is disabled. Display will only wake when it detects a source input signal. Change to Mode 3 or 4 (WOL enabled) for network wake capability.`
        );
        await this.ackState("power", false);
        return;
      }
      if (needsWol && this.config.macAddress) {
        if (import_wake_on_lan.WakeOnLan.isValidMacAddress(this.config.macAddress)) {
          this.wolInProgress = true;
          this.stopPolling();
          this.commandQueue = [];
          try {
            const broadcastAddr = this.config.broadcastAddress || this.config.host.replace(/\.\d+$/, ".255");
            this.log.info(
              `Sending Wake-on-LAN packets to ${this.redactMac(this.config.macAddress)} via broadcast ${broadcastAddr} (ports 9 and 7, 3 packets each)`
            );
            await import_wake_on_lan.WakeOnLan.wake(this.config.macAddress, broadcastAddr);
            this.log.info("Wake-on-LAN packets sent successfully");
            if (!this.connection.isConnected()) {
              this.connection.setAutoReconnect(false);
              this.connection.resetReconnectAttempts();
              const maxRetries = 5;
              const retryDelay = 3e3;
              let connected = false;
              for (let attempt = 1; attempt <= maxRetries; attempt++) {
                this.log.info(`Waiting for display to wake up... (attempt ${attempt}/${maxRetries})`);
                await this.delay(retryDelay);
                try {
                  this.log.info("Attempting to reconnect to display...");
                  await this.connection.connect();
                  this.log.info("Reconnected to display");
                  connected = true;
                  break;
                } catch (connError) {
                  if (attempt === maxRetries) {
                    this.log.error(
                      `Failed to reconnect after WOL: ${connError.message}`
                    );
                  } else {
                    this.log.debug(`Reconnect attempt ${attempt} failed, retrying...`);
                  }
                }
              }
              this.connection.setAutoReconnect(true);
              if (!connected) {
                this.endWolSequence();
                await this.ackState("power", false);
                return;
              }
              this.log.info("Waiting for display to initialize...");
              await this.delay(3e3);
            }
          } catch (error) {
            this.log.warn(`Failed to send WOL packet: ${error.message}`);
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
        const cmd = import_iiyama_protocol.IiyamaProtocol.buildPowerCommand(this.config.monitorId, powerOn);
        await this.connection.sendCommand(cmd);
        await this.ackState("power", powerOn);
      } finally {
        this.endWolSequence();
      }
    }, ["power"]);
  }
  /**
   * Clear the WOL guard and resume polling, if a WOL sequence was in progress.
   *
   * Safe to call unconditionally and more than once.
   */
  endWolSequence() {
    var _a;
    if (!this.wolInProgress) {
      return;
    }
    this.wolInProgress = false;
    if ((_a = this.connection) == null ? void 0 : _a.isConnected()) {
      this.log.info("WOL sequence finished, resuming polling");
      this.startPolling();
    } else {
      this.log.debug("WOL sequence finished while disconnected; polling resumes on reconnect");
    }
  }
  /**
   * Set input source
   *
   * @param source
   */
  setInputSource(source) {
    if (!this.connection) {
      return;
    }
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildInputSourceCommand(this.config.monitorId, source);
      await this.connection.sendCommand(cmd);
      await this.ackState("inputSource", source);
    }, ["inputSource"]);
  }
  /**
   * Set volume
   */
  async setVolume() {
    if (!this.connection) {
      return;
    }
    const mainVol = await this.getStateAsync("volume.main");
    const audioOutVol = await this.getStateAsync("volume.audioOut");
    if (mainVol && audioOutVol) {
      const main = mainVol.val;
      const audioOut = audioOutVol.val;
      this.queueCommand(async () => {
        const cmd = import_iiyama_protocol.IiyamaProtocol.buildVolumeCommand(this.config.monitorId, main, audioOut);
        await this.connection.sendCommand(cmd);
        await this.ackState("volume.main", main);
        await this.ackState("volume.audioOut", audioOut);
      }, ["volume.main", "volume.audioOut"]);
    }
  }
  /**
   * Set video parameters
   */
  async setVideoParams() {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!this.connection) {
      return;
    }
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
        await this.ackState("video.brightness", brightness);
        await this.ackState("video.color", color);
        await this.ackState("video.contrast", contrast);
        await this.ackState("video.sharpness", sharpness);
        await this.ackState("video.tint", tint);
        await this.ackState("video.blackLevel", blackLevel);
        await this.ackState("video.gamma", gamma);
      }, [
        "video.brightness",
        "video.color",
        "video.contrast",
        "video.sharpness",
        "video.tint",
        "video.blackLevel",
        "video.gamma"
      ]);
    }
  }
  /**
   * Set color temperature
   *
   * @param temp
   */
  setColorTemperature(temp) {
    if (!this.connection) {
      return;
    }
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildColorTempCommand(this.config.monitorId, temp);
      await this.connection.sendCommand(cmd);
      await this.ackState("video.colorTemperature", temp);
    }, ["video.colorTemperature"]);
  }
  /**
   * Set picture format
   *
   * @param format
   */
  setPictureFormat(format) {
    if (!this.connection) {
      return;
    }
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildPictureFormatCommand(this.config.monitorId, format);
      await this.connection.sendCommand(cmd);
      await this.ackState("video.pictureFormat", format);
    }, ["video.pictureFormat"]);
  }
  /**
   * Set audio parameters
   */
  async setAudioParams() {
    var _a, _b;
    if (!this.connection) {
      return;
    }
    const treble = (_a = await this.getStateAsync("audio.treble")) == null ? void 0 : _a.val;
    const bass = (_b = await this.getStateAsync("audio.bass")) == null ? void 0 : _b.val;
    if (treble !== void 0 && bass !== void 0) {
      this.queueCommand(async () => {
        const cmd = import_iiyama_protocol.IiyamaProtocol.buildAudioParamsCommand(this.config.monitorId, treble, bass);
        await this.connection.sendCommand(cmd);
        await this.ackState("audio.treble", treble);
        await this.ackState("audio.bass", bass);
      }, ["audio.treble", "audio.bass"]);
    }
  }
  /**
   * Auto adjust (VGA only)
   */
  autoAdjust() {
    if (!this.connection) {
      return;
    }
    this.queueCommand(async () => {
      const cmd = import_iiyama_protocol.IiyamaProtocol.buildAutoAdjustCommand(this.config.monitorId);
      await this.connection.sendCommand(cmd, false);
      await this.ackState("commands.autoAdjust", false);
    });
  }
}
if (require.main !== module) {
  module.exports = (options) => new Iiyama(options);
} else {
  (() => new Iiyama())();
}
//# sourceMappingURL=main.js.map
