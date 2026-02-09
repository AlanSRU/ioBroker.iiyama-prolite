![Logo](admin/iiyama.png)
# ioBroker.iiyama

[![NPM version](https://img.shields.io/npm/v/iobroker.iiyama.svg)](https://www.npmjs.com/package/iobroker.iiyama)
[![Downloads](https://img.shields.io/npm/dm/iobroker.iiyama.svg)](https://www.npmjs.com/package/iobroker.iiyama)
![Number of Installations](https://iobroker.live/badges/iiyama-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/iiyama-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.iiyama.png?downloads=true)](https://nodei.co/npm/iobroker.iiyama/)

**Tests:** ![Test and Release](https://github.com/Scottish Rugby/ioBroker.iiyama/workflows/Test%20and%20Release/badge.svg)

## iiyama adapter for ioBroker

Control iiyama ProLite displays via RS232 serial or TCP/IP (LAN) connection using the official iiyama communication protocol.

## Features

- **Dual Connection Support**: Control displays via RS232 serial port or TCP/IP network connection
- **Comprehensive Control**: Power, input source, volume, video and audio parameters
- **Real-time Monitoring**: Automatic polling of display status with configurable intervals
- **Multiple Display Models**: Supports ProLite LH series displays (see compatibility list)
- **Command Queuing**: Sequential command execution prevents communication errors

## Supported Display Models

- ProLite LH3252HS-B1
- ProLite LH4352UHS-B1
- ProLite LH5052UHS-B1
- ProLite LH5552UHS-B1
- ProLite LH6552UHS-B1
- ProLite LH9852UHS-B2
- ProLite LH4342UHS-B1/B3
- ProLite LH5042UHS-B1/B3
- ProLite LH5542UHS-B1/B3
- ProLite LH6542UHS-B1/B3
- ProLite LH7542UHS-B1/B3
- ProLite LH8642UHS-B1/B3

## Installation

1. Install the adapter from the ioBroker adapter repository
2. Configure the connection settings in the adapter configuration

## Configuration

### Connection Settings

**Connection Type**: Choose between TCP/IP (LAN) or Serial (RS232)

#### TCP/IP Connection
- **IP Address**: The IP address of the display
- **TCP Port**: Usually 5000 (default for iiyama displays)

#### Serial Connection
- **Serial Port**: Path to the serial device (e.g., `/dev/ttyUSB0` on Linux or `COM1` on Windows)
- **Baud Rate**:
  - 9600 for most models
  - 115200 for LHxx42UHS-B1 series only

### Display Settings

- **Monitor ID**: The ID configured on the display (1-255). Default is 1.
- **Poll Interval**: How often to update the display status (5-300 seconds). Default is 30 seconds.

## Usage

### Available States

#### Power Control
- `power` - Turn display on/off (boolean)

#### Input Sources
- `inputSource` - Select input source:
  - HDMI, HDMI 2, HDMI 3, HDMI 4
  - DVI-D
  - DisplayPort, DisplayPort 2
  - VGA
  - USB, USB 2

#### Volume
- `volume.main` - Main speaker volume (0-100%)
- `volume.audioOut` - Audio output volume (0-100%)

#### Video Settings
- `video.brightness` - Brightness (0-100%)
- `video.contrast` - Contrast (0-100%)
- `video.color` - Color saturation (0-100%)
- `video.sharpness` - Sharpness (0-100%)
- `video.tint` - Tint/Hue (0-100%)
- `video.blackLevel` - Black level (0-100%)
- `video.gamma` - Gamma curve selection
- `video.colorTemperature` - Color temperature preset
- `video.pictureFormat` - Picture format/aspect ratio

#### Audio Settings
- `audio.treble` - Treble level (0-10)
- `audio.bass` - Bass level (0-10)

#### Information (Read-only)
- `info.connection` - Connection status
- `info.operatingHours` - Total operating hours
- `info.serialCode` - Display serial number

#### Commands
- `commands.autoAdjust` - Trigger VGA auto-adjust (write `true`)

### Example Usage in Blockly/JavaScript

```javascript
// Turn display on
setState('iiyama.0.power', true);

// Switch to HDMI input
setState('iiyama.0.inputSource', 13); // 13 = HDMI

// Set volume to 50%
setState('iiyama.0.volume.main', 50);
setState('iiyama.0.volume.audioOut', 50);

// Adjust brightness
setState('iiyama.0.video.brightness', 75);
```

## Technical Details

### Protocol Implementation

This adapter implements the iiyama RS232 Serial Interface Communication Protocol as documented in the official Application Note. The protocol uses:

- **Packet Format**: Header (0xA6), Monitor ID, Category, Page, Function Code, Length, Data Control, Data, Checksum
- **Checksum**: XOR of all bytes except checksum
- **Response Timeout**: 500ms
- **Command Delay**: 100ms between commands to prevent buffer overflow

### Connection Management

- **Automatic Reconnection**: Up to 10 attempts with 5-second delays
- **Command Queuing**: Ensures commands are sent sequentially
- **Status Polling**: Regular updates of all display parameters

## Troubleshooting

### Display Not Responding

1. **Check physical connection**: Ensure cable is properly connected
2. **Verify IP address/port** (TCP) or **serial port** (RS232)
3. **Check Monitor ID**: Must match the ID configured on the display
4. **Serial connection issues**:
   - Verify baud rate (9600 or 115200 for B1 series)
   - Check serial port permissions on Linux: `sudo usermod -a -G dialout iobroker`
5. **TCP connection issues**:
   - Ensure display's "Power Save" setting is Mode 3 or Mode 4 for network wake-up
   - Check firewall settings

### Commands Not Working

- **Wait for responses**: The protocol requires waiting for acknowledgment between commands
- **Check OSD menu**: Only commands available in the display's OSD menu are guaranteed to work
- **Polling too frequent**: Increase poll interval if experiencing communication errors

## Changelog

### **WORK IN PROGRESS**
* (Alan Paris) Initial release
* Full protocol implementation for iiyama ProLite displays
* TCP/IP and Serial RS232 support
* Comprehensive state management
* Automatic status polling

## Developer manual

### DISCLAIMER

Please make sure that you consider copyrights and trademarks when you use names or logos of a company and add a disclaimer to your README.
You can check other adapters for examples or ask in the developer community. Using a name or logo of a company without permission may cause legal problems for you.

### Getting started

You are almost done, only a few steps left:
1. Create a new repository on GitHub with the name `ioBroker.iiyama`
1. Initialize the current folder as a new git repository:  
	```bash
	git init -b main
	git add .
	git commit -m "Initial commit"
	```
1. Link your local repository with the one on GitHub:  
	```bash
	git remote add origin https://github.com/Scottish Rugby/ioBroker.iiyama
	```

1. Push all files to the GitHub repo:  
	```bash
	git push origin main
	```
1. Add a new secret under https://github.com/Scottish Rugby/ioBroker.iiyama/settings/secrets. It must be named `AUTO_MERGE_TOKEN` and contain a personal access token with push access to the repository, e.g. yours. You can create a new token under https://github.com/settings/tokens.

1. Head over to [src/main.ts](src/main.ts) and start programming!

### Best Practices
We've collected some [best practices](https://github.com/ioBroker/ioBroker.repositories#development-and-coding-best-practices) regarding ioBroker development and coding in general. If you're new to ioBroker or Node.js, you should
check them out. If you're already experienced, you should also take a look at them - you might learn something new :)

### State Roles
When creating state objects, it is important to use the correct role for the state. The role defines how the state should be interpreted by visualizations and other adapters. For a list of available roles and their meanings, please refer to the [state roles documentation](https://www.iobroker.net/#en/documentation/dev/stateroles.md).

**Important:** Do not invent your own custom role names. If you need a role that is not part of the official list, please contact the ioBroker developer community for guidance and discussion about adding new roles.

### Scripts in `package.json`
Several npm scripts are predefined for your convenience. You can run them using `npm run <scriptname>`
| Script name | Description |
|-------------|-------------|
| `build` | Compile the TypeScript sources. |
| `watch` | Compile the TypeScript sources and watch for changes. |
| `test:ts` | Executes the tests you defined in `*.test.ts` files. |
| `test:package` | Ensures your `package.json` and `io-package.json` are valid. |
| `test:integration` | Tests the adapter startup with an actual instance of ioBroker. |
| `test` | Performs a minimal test run on package files and your tests. |
| `check` | Performs a type-check on your code (without compiling anything). |
| `lint` | Runs `ESLint` to check your code for formatting errors and potential bugs. |
| `translate` | Translates texts in your adapter to all required languages, see [`@iobroker/adapter-dev`](https://github.com/ioBroker/adapter-dev#manage-translations) for more details. |
| `release` | Creates a new release, see [`@alcalzone/release-script`](https://github.com/AlCalzone/release-script#usage) for more details. |

### Configuring the compilation
The adapter template uses [esbuild](https://esbuild.github.io/) to compile TypeScript and/or React code. You can configure many compilation settings 
either in `tsconfig.json` or by changing options for the build tasks. These options are described in detail in the
[`@iobroker/adapter-dev` documentation](https://github.com/ioBroker/adapter-dev#compile-adapter-files).

### Writing tests
When done right, testing code is invaluable, because it gives you the 
confidence to change your code while knowing exactly if and when 
something breaks. A good read on the topic of test-driven development 
is https://hackernoon.com/introduction-to-test-driven-development-tdd-61a13bc92d92. 
Although writing tests before the code might seem strange at first, but it has very 
clear upsides.

The template provides you with basic tests for the adapter startup and package files.
It is recommended that you add your own tests into the mix.

### Publishing the adapter
Using GitHub Actions, you can enable automatic releases on npm whenever you push a new git tag that matches the form 
`v<major>.<minor>.<patch>`. We **strongly recommend** that you do. The necessary steps are described in `.github/workflows/test-and-release.yml`.

Since you installed the release script, you can create a new
release simply by calling:
```bash
npm run release
```
Additional command line options for the release script are explained in the
[release-script documentation](https://github.com/AlCalzone/release-script#command-line).

To get your adapter released in ioBroker, please refer to the documentation 
of [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories#requirements-for-adapter-to-get-added-to-the-latest-repository).

### Test the adapter manually with dev-server
Since you set up `dev-server`, you can use it to run, test and debug your adapter.

You may start `dev-server` by calling from your dev directory:
```bash
dev-server watch
```

The ioBroker.admin interface will then be available at http://localhost:undefined/

Please refer to the [`dev-server` documentation](https://github.com/ioBroker/dev-server#command-line) for more details.

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (Alan Paris) initial release

## License
MIT License

Copyright (c) 2026 Alan Paris <alan.paris@scottish.rugby>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.