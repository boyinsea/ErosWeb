'use strict';
import { ET312ControllerBase } from './ET312Controller.js';

// Control a remote ET-312 over the network.
//	Inbound control messages (in JSON format) should be passed to the
//		consumeMessage() function.
class ET312Remote extends ET312ControllerBase {

	constructor() {
		super();
		this.dataConn = null;
		this._handshake = false;
		this._lastReportedMode = null;
		this._remoteControl = false;
	}

	// Open a connection to the remote box.
	// 	|connection| must support a .send({JSON}) method and
	//	route ET-312 messages to an "ET312Server" object.
	async connect(connection) {
		this.dataConn = connection;
	}

	// Gracefully close the connection to the box
	async close() {
		this.dataConn = null;
		this.remoteControl = false;
		this.dispatchEvent(new Event('close'));
	}

	// Report whether or not a box is connected and ready to accept commands
	get connected() {
		return ((null != this.dataConn) && (this._remoteControl));
	}

	// Request box status.  If “detailed” is TRUE, a comprehensive status report is returned.
	// Otherwise, returns a brief status report containing only variables that are likely to change.
	async requestStatus(detail) {
		this._send({ requestStatus: detail });
	}

	// Sets the indicated parameter to the supplied value.  Value is scalar.
	async setValue(parameter, value) {
		const propName = parameter.name || parameter;
		this._send({ setValue: { property: parameter, value: value } });
	}

	// Execute a box-specific command
	async execute(command, parameter) {
		let obj = { command: command };
		if (parameter) obj.param = parameter;
		this._send({ execute: obj });
	}

	get mode() {
		if (!this.connected) return null;
		else return this.MODES[this._lastReportedMode];
	}


	// Read an info object received from the remote box, store relevant information
	// and fire events as appropriate.  Returns TRUE if the message was processed,
	// FALSE otherwise.
	// |message| is a two-element array, [property, value]; e.g.:
	//		["ET312", {MODENUM: 0, SYSTEMFLAGS: 0}]
	consumeMessage(message) {

		if ("ET312" != message[0]) return false;
		const obj = message[1];

		const h = Boolean(obj);
		if (h != this._handshake) {
			this._handshake = h;
			if (h) this.dispatchEvent(new Event('connection'));
		}

		// "ET312: true" simply means that a box is there, with no
		// further detail to process.  This is sent as part of a
		// "welcome" message.
		if (true === obj) return true;

		this._shareResult(obj);	// Emit "status" event

		if (h) {
			if (obj.MODENUM) this._lastReportedMode = obj.MODENUM;
			if (obj.SYSTEMFLAGS) this.remoteControl = Boolean(obj.SYSTEMFLAGS & 0x01);
		} else {
			// ET312: false means that there is no remote box.
			this._lastReportedMode = null;
			this.remoteControl = false;
		}
		return true;
	}

	// Internal Functions

	_send(obj) {
		if (this.connected) this.dataConn.send({ ET312: obj });
		else console.warn('ET-312 is not connected.');
	}

	set remoteControl(rc) {
		if (rc != this._remoteControl) {
			this._remoteControl = rc;
			this.dispatchEvent(new CustomEvent('remoteControl', { detail: rc }));
		}
	}
}

export { ET312Remote };
