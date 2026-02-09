// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
			connectionType: 'tcp' | 'serial';
			host: string;
			port: number;
			serialPort: string;
			baudRate: number;
			monitorId: number;
			pollInterval: number;
			macAddress: string;
			powerSaveMode: 1 | 2 | 3 | 4;
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
