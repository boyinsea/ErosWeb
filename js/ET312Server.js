'use strict';

// Enable a locally-connected ET-312 to be controlled over the network.
// 	|connection| must support a .send({JSON}) method.
//	Inbound control messages (in JSON format) should be passed to the
//		consumeMessage() function.
class ET312Server {

	// Forwards any from the ET312Controller over the connection.
	// The constructor should be called once the data connection is open.
	// The status of the ET312 controller (connected to a box, or not)
	//	isn't important.
	constructor(ctl, connection) {

		for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(this))) {
			if (('constructor' !== method) && this[method].bind) this[method] = this[method].bind(this);
		}

		this._HEARTBEAT_INTERVAL = 1000 * 5;
		this._lastHeartbeat = 0;
		this.conn = connection;

		ctl.addEventListener('connection', this._newConnection);
		ctl.addEventListener('close', this._forwardInfo);
		ctl.addEventListener('status', this._forwardInfo);
		ctl.addEventListener('error', this._forwardInfo);

		// Perform intial connection processing if the box is already connected.
		if (ctl.connected) this._newConnection({ target: ctl });

	}

	// Code to execute whenever a new remote connection is established with the box.
	// This can happen in two ways:
	//	1. A new ET312Server is created with a controller already connected to the,
	//		box in which case the constructor invokes this.
	//	2. A new box connection is established by an existing controller, and the
	//		'connection' event fires.
	_newConnection(e) {
		this._heartbeat = setInterval(() => {
			if (e.target.connected &&
				((Date.now() - this._lastHeartbeat) >= this._HEARTBEAT_INTERVAL)
			) e.target.requestStatus(false);
		}, this._HEARTBEAT_INTERVAL);
	}

	// Forwards messages in the form of "ET312" objects.
	_forwardInfo(e) {
		let msg;
		switch (e.type) {
		case "close":
			this._clearHeartbeat();
			msg = false;
			break;
		case "error":
			msg = { error: e.message };
			break;
		default:
			if ('heartbeat' in e.detail) this._lastHeartbeat = Date.now();
			msg = e.detail;
		}
		this.conn.send({ ET312: msg });

	}

	// Turn off "heartbeat" status monitoring, if any
	_clearHeartbeat() {
		if (this._heartbeat) clearInterval(this._heartbeat);
		this._heartbeat = null;
	}

	// Disconnect the server from the ET312Controller, for example,
	// when the underlying data connection closes.
	disconnect(ctl) {
		this._clearHeartbeat();
		ctl.removeEventListener('connection', this._newConnection);
		ctl.removeEventListener('close', this._forwardInfo);
		ctl.removeEventListener('status', this._forwardInfo);
		ctl.removeEventListener('error', this._forwardInfo);
	}

	// Process a box command received from the remote
	async consumeMessage(message, ctl) {

		if ("ET312" != message[0]) return false;
		const obj = message[1];
		if (!ctl.connected) {
			console.warn(message, `ET312 is not connected, message ignored.`);
		} else {
			for (const prop in obj) {
				const arg = obj[prop];
				switch (prop) {
				case 'execute':
					await ctl.execute(arg.command, arg.param);
					break;

				case 'setValue':
					await ctl.setValue(arg.property, arg.value);
					break;

				default:
					console.warn(`Unrecognized ET312 command: ${prop}`);
					break;
				}
			}
			return true;
		}
	}
}

export { ET312Server };
