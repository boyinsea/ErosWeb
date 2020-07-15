'use strict';
import { ET312Base } from './ET312.js';

/**
 * @classdesc Encapsulates higher-level ET-312 functions
 */
class ET312Controller {

	/**
	 * Sets up an ET312 Controller object and initializes "static" structures.
	 *
	 * @constructor
	 */
	constructor(unit) {
		if (unit instanceof ET312Base) {
			this._et312 = unit;
		} else {
			throw new Error(`Invalid object: expected ET312Base, got ${typeof(unit)}.`);
		}

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
			ADC1: { address: 0x4061, description: "Multi-adjust knob position", heartbeat: true },
			ADC4: { address: 0x4064, description: "Level A Knob Position", heartbeat: true },
			ADC5: { address: 0x4065, description: "Level B Knob Position", heartbeat: true },
			ADC6: { address: 0x4066, description: "Audio Input Level A", heartbeat: true },
			ADC7: { address: 0x4067, description: "Audio Input Level B", heartbeat: true },
			MENUSTATE: { address: 0x406D, description: "Menu State" },
			//		MENULOW: { address: 0x4079, description: "Lowest Selectable Menu Item/Mode" },
			//		MENUHIGH: { address: 0x407A, description: "Highest Selectable Menu Item/Mode" },
			MODENUM: { address: 0x407b, description: "Current mode number", heartbeat: true },
			CONTROLFLAGS: { address: 0x4083, description: "Control Flags" },
			//		SCRATCH: { address: 0x4093, description: "Overwritten with 0 when a program starts" },
			MAVALUE: { address: 0x420d, description: "Current Multi-Adjust value", heartbeat: true },
			MALOW: { address: 0x4086, description: "Low end of Multi-Adjust range", heartbeat: true },
			MAHIGH: { address: 0x4087, description: "High end of Multi-Adjust range", heartbeat: true },
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
			A_PACE: { address: 0x41ff, description: "Advanced Parameter: Pace" }
		};

		/*
		SYSTEM FLAGS
		Bit	Description
		0	Disable ADC (pots etc) (SYSTEMFLAGPOTSDISABLEMASK)
		1	If set then we jump to a new module number given in $4084
		2	Can this program be shared with a slave unit
		3	Disable Multi Adjust (SYSTEMFLAGMULTIAPOTDISABLEMASK)
		4-7	unused
		If bit 0 is set the ADC data is ignored, so effectively disabling the the front panel potentiometers.
		You can then send commands to change the A, B, and MA levels directly.
		Enabling again sets the unit back to the actual potentiometer values.

		To set the A level write to $4064 (CurrentLevelA 0-255),
		to set the B level write to $4065 (CurrentLevel B 0-255),
		to set the MA write to $420D (Current Multi Adjust Value, range from min at $4086 to max at $4087).

		CONTROL FLAGS
		Phase, Front Panel, Mute/Mono/Stereo Control
		Value	Description
		0x01	Phase Control
		0x02	Mute
		0x04	Phase Control 2
		0x08	Phase Control 3
		0x20	Disable Frontpanel Switches
		0x40	Mono Mode (off=Stereo)
		Note: ErosLink uses the following masks:

		0x00 - CONTROLFLAGNORMALMASK
		0x04 - CONTROLFLAGALLOWOVERLAPMASK
		0x05 - CONTROLFLAGPHASEMASK
		0x20 - CONTROLFLAGDISABLESWITCHESMASK
		*/

		this.lastHeartbeat = 0;
	}

	// Retrieve current box status.
	// heartbeat
	//	false or NULL = returns complete status data
	//	true = always returns concise heartbeat data
	//  number = returns concise heartbeat data IF sufficient time has
	//		elapsed since the last heartbeat request, otherwise returns
	//		NULL.
	async getInfo(heartbeat) {
		let result = {heartbeat: Boolean(heartbeat)};
		if ('number' == typeof (heartbeat)) {
			if ((Date.now() - this.lastHeartbeat) < heartbeat) return null;
		}
		for (const property in this.DEVICE) {
			if (!heartbeat || (result.heartbeat == this.DEVICE[property].heartbeat))
				result[property] = await this.getValue(property);
		}
		if (heartbeat) this.lastHeartbeat = Date.now();
		return result;
	}

	// Writes the given command(s) to address 0x4070, waiting
	// at least 20ms for each command to execute.
	async executeCommands(commands) {
		const values = await Promise.all([
			this._et312.writeAddress(0x4070, commands),
			new Promise((resolve, _) => { setTimeout(resolve, 20 * commands.length); })
		]);
		return values[0];
	}

	async getValue(property) {
		if ('object' != typeof (property)) property = this.DEVICE[property];
		return await this._et312.readAddress(property.address);
	}

	// Write a value (passed as an array) to the indicated address, which
	// can either be a DEVICE.property "enumeration" value or a numeric
	// address.
	// Returns true if the value was written successfully
	async setValue(property, value) {
		let address;
		if ('object' == typeof (property)) address = property.address;
		else if ('number' == typeof (property)) address = property;
		else address = this.DEVICE[property].address;
		const retVal = await this._et312.writeAddress(address, value);
		return ((retVal instanceof Uint8Array) && (6 == retVal[0]));
	}
	setValue = this.setValue.bind(this);

	async getMode() {
		const mode = await this._et312.readMode();
		return this.MODES[mode];
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
	async setMode(newMode) {
		if (!Number.isInteger(newMode)) {
			throw new Error(`Cannot set mode ${newMode}.  Expected integer, got ${typeof(newMode)}.`);
		}
		if ((0x8d != newMode) && ((0 == newMode) || (false == this.MODES.hasOwnProperty(newMode)))) {
			throw new Error(`Invalid Mode: ${newMode}`);
		}
		console.log(`Setting mode ${newMode}`);
		let result = await this._et312.writeAddress(0x4078, [newMode]);
		// console.log(`Result: ${result}; sending change mode command.`);
		result = await this.executeCommands([0x12]);
		// console.log(`Result: ${result}; retrieving heartbeat values...`);
		result = await this.getInfo(false);
		// console.log(`Result: ${result}`);
		if (0x01 & result.SYSTEMFLAGS) {
			let newMAVALUE = Math.round((result.MAHIGH - result.MALOW) / 2);
			console.log(`Remote control is active.  Setting multi-adjust value to ${newMAVALUE}`);
			await this.setValue(this.DEVICE.MAVALUE, [newMAVALUE]);
			// Fix up MAVALUE in result value so UI is correct
			result.MAVALUE = newMAVALUE;
		}
		// console.log('Done.');


		// ET-312 won't update it's display on a mode change command, so we need
		// to do this manually.  No need to wait for this to complete.  This
		// doesn't do anything in the case of a non-existent mode (ala STOP).
		if (newMode <= result.TOPMODE) this.display_mode_name(newMode);

		return result;
	}
	setMode = this.setMode.bind(this);

	// Immediately stop stim output by changing to a non-existent mode
	async stop() {
		let result = await this.setMode(0x8d);
		this.display_mode_name('-PAUSED-');
		return result;
	}
	stop = this.stop.bind(this);

	// Clear the mode name in the display
	async display_clear_mode_name() {
		this._et312.writeAddress(0x4180, [0x64]); // Stringtable index
		this._et312.executeCommands([0x15]); // Write stringtable entry to display
	}

	// Write a message to the display.
	// Line 0-1, Position 0-15
	async display_write(message, line = 0, start = 0) {
		if ((message.length < 1) || (message.length > 16))
			throw new Error('Display message must be 1-16 characters long');
		if ((line < 0) || (line > 1))
			throw new Error('Line must be either 0 or 1');
		if ((start < 0) || (start > 15))
			throw new Error('Starting position must be between 0 and 15');
		if (message.length + start > 16)
			throw new Error('Message is too long to write at that position');
		// console.log(`Begin display write [${message}]`);

		for (let pos = 0; pos < message.length; pos++) {
			// console.log(`${pos} = ${message.charAt(pos)}`);
			await this._et312.writeAddress(0x4180, [message.charCodeAt(pos), start + pos + (line << 6)]);
			// console.log('Sending WRITE command');
			await this.executeCommands([0x13]);
		}
	}

	// Display a standard mode name from stringtable
	async display_mode_name(mode) {

		if ('string' == typeof (mode)) {
			let text = mode.substring(0, 8);
			await this.display_write(text.padEnd(8), 0, 8);
		} else {
			// Mode number is just a stringtable offset.
			await this._et312.writeAddress(0x4180, [mode]);
			await this.executeCommands([0x15]);
		}
	}

	// Return true or false depending on whether or not this module has control
	// of the front-panel LEVEL and MULTI-ADJUST controls
	async hasControl() {
		const flags = await this.getValue(this.DEVICE.SYSTEMFLAGS);
		return Boolean(flags & 0x01);
	}

	// Take (status = true) or relenquish (status=false) control of LEVELS and MULTI-ADJUST.
	// Returns a box info object with a snapshot of current status, as well as the Promise for
	// the LCD update operation.  Calling functions can optionally wait for the display update
	// to complete.
	async takeControl(status) {
		console.log(`takeControl: ${status}`);
		let flags = await this.getValue(this.DEVICE.SYSTEMFLAGS);
		console.log(`current flags: ${flags}`);
		let newFlags = flags;
		if (status)
			newFlags |= 0x01;
		else
			newFlags &= ~0x01;
		console.log(`updated flags: ${newFlags}`);

		if (newFlags != flags) {
			await this.setValue(this.DEVICE.SYSTEMFLAGS, [newFlags]);
			console.log(`flags reset.`);
		}

		// Get snapshot of box status.
		const info = await this.getInfo();

		// Asynchronously update the BOX UI on change to let the user know
		// what is going on.  Do not wait for this to complete because display
		// writes take a long time.
		let P;
		if (status)
			P = this.display_write("\x7eErosWeb Control", 1, 0);
		else
			P = this.display_write("\x7eLocal Control".padEnd(16), 1, 0);

		console.log(info);
		console.log(P);
		return {info, P};
	}
}

export { ET312Controller };
