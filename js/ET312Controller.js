'use strict';

// Polyfill for Safari
import EventTarget from 'https://unpkg.com/@ungap/event-target@latest/esm/index.js'

/**
 * @classdesc Higher-level ET-312 functions, independent of communications medium.
 */
class ET312ControllerBase extends EventTarget {

	/**
	 * Sets up an ET312 Controller object and initializes "static" structures.
	 *
	 * @constructor
	 */
	constructor() {

		super();
		for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(this)))
			if (('constructor' !== method) && this[method] && this[method].bind) this[method] = this[method].bind(this);

		/*	CONSTANTS	*/

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
		// Properties tagged with "heartbeat: true" are included when sending a
		// "small" (vs. detailed) update of box status to a remote controller.

		// TODO: Flag some of these as "readonly=true" as appropriate.
		this.DEVICE = {
			SYSTEMFLAGS: { address: 0x400f, description: "System Flags", heartbeat: true },
			ADC1: { address: 0x4061, description: "Multi-adjust knob position" },
			ADC4: { address: 0x4064, description: "Level A Knob Position" },
			ADC5: { address: 0x4065, description: "Level B Knob Position" },
			ADC6: { address: 0x4066, description: "Audio Input Level A", heartbeat: true },
			ADC7: { address: 0x4067, description: "Audio Input Level B", heartbeat: true },
			MENUSTATE: { address: 0x406D, description: "Menu State" },
			MODENUM: { address: 0x407b, description: "Current mode number", heartbeat: true },
			CONTROLFLAGS: { address: 0x4083, description: "Control Flags"},
			RAMPVALUE: { address: 0x409c, description: "Ramp Value Counter", heartbeat: true },
			RAMPSELECT: { address: 0x40a3, description: "Ramp Select", heartbeat: true },
			BATTERYLEVEL: { address: 0x4203, description: "Battery Level (0-255)" },
			MAVALUE: { address: 0x420d, description: "Multi-Adjust value" },
			MALOW: { address: 0x4086, description: "Low end of Multi-Adjust range" },
			MAHIGH: { address: 0x4087, description: "High end of Multi-Adjust range" },
			POWERLEVEL: { address: 0x41f4, description: "Power Level" }, // 1 Low - 3 High
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
		for (const n in this.DEVICE) this.DEVICE[n].name = n;

		this.COMMAND = {
			setMode: null,
			setPowerLevel: null,
			startRamp: null,
			stop: null
		};
	}

	// Open a connection to the box. Connection type is based on subclass.
	async connect() {
		throw new Error('Subclass should implement open()!');
	}

	// Gracefully close the connection to the box
	async close() {
		throw new Error('Subclass should implement close()!');
	}

	// Report whether or not a box is connected.
	get connected() {
		throw new Error('Subclass should implement get connected()!');
	}

	// Request a snapshot of box status.  If “detailed” is TRUE, a comprehensive status report is returned.
	// Otherwise, returns a brief status report containing only variables that are likely to change.
	async requestStatus(detailed) {
		throw new Error('Subclass should implement getStatus()!');
	}

	// Sets the indicated parameter to the supplied value.  Value is scalar.
	async setValue(parameter, value) {
		throw new Error('Subclass should implement setValue()!');
	}

	// Execute a box-specific command
	async execute(command, parameters) {
		throw new Error('Subclass should implement execute()!');
	}


	/*
		I N T E R N A L   F U N C T I O N S
	*/

	// Emit a "status" message containing the result of a command
	_shareResult(result) {
		if (result) this.dispatchEvent(new CustomEvent('status', { detail: result }));
	}

	// Validate a property name or value and return the corresponding
	// ET-312 memory address.
	_propertyAddress(property, write = false) {

		let pd = property;
		if ('number' == typeof (property)) return property;
		if ('string' == typeof (property)) pd = this.DEVICE[property];
		if (!pd) throw new Error(`Invalid property ${property}`);
		if (write && pd.readonly) throw new Error(`setValue: Property ${property} is read-only.`);
		return pd.address;
	}

	// Raise an "error" event.  Calls to API functions should raise error events if they fail;
	// internal methods should throw errors for flow-control purposes and so they can be be
	// caught and processed appropriately.
	_raiseError(err, msg) {
		this.dispatchEvent(new ErrorEvent('error', {
			error: err,
			message: msg || err.message
		}));
	}

	/*
		UTILITIES
	*/

	// Configure a <select> element for each channel of the "split"
	// mode, based on the current box configuration.
	configureSplitSelect(selControl, currentMode, topMode) {
		selControl.options.length = 0; // Get rid of any existing options in selector

		for (const mode of this.SPLITMODES) {
			if (mode <= topMode) {
				const option = document.createElement("option");
				option.value = mode;
				option.text = this.MODES[mode];
				option.selected = (currentMode == mode);
				selControl.appendChild(option);
			}
		}
	}
}

export { ET312ControllerBase };
