"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var iiyama_protocol_exports = {};
__export(iiyama_protocol_exports, {
  CommandCode: () => CommandCode,
  IiyamaProtocol: () => IiyamaProtocol,
  InputSource: () => InputSource,
  PowerState: () => PowerState,
  ResponseHeader: () => ResponseHeader
});
module.exports = __toCommonJS(iiyama_protocol_exports);
var CommandCode = /* @__PURE__ */ ((CommandCode2) => {
  CommandCode2[CommandCode2["PLATFORM_VERSION"] = 162] = "PLATFORM_VERSION";
  CommandCode2[CommandCode2["MODEL_NUMBER_FW"] = 161] = "MODEL_NUMBER_FW";
  CommandCode2[CommandCode2["POWER_STATE_GET"] = 25] = "POWER_STATE_GET";
  CommandCode2[CommandCode2["POWER_STATE_SET"] = 24] = "POWER_STATE_SET";
  CommandCode2[CommandCode2["POWER_COLD_START_GET"] = 164] = "POWER_COLD_START_GET";
  CommandCode2[CommandCode2["POWER_COLD_START_SET"] = 163] = "POWER_COLD_START_SET";
  CommandCode2[CommandCode2["IR_LOCK_GET"] = 29] = "IR_LOCK_GET";
  CommandCode2[CommandCode2["IR_LOCK_SET"] = 28] = "IR_LOCK_SET";
  CommandCode2[CommandCode2["KEYPAD_LOCK_GET"] = 27] = "KEYPAD_LOCK_GET";
  CommandCode2[CommandCode2["KEYPAD_LOCK_SET"] = 26] = "KEYPAD_LOCK_SET";
  CommandCode2[CommandCode2["INPUT_SOURCE_SET"] = 172] = "INPUT_SOURCE_SET";
  CommandCode2[CommandCode2["CURRENT_SOURCE_GET"] = 173] = "CURRENT_SOURCE_GET";
  CommandCode2[CommandCode2["VIDEO_PARAMS_GET"] = 51] = "VIDEO_PARAMS_GET";
  CommandCode2[CommandCode2["VIDEO_PARAMS_SET"] = 50] = "VIDEO_PARAMS_SET";
  CommandCode2[CommandCode2["COLOR_TEMP_GET"] = 53] = "COLOR_TEMP_GET";
  CommandCode2[CommandCode2["COLOR_TEMP_SET"] = 52] = "COLOR_TEMP_SET";
  CommandCode2[CommandCode2["COLOR_PARAMS_GET"] = 55] = "COLOR_PARAMS_GET";
  CommandCode2[CommandCode2["COLOR_PARAMS_SET"] = 54] = "COLOR_PARAMS_SET";
  CommandCode2[CommandCode2["PICTURE_FORMAT_GET"] = 59] = "PICTURE_FORMAT_GET";
  CommandCode2[CommandCode2["PICTURE_FORMAT_SET"] = 58] = "PICTURE_FORMAT_SET";
  CommandCode2[CommandCode2["VOLUME_GET"] = 69] = "VOLUME_GET";
  CommandCode2[CommandCode2["VOLUME_SET"] = 68] = "VOLUME_SET";
  CommandCode2[CommandCode2["VOLUME_LIMITS_SET"] = 184] = "VOLUME_LIMITS_SET";
  CommandCode2[CommandCode2["AUDIO_PARAMS_GET"] = 67] = "AUDIO_PARAMS_GET";
  CommandCode2[CommandCode2["AUDIO_PARAMS_SET"] = 66] = "AUDIO_PARAMS_SET";
  CommandCode2[CommandCode2["OPERATING_HOURS_GET"] = 15] = "OPERATING_HOURS_GET";
  CommandCode2[CommandCode2["AUTO_ADJUST"] = 112] = "AUTO_ADJUST";
  CommandCode2[CommandCode2["SERIAL_CODE_GET"] = 21] = "SERIAL_CODE_GET";
  CommandCode2[CommandCode2["SCHEDULING_GET"] = 91] = "SCHEDULING_GET";
  CommandCode2[CommandCode2["SCHEDULING_SET"] = 90] = "SCHEDULING_SET";
  CommandCode2[CommandCode2["LANGUAGE_GET"] = 192] = "LANGUAGE_GET";
  CommandCode2[CommandCode2["LANGUAGE_SET"] = 193] = "LANGUAGE_SET";
  CommandCode2[CommandCode2["PIXEL_SHIFT_GET"] = 177] = "PIXEL_SHIFT_GET";
  CommandCode2[CommandCode2["PIXEL_SHIFT_SET"] = 178] = "PIXEL_SHIFT_SET";
  return CommandCode2;
})(CommandCode || {});
var InputSource = /* @__PURE__ */ ((InputSource2) => {
  InputSource2[InputSource2["NULL"] = 0] = "NULL";
  InputSource2[InputSource2["VIDEO"] = 1] = "VIDEO";
  InputSource2[InputSource2["S_VIDEO"] = 2] = "S_VIDEO";
  InputSource2[InputSource2["COMPONENT"] = 3] = "COMPONENT";
  InputSource2[InputSource2["VGA"] = 5] = "VGA";
  InputSource2[InputSource2["HDMI_2"] = 6] = "HDMI_2";
  InputSource2[InputSource2["DISPLAY_PORT_2"] = 7] = "DISPLAY_PORT_2";
  InputSource2[InputSource2["USB_2"] = 8] = "USB_2";
  InputSource2[InputSource2["CARD_DVI_D"] = 9] = "CARD_DVI_D";
  InputSource2[InputSource2["DISPLAY_PORT"] = 10] = "DISPLAY_PORT";
  InputSource2[InputSource2["CARD_OPS"] = 11] = "CARD_OPS";
  InputSource2[InputSource2["USB"] = 12] = "USB";
  InputSource2[InputSource2["HDMI"] = 13] = "HDMI";
  InputSource2[InputSource2["DVI_D"] = 14] = "DVI_D";
  InputSource2[InputSource2["HDMI_3"] = 15] = "HDMI_3";
  InputSource2[InputSource2["BROWSER"] = 16] = "BROWSER";
  InputSource2[InputSource2["SMARTCMS"] = 17] = "SMARTCMS";
  InputSource2[InputSource2["DMS"] = 18] = "DMS";
  InputSource2[InputSource2["INTERNAL_STORAGE"] = 19] = "INTERNAL_STORAGE";
  InputSource2[InputSource2["MEDIA_PLAYER"] = 22] = "MEDIA_PLAYER";
  InputSource2[InputSource2["PDF_PLAYER"] = 23] = "PDF_PLAYER";
  InputSource2[InputSource2["CUSTOM"] = 24] = "CUSTOM";
  InputSource2[InputSource2["HDMI_4"] = 25] = "HDMI_4";
  return InputSource2;
})(InputSource || {});
var PowerState = /* @__PURE__ */ ((PowerState2) => {
  PowerState2[PowerState2["OFF"] = 1] = "OFF";
  PowerState2[PowerState2["ON"] = 2] = "ON";
  return PowerState2;
})(PowerState || {});
var ResponseHeader = /* @__PURE__ */ ((ResponseHeader2) => {
  ResponseHeader2[ResponseHeader2["REPORT"] = 33] = "REPORT";
  return ResponseHeader2;
})(ResponseHeader || {});
class IiyamaProtocol {
  static HEADER = 166;
  static CATEGORY = 0;
  static PAGE = 0;
  static DATA_CONTROL = 1;
  /**
   * Build a command packet
   * Packet format: [HEADER][MONITOR_ID][CATEGORY][PAGE][MSG_TYPE][LENGTH][DATA_CONTROL][CMD_CODE][DATA...][CHECKSUM]
   *
   * @param monitorId
   * @param commandCode
   * @param data
   */
  static buildCommand(monitorId, commandCode, data = []) {
    const length = data.length + 3;
    const packet = [
      this.HEADER,
      monitorId,
      this.CATEGORY,
      this.PAGE,
      0,
      // Message type
      length,
      this.DATA_CONTROL,
      commandCode,
      ...data
    ];
    const checksum = packet.reduce((acc, byte) => acc ^ byte, 0);
    packet.push(checksum);
    return Buffer.from(packet);
  }
  /**
   * Parse a response packet
   * Response format: [HEADER][MONITOR_ID][CATEGORY][PAGE][LENGTH][DATA_CONTROL][CMD_CODE][DATA...][CHECKSUM]
   * Note: Response format does NOT have the message type byte that commands have
   *
   * @param buffer
   */
  static parseResponse(buffer) {
    if (buffer.length < 9) {
      return null;
    }
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
    const commandCode = buffer[6];
    const data = [];
    for (let i = 7; i < buffer.length - 1; i++) {
      data.push(buffer[i]);
    }
    return {
      monitorId,
      commandCode,
      data,
      isAck: header === 33 /* REPORT */
    };
  }
  /**
   * Build power state command
   *
   * @param monitorId
   * @param powerOn
   */
  static buildPowerCommand(monitorId, powerOn) {
    return this.buildCommand(monitorId, 24 /* POWER_STATE_SET */, [powerOn ? 2 /* ON */ : 1 /* OFF */]);
  }
  /**
   * Build get power state command
   *
   * @param monitorId
   */
  static buildGetPowerCommand(monitorId) {
    return this.buildCommand(monitorId, 25 /* POWER_STATE_GET */);
  }
  /**
   * Build input source command
   *
   * @param monitorId
   * @param source
   */
  static buildInputSourceCommand(monitorId, source) {
    return this.buildCommand(monitorId, 172 /* INPUT_SOURCE_SET */, [source, 0, 0, 0]);
  }
  /**
   * Build get current source command
   *
   * @param monitorId
   */
  static buildGetCurrentSourceCommand(monitorId) {
    return this.buildCommand(monitorId, 173 /* CURRENT_SOURCE_GET */);
  }
  /**
   * Build volume command
   *
   * @param monitorId
   * @param volume
   * @param audioOut
   */
  static buildVolumeCommand(monitorId, volume, audioOut) {
    return this.buildCommand(monitorId, 68 /* VOLUME_SET */, [volume, audioOut]);
  }
  /**
   * Build get volume command
   *
   * @param monitorId
   */
  static buildGetVolumeCommand(monitorId) {
    return this.buildCommand(monitorId, 69 /* VOLUME_GET */);
  }
  /**
   * Build video parameters command
   *
   * @param monitorId
   * @param brightness
   * @param color
   * @param contrast
   * @param sharpness
   * @param tint
   * @param blackLevel
   * @param gamma
   */
  static buildVideoParamsCommand(monitorId, brightness, color, contrast, sharpness, tint, blackLevel, gamma) {
    return this.buildCommand(monitorId, 50 /* VIDEO_PARAMS_SET */, [
      brightness,
      color,
      contrast,
      sharpness,
      tint,
      blackLevel,
      gamma
    ]);
  }
  /**
   * Build get video parameters command
   *
   * @param monitorId
   */
  static buildGetVideoParamsCommand(monitorId) {
    return this.buildCommand(monitorId, 51 /* VIDEO_PARAMS_GET */);
  }
  /**
   * Build color temperature command
   *
   * @param monitorId
   * @param colorTemp
   */
  static buildColorTempCommand(monitorId, colorTemp) {
    return this.buildCommand(monitorId, 52 /* COLOR_TEMP_SET */, [colorTemp]);
  }
  /**
   * Build get color temperature command
   *
   * @param monitorId
   */
  static buildGetColorTempCommand(monitorId) {
    return this.buildCommand(monitorId, 53 /* COLOR_TEMP_GET */);
  }
  /**
   * Build picture format command
   *
   * @param monitorId
   * @param format
   */
  static buildPictureFormatCommand(monitorId, format) {
    return this.buildCommand(monitorId, 58 /* PICTURE_FORMAT_SET */, [format]);
  }
  /**
   * Build get picture format command
   *
   * @param monitorId
   */
  static buildGetPictureFormatCommand(monitorId) {
    return this.buildCommand(monitorId, 59 /* PICTURE_FORMAT_GET */);
  }
  /**
   * Build audio parameters command
   *
   * @param monitorId
   * @param treble
   * @param bass
   */
  static buildAudioParamsCommand(monitorId, treble, bass) {
    return this.buildCommand(monitorId, 66 /* AUDIO_PARAMS_SET */, [treble, bass]);
  }
  /**
   * Build get audio parameters command
   *
   * @param monitorId
   */
  static buildGetAudioParamsCommand(monitorId) {
    return this.buildCommand(monitorId, 67 /* AUDIO_PARAMS_GET */);
  }
  /**
   * Build get operating hours command
   *
   * @param monitorId
   */
  static buildGetOperatingHoursCommand(monitorId) {
    return this.buildCommand(monitorId, 15 /* OPERATING_HOURS_GET */, [2]);
  }
  /**
   * Build get serial code command
   *
   * @param monitorId
   */
  static buildGetSerialCodeCommand(monitorId) {
    return this.buildCommand(monitorId, 21 /* SERIAL_CODE_GET */);
  }
  /**
   * Build auto adjust command (VGA only)
   *
   * @param monitorId
   */
  static buildAutoAdjustCommand(monitorId) {
    return this.buildCommand(monitorId, 112 /* AUTO_ADJUST */, [64, 0]);
  }
  /**
   * Build IR lock command
   *
   * @param monitorId
   * @param lockState
   */
  static buildIRLockCommand(monitorId, lockState) {
    return this.buildCommand(monitorId, 28 /* IR_LOCK_SET */, [lockState]);
  }
  /**
   * Build get IR lock command
   *
   * @param monitorId
   */
  static buildGetIRLockCommand(monitorId) {
    return this.buildCommand(monitorId, 29 /* IR_LOCK_GET */);
  }
  /**
   * Build keypad lock command
   *
   * @param monitorId
   * @param lockState
   */
  static buildKeypadLockCommand(monitorId, lockState) {
    return this.buildCommand(monitorId, 26 /* KEYPAD_LOCK_SET */, [lockState]);
  }
  /**
   * Build get keypad lock command
   *
   * @param monitorId
   */
  static buildGetKeypadLockCommand(monitorId) {
    return this.buildCommand(monitorId, 27 /* KEYPAD_LOCK_GET */);
  }
  /**
   * Build language command
   *
   * @param monitorId
   * @param language
   */
  static buildLanguageCommand(monitorId, language) {
    return this.buildCommand(monitorId, 193 /* LANGUAGE_SET */, [language]);
  }
  /**
   * Build get language command
   *
   * @param monitorId
   */
  static buildGetLanguageCommand(monitorId) {
    return this.buildCommand(monitorId, 192 /* LANGUAGE_GET */);
  }
  /**
   * Build pixel shift command
   *
   * @param monitorId
   * @param value
   */
  static buildPixelShiftCommand(monitorId, value) {
    return this.buildCommand(monitorId, 178 /* PIXEL_SHIFT_SET */, [value]);
  }
  /**
   * Build get pixel shift command
   *
   * @param monitorId
   */
  static buildGetPixelShiftCommand(monitorId) {
    return this.buildCommand(monitorId, 177 /* PIXEL_SHIFT_GET */);
  }
  /**
   * Build get model/FW version command
   *
   * @param monitorId
   * @param type
   */
  static buildGetModelFWCommand(monitorId, type) {
    return this.buildCommand(monitorId, 161 /* MODEL_NUMBER_FW */, [type]);
  }
  /**
   * Parse power state from response
   *
   * @param response
   */
  static parsePowerState(response) {
    if (response.commandCode === 25 /* POWER_STATE_GET */ && response.data.length >= 1) {
      return response.data[0] === 2 /* ON */;
    }
    return null;
  }
  /**
   * Parse input source from response
   *
   * @param response
   */
  static parseInputSource(response) {
    if (response.commandCode === 173 /* CURRENT_SOURCE_GET */ && response.data.length >= 1) {
      return response.data[0];
    }
    return null;
  }
  /**
   * Parse volume from response
   *
   * @param response
   */
  static parseVolume(response) {
    if (response.commandCode === 69 /* VOLUME_GET */ && response.data.length >= 2) {
      return {
        volume: response.data[0],
        audioOut: response.data[1]
      };
    }
    return null;
  }
  /**
   * Parse video parameters from response
   *
   * @param response
   */
  static parseVideoParams(response) {
    if (response.commandCode === 51 /* VIDEO_PARAMS_GET */ && response.data.length >= 7) {
      return {
        brightness: response.data[0],
        color: response.data[1],
        contrast: response.data[2],
        sharpness: response.data[3],
        tint: response.data[4],
        blackLevel: response.data[5],
        gamma: response.data[6]
      };
    }
    return null;
  }
  /**
   * Parse operating hours from response
   *
   * @param response
   */
  static parseOperatingHours(response) {
    if (response.commandCode === 15 /* OPERATING_HOURS_GET */ && response.data.length >= 2) {
      return response.data[0] << 8 | response.data[1];
    }
    return null;
  }
  /**
   * Parse serial code from response
   *
   * @param response
   */
  static parseSerialCode(response) {
    if (response.commandCode === 21 /* SERIAL_CODE_GET */ && response.data.length >= 1) {
      return String.fromCharCode(...response.data);
    }
    return null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CommandCode,
  IiyamaProtocol,
  InputSource,
  PowerState,
  ResponseHeader
});
//# sourceMappingURL=iiyama-protocol.js.map
