'use strict';
//import { ET312Base } from './ET312.js';

/**
 * @classdesc Encapsulates higher-level ET-312 functions
 */
class ET312Remote {

	/**
	 * Sets up an ET312 Controller object and initializes "static" structures.
	 *
	 * @constructor
	 */
	constructor(dataConn) {
		// if (unit instanceof ET312Base) {
			this.connection = dataConn;
		// } else {
		// 	throw new Error(`Invalid object: expected ET312Base, got ${typeof(unit)}.`);
		// }

		this.MODES = {
			0: "None",
			0x76: "Waves",
			0x77: "Stroke",
			0x78: "Climb",
			0x79: "Combo",
			0x7a: "Intense",
			0x7b: "Rhythm",
			0x7c: "Audio 1",
			0x7d: "Audio 2",
			0x7e: "Audio 3",
			0x7f: "Split",
			0x80: "Random1",
			0x81: "Random2",
			0x82: "Toggle",
			0x83: "Orgasm",
			0x84: "Torment",
			0x85: "Phase 1",
			0x86: "Phase 2",
			0x87: "Phase 3",
			0x88: "User1",
			0x89: "User2",
			0x8a: "User3",
			0x8b: "User4",
			0x8c: "User5"
		};

		// Allowable sub-modes for "Split" mode
		this.SPLITMODES = [0x76, 0x77, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x88, 0x89, 0x8a, 0x8b, 0x8c];

		this.POWERLEVEL = { 1: "Low", 2: "Normal", 3: "High" };

		// This structure maps ET-312 memory addresses to friendly names.
		this.DEVICE = {
			SYSTEMFLAGS: { address: 0x400f, description: "System Flags", heartbeat: true },
			//		ADC0: { address: 0x4060, description: "Output Current Sense" },
			ADC1: { address: 0x4061, description: "Multi-adjust knob position" },
			ADC4: { address: 0x4064, description: "Level A Knob Position" },
			ADC5: { address: 0x4065, description: "Level B Knob Position" },
			ADC6: { address: 0x4066, description: "Audio Input Level A", heartbeat: true },
			ADC7: { address: 0x4067, description: "Audio Input Level B", heartbeat: true },
			MENUSTATE: { address: 0x406D, description: "Menu State" },
			//		MENULOW: { address: 0x4079, description: "Lowest Selectable Menu Item/Mode" },
			//		MENUHIGH: { address: 0x407A, description: "Highest Selectable Menu Item/Mode" },
			MODENUM: { address: 0x407b, description: "Current mode number", heartbeat: true },
			CONTROLFLAGS: { address: 0x4083, description: "Control Flags", heartbeat: true },
			RAMPVALUE: { address: 0x409c, description: "Ramp Value Counter", heartbeat: true },
			RAMPSELECT: { address: 0x40a3, description: "Ramp Select", heartbeat: true },
			//		SCRATCH: { address: 0x4093, description: "Overwritten with 0 when a program starts" },
			BATTERYLEVEL: { address: 0x4203, description: "Battery Level (0-255)" },
			MAVALUE: { address: 0x420d, description: "Multi-Adjust value" },
			MALOW: { address: 0x4086, description: "Low end of Multi-Adjust range" },
			MAHIGH: { address: 0x4087, description: "High end of Multi-Adjust range" },
			POWERLEVEL: { address: 0x41f4, description: "Power Level" }, // 1 Low - 3 High
			//		POWERA: { address: 0x406B, description: "Channel A Calibration" },
			//		POWERB: { address: 0x406C, description: "Channel B Calibration" },
			//		BATTERY: { address: 0x4203, description: "Battery Level (at boot)" },
			//		AGATE: { address: 0x4090, description: "Channel A Current Gate Value" },
			//		BGATE: { address: 0x4190, description: "Channel B Current Gate Value" }, // 0 when no output
			//		AINTENSITY: { address: 0x40a5, description: "Channel A Current Intensity Modulation Value" },
			//		BINTENSITY: { address: 0x41a5, description: "Channel B Current Intensity Modulation Value" },
			TOPMODE: { address: 0x41f3, description: "Highest available mode number" },
			SPLITA: { address: 0x41f5, description: "Split Mode Number A" },
			SPLITB: { address: 0x41f6, description: "Split Mode Number B" },
			A_RAMPLEVEL: { address: 0x41f8, description: "Advanced Parameter: Ramp Level" },
			A_RAMPTIME: { address: 0x41f9, description: "Advanced Parameter: Ramp Time" },
			A_DEPTH: { address: 0x41fa, description: "Advanced Parameter: Depth" },
			A_TEMPO: { address: 0x41fb, description: "Advanced Parameter: Tempo" },
			A_FREQUENCY: { address: 0x41fc, description: "Advanced Parameter: Frequency" },
			A_EFFECT: { address: 0x41fd, description: "Advanced Parameter: Effect" },
			A_WIDTH: { address: 0x41fe, description: "Advanced Parameter: Width" },
			A_PACE: { address: 0x41ff, description: "Advanced Parameter: Pace" },
			// 0x01 = Battery available; 0x02 = Power supply available
			POWERSTATUS: { address: 0x4215, description: "Power Status Bits" }
		};

		this._lastReportedMode = null;
	}

	_send(obj) {
		console.log("Send", obj);
		this.connection.send(obj);
	}

	// Read an info object received from the remote box and store relevant information
	info(i) {
		this._handshake = Boolean(i);
		if (i) {
			if (i.MODENUM) this._lastReportedMode = i.MODENUM;
		}
		else this._lastReportedMode = null;
	}

	// Last mode reported by box
	getMode() {
		return this.MODES[this._lastReportedMode];
	}

	// TRUE if box connection is active, FALSE if sub has affirmatively disconnected it
	// (this allows the UI to differentiate between an intentional disconnection and a
	// connection loss due to error.)
	getHandshake() {
		return this._handshake;
	}

	// async getValue(property) {
	// 	if ('object' != typeof (property)) property = this.DEVICE[property];
	// 	return await this._et312.readAddress(property.address);
	// }

	setValue(property, value) {
		if ('object' != typeof (property)) property = this.DEVICE[property];
		this._send({setValue: {address: property.address, value: value}});
	}

	// Special protocol for changing Mode aka running program.
	// This has to be done with a box command, as the "current running mode"
	// address is read-only.
	//
	// Changing the mode also changes the multi-adjust range and current value
	// (each program has a different m-a range).  If front-panel controls are
	// disabled (e.g., box is being remote controlled), we reset the range
	// to it's midpoint to prevent unintended consequences.
	//
	//		An alternative implementation would be to calculate the scale
	//		position of the (virtual) "knob" as it is before the mode change,
	//		then set the same position relative to the range of the new mode.
	//		This would more closely mimic the hardware behavior.
	setMode(newMode) {
		this._send({setMode: newMode});
	}

	setLevel(newLevel) {
		this._send({setLevel: newLevel});
	}

	startRamp() {
		this._send({startRamp: true});
	}

	// Immediately stop stim output by changing to a non-existent mode
	stop() {
		this._send({stop: true});
	}

	// Clear the mode name in the display
	display_clear_mode_name() {
	}

	// Write a message to the display.
	// Line 0-1, Position 0-15
	display_write(message, line = 0, start = 0) {
	}

	// Display a standard mode name from stringtable
	display_mode_name(mode) {
	}

}

export { ET312Remote };
