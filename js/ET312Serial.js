'use strict';

// https://github.com/DirtyHairy/async-mutex (MIT)
import { Mutex } from './lib/async-mutex.js';
import { ET312ControllerBase } from './ET312Controller.js';

class ET312Serial extends ET312ControllerBase {

	/**
	 * Creates an ET312 object with a serial port connection via WebSerial API
	 *
	 * @constructor
	 */
	constructor() {
		super();
		this._port = null;
		this._status = {};
		this._connected = false;

		/*
			B O X   C O M M A N D S
		*/

		this.COMMAND = {
			// Change Mode, aka running program.
			//
			// This has to be done with a box command, as the "current running mode"
			// address is read-only.  And there are many side effects.
			setMode: async (newMode) => {
					if (!Number.isInteger(newMode)) {
						throw new Error(`Cannot set mode ${newMode}.  Expected integer, got ${typeof(newMode)}.`);
					}
					if ((0x8d != newMode) && ((0 == newMode) || !(newMode in this.MODES))) {
						throw new Error(`Invalid Mode: ${newMode}`);
					}
					let result = await this._writeAddress(0x4078, [newMode]);
					result = await this._executeCommands([0x12]);

					// Read detailed box configuration net of mode change.
					result = await this._readInfo(true);

					// Changing the mode also changes the multi-adjust range and current value
					// (each program has a different m-a range).  If front-panel controls are
					// disabled (e.g., box is being remote controlled), we reset the range
					// to it's midpoint to prevent unintended consequences.
					//
					//		An alternative implementation would be to calculate the scale
					//		position of the (virtual) "knob" as it is before the mode change,
					//		then set the same position relative to the range of the new mode.
					//		This would more closely mimic the hardware behavior.
					if (0x01 & result.SYSTEMFLAGS) {
						let newMAVALUE = Math.round((result.MAHIGH + result.MALOW) / 2);
						await this._writeAddress(this.DEVICE.MAVALUE, [newMAVALUE]);
						result.MAVALUE = newMAVALUE;	// Fix up MAVALUE in result data returned so UI is correct
					}

					// ET-312 won't update it's display on a mode change command, so we need
					// to do this manually.  No need to wait for this to complete.  This
					// doesn't do anything in the case of a non-existent mode (ala STOP).
					if (newMode <= result.TOPMODE) this._display_mode_name(newMode);
					return result;
				}

				//	Set Power Level 1-3 (0x6b = low, etc.)
				// 	This must be done with a box command; the power level cannot
				//	be updated directly.
				//	Box must be running a program (mode), otherwise an error occurs.
				,
			setPowerLevel: async (newLevel) => {
					const mode = await this._readAddress(this.DEVICE.MODENUM);
					if (mode == 0) {
						console.warn('Bad state for setting power level.');
						return null;
					}
					let result = await this._writeAddress(0x4078, [0x6a + newLevel]);
					result = await this._executeCommands([0x06]);
					result = await this._readAddress(this.DEVICE.POWERLEVEL);
					return { POWERLEVEL: result };
				}

				// Invoke box function to start power ramp
				,
			startRamp: async () => {
					await this._executeCommands([0x21]);
					const result = {
						RAMPSELECT: await this._readAddress(this.DEVICE.RAMPSELECT),
						RAMPVALUE: await this._readAddress(this.DEVICE.RAMPVALUE)
					};
					return result;
				}

				// Immediately stop stim output by changing to a non-existent mode
				,
			stop: async () => {
				let result = await this.COMMAND.setMode(0x8d);
				this._display_mode_name('-PAUSED-');
				return result;
			}
		}
	}

	/**
	 * Open a provided serial port and prepare to communicate
	 * with the ET-312 by handshaking and exchanging keys.
	 *
	 * @returns {boolean} TRUE if a connection has been established to the ET-312,
	 *	FALSE otherwise.
	 * @throws {Error} if communications cannot be established with the ET-312.
	 *
	 * If the wrong serial port is selected, the user must reload the page
	 * in order to select a new port.  Otherwise, subsequent connection attempts
	 * will use the same port (OK if the port is correct but the ET-312 was not
	 * connected, powered off, etc.).
	 */
	async connect(port) {

		if (!port) throw new Error('No port specified.');

		this._port = port;
		this._mutex = new Mutex(); // Used to synchronize read/write operations
		this.lastStatus = 0;

		const release = await this._mutex.acquire();
		try {
			await this._connectPort();
			await this._clearLine();
			await this._handshake(); // Synchronize protocol
			if (!this._key) this._key = await this._keyExchange(); // Exchange keys
			this.connected = true;
			return true;
		} catch (err) {
			await this.close(true);
			this._raiseError(err, 'Connection Failure');
		} finally {
			release();
		}
	}

	// Close the connection to the ET-312.
	// |force| = true forces closure of the serial port without
	// attemping to communicate with the box.
	async close(force) {

		if (!this._port) return;

		let release;
		try {
			// Clean up ET312 if possible
			if (!force) {
				if (await this.hasControl()) await this.takeControl(false);
				if (this._key) {
					// Reset the crypto key on the ET312. This should be run before all
					// disconnections and shutdowns so the usual handshake/key exchange
					// initialization will work multiple times in the same power on/off session.
					if (!this._mutex.isLocked()) release = await this._mutex.acquire();
					await this._writeAddress(0x4213, [0x0]);
					this._key = null;
				}
			}
			await this._resetPort();
		} catch (e) {
			console.warn(e, "––– Error while closing port");
		} finally {
			if (release) release();
			this._reader = null;
			this._port = null;
			this.connected = false;

			// A remoteControl event must *always* fire during a forced close, if needed
			if (force && (0x01 & this._status.SYSTEMFLAGS)) this.dispatchEvent(new CustomEvent('remoteControl', { detail: false }));
			this._status = {};
		}
	}

	// Report whether or not a box is connected.
	get connected() {
		return this._connected;
	}

	// Change connection state flag, emitting events as appropriate
	set connected(newState) {
		if (this._connected != newState) {
			this._connected = newState;
			if (newState)
				this.dispatchEvent(new Event('connection'));
			else
				this.dispatchEvent(new Event('close'));
		}
	}

	// Request a snapshot of box status.
	async requestStatus(detail) {
		const result = (this.connected) ? await this._exec(() => this._readInfo(detail)) : false;
		this._shareResult(result);
		return result;
	}

	// Sets the indicated box property to the supplied value.  (Value is scalar).
	async setValue(property, value) {
		if (!(value instanceof Array)) value = [value];
		const retVal = await this._exec(() => this._writeAddress(property, value));
		return ((retVal instanceof Uint8Array) && (6 == retVal[0]));
	}

	// Execute a box-specific command
	async execute(command, parameters) {
		if (!(command in this.COMMAND)) throw new Error(`${this.constructor.name} does not implement "${command}".`);

		const result = await this._exec(() => this.COMMAND[command](parameters));
		if (result) this._shareResult(result);
	}


	/*
		E X T E N S I O N S   (Specific to a direct Serial connection)
	*/

	// Return true or false depending on whether or not this module has control
	// of the front-panel LEVEL and MULTI-ADJUST controls
	async hasControl() {
		if (!this.connected) return false;

		const flags = await this._exec(() => this._readAddress(this.DEVICE.SYSTEMFLAGS));
		return Boolean(flags & 0x01);
	}

	// Take (status = true) or relinquish (status=false) control of LEVELS and MULTI-ADJUST.
	// Returns a box info object with a snapshot of current status.
	async takeControl(status) {
		let info;
		const release = await this._mutex.acquire();
		try {

			let flags = await this._readAddress(this.DEVICE.SYSTEMFLAGS);
			let newFlags = flags;
			if (status)
				newFlags |= 0x01;
			else
				newFlags &= ~0x01;
			if (newFlags != flags) await this._writeAddress(this.DEVICE.SYSTEMFLAGS, [newFlags]);
			info = await this._readInfo(true); 			// Get comprehensive report of box status.
		} finally {
			release();
		}

		this.dispatchEvent(new CustomEvent('remoteControl', { detail: Boolean(info.SYSTEMFLAGS & 0x01) }));
		this._shareResult(info);
		return info;
	}


	/*
		L O W - L E V E L   S E R I A L   U T I L I T I E S
	*/

	// Read any garbage/pending data on the serial line;
	// throw an error if the box needs to be reset.
	async _clearLine() {
		let { value, done } = await ET312Serial.timeout(500, this._reader.read())
			.catch(e => {
				if ("timeout" == e.message) return { value: null };
				else throw e;
			});

		// No data was waiting; reset reader
		if (null == value) {
			await this._resetPort();
			await this._connectPort();
		} else
			// Box is outputting mostly "7" -- it is in an error state.
			if (value.every((val, index, array) =>
					(0x07 == val) ||
					((index > 0) && (0x07 == array[index - 1])) ||
					((index < array.length - 1) && (0x07 == array[index + 1]))
				)) throw new Error('ET-312 Error State');
	}

	// Open the serial port and associated reader
	async _connectPort() {
		await this._port.open({
			baudrate: 19200,// Chrome uses this.
			baudRate: 19200	// Edge uses this.
		 });
		this._reader = this._port.readable.getReader();
		this.count = 0;
	}

	// Close the port, leaving it in a state to be open-able again
	async _resetPort() {
		if (this._port.readable && this._port.readable.locked && this._reader) {
			await this._reader.cancel();
			this._reader.releaseLock();
		}
		await this._port.close();
	}


	/*
		I N T E R N A L   F U N C T I O N S  which do things with the box.
	*/

	// General error-handling wrapper for executing API functions
	// (except open/close) which talk to the box.  This handles acquiring /
	// releasing the mutex controlling access to the box and prevents exceptions
	// from propagating outside this object and instead raises error events.
	async _exec(f) {
		const release = await this._mutex.acquire();
		try {
			return await f();
		} catch (e) {
			console.warn(e, "––– Error executing ET-312 API function");
			if (("timeout" == e.message) ||
				(("NetworkError" == e.name) && ("The device has been lost." == e.message)) ||
				("BreakError" == e.name)) {
				this._raiseError(e, "Connection Lost");

				// Force disconnection/cleanup; normal cleanup and shutdown
				// isn't possible since connection to the box has gone away.
				await this.close(true);
			} else {
				this._raiseError(e, "Unexpected Error");
			}
		} finally {
			release();
		}
	}

	/**
	* This is the primary function which communicates with the physical box.
	It simulates a low-level synchronous read/write exchange. For the ET312,
	 * all functions will write bytes, then expect a return. Due to how ET312
	 * communication works, it can be assumed that a value written to the ET312
	 * will get a response. Response length is also always known ahead of time.
	 *
	 * Serial port specific implementation: Writes a value to the serial port, and
	 * waits for a specified number of bytes in reply.
	 *
	 * @param {UInt8Array} data Data to send to ET312. Should have checksum appended
	 * and be encrypted (if needed).
	 * @param {uint8} length Amount of data to expect in the reply, in bytes.
	 */
	async _writeAndExpect(data, length) {

		// There is an issue with Windows and USB-to-Serial adapters which use the FTDI chipset.
		// The read() operation will hang if the data to be returned crosses a 255-byte threshold
		// (suspect some sort of buffer issue).  This code works around the problem by using one-
		// byte handshake messages to fill up and reset the buffer whenever an "overflow"
		// condition is anticipated.
		let newCount = ((this.count + length) % 255);
		if ((newCount > 0) && (newCount < (this.count % 255))) await this._handshake(newCount + 1);

		let buffer;
		try {

			const writer = this._port.writable.getWriter();
			writer.write(new Uint8Array(data));
			const writePromise = writer.close();

			// Read until at least |length| is read or the stream is closed
			const chunks = [];
			let actualLength = 0;
			while (true) {
				let { value, done } = await ET312Serial.timeout(500, this._reader.read());
				this.count += value.byteLength;
				chunks.push(value);
				actualLength += value.byteLength;
				if ((actualLength >= length) || done) break;
			}

			// It would be better to allocate |buffer| up front with the number of
			// of bytes expected but this is the best that can be done without a
			// BYOB reader to control the amount of data read.
			buffer = new Uint8Array(actualLength);
			chunks.reduce((offset, chunk) => {
				buffer.set(chunk, offset);
				return offset + chunk.byteLength;
			}, 0);

			await writePromise;

			if (buffer && (buffer.length > length)) buffer = buffer.slice(0, length);

			// If key exchange has been completed and we are expecting more than 1 byte back,
			// assume we have a checksum.
			if (this._key && (length > 1)) ET312Serial.verifyChecksum(buffer);

			return buffer;
		} catch (err) {
			if ('timeout' == err.message) err.buffer = buffer;
			throw err;
		}
	}

	// Read the byte value from an address on the ET312.
	async _readAddress(property) {
		const address = this._propertyAddress(property);
		let packet = [0x3c, address >> 8, address & 0xff];
		packet.push(ET312Serial.generateChecksum(packet));
		const data = await this._writeAndExpect(packet.map(this._encryptByte, this), 3);
		return data[1];
	}

	// Read either a small "heartbeat" snapshot (FALSE), a comprehensive
	// set of status information (TRUE), or the selected values (array)
	// from the box.  Cache the results locally to this object so the
	// latest status is available in case the box connection is lost.
	async _readInfo(detail) {
		let result = {};
		let srcObj;
		if (detail instanceof Array) {
			srcObj = detail;
			detail = true;
		} else {
			result.heartbeat = !detail;
			srcObj = Object.getOwnPropertyNames(this.DEVICE);
		}
		for (const property of srcObj) {
			const n = property.name || property;
			if (detail || this.DEVICE[n].heartbeat)
				result[n] = await this._readAddress(property);
		}
		Object.assign(this._status, result);
		return result;
	}

	// Write between 1-8 bytes to an address on the ET312.
	// Set the commandBytes parameter to (2) if more than one box command is
	// being written; the ET-312 will reply with one ACK per command.
	async _writeAddress(property, data, commandBytes = 1) {
		if (!(data instanceof Uint8Array) && !(data instanceof Array))
			throw new Error(`Wrong data type for write; expected Array or Uint8Array, got ${data.constructor.name}`);
		if (data.length > 8) throw new Error('Cannot write more than 8 bytes at once.');
		if (data.length < 1) throw new Error('Must write at least 1 byte.');

		const address = this._propertyAddress(property, true);

		let packet = [((0x3 + data.length) << 0x4) | 0xd,
			address >> 8,
			address & 0xff
		];
		packet = packet.concat(data);
		packet.push(ET312Serial.generateChecksum(packet));
		const result = await this._writeAndExpect(packet.map(this._encryptByte, this), commandBytes);
		return result;
	}

	// Writes the given command(s) to address 0x4070, waiting
	// at least 20ms for each command to execute.
	async _executeCommands(commands) {
		const values = await Promise.all([
			this._writeAddress(0x4070, commands),
			new Promise((resolve, _) => { setTimeout(resolve, 20 * commands.length); })
		]);
		return values[0];
	}

	/**
	 * Encrypts a single byte to be transferred to the ET312. Encryption algorithm
	 * is an xor of the key exchanged with the ET312, the byte, and 0x55.
	 *
	 * @param {uint8} byte Byte to be encrypted.
	 * @returns {uint8} Encrypted byte.
	 * @private
	 */
	_encryptByte(byte) {
		return byte ^ this._key ^ 0x55;
	}

	/**
	 * Exchange crypto keys with the ET312. A key is written to the ET312 (in this
	 * case, always 0x0), and then one is received back. The received key is used
	 * to encrypt all further communications with the ET312.
	 *
	 * @throws {Error} Error thrown if packet received from ET312 is not the one expected.
	 * @private
	 */
	async _keyExchange() {
		let packet = [0x2f, 0x00];
		packet.push(ET312Serial.generateChecksum(packet));
		let data = await this._writeAndExpect(packet, 3);
		// Look for 0x21 in the data.  When recovering from a connection error,
		// excess data (typically 0x07) can precede the key-exchange packet.
		let packetStart = data.indexOf(0x21);
		if (-1 == packetStart) {
			throw new Error(`Not a key exchange packet - received [${data}], did not see 0x21.`);
		} else if (packetStart > 0) {
			let moreData = await this._writeAndExpect(null, packetStart);
			let newBuffer = new Uint8Array(3 + moreData.length);
			newBuffer.set(data);
			newBuffer.set(moreData, data.length);
			data = newBuffer;
		}
		return data[packetStart + 1];
	}

	/**
	 * Handshake sent to the ET312 to establish communication and/or
	 * Realign packet boundaries for the protocol.
	  #
	  # If another program has accessed the ET-312 before this session, we're
	  # not sure what state it left the protocol in. Sending 0x0, possibly
	  # encrypted with the key that the box established prior to this
	  # session, should allow the box to realign the protocol. As the longest
	  # command possible is 11 bytes (a command to write 8 bytes to an
	  # address), we need to send up to 12 0s. Once we get back a 0x7, the
	  # protocol is synced and we can move on.
	 *
	 * @throws {Error} Error thrown if 0x7 is not received back.
	 * @private
	 */
	async _handshake(minBytes = 1) {
		let data, key_reset = false;	// Has encryption key been reset during this process?
		while (!key_reset) {
			let sync_byte = 0x00;
			if (this._key)
				sync_byte = this._encryptByte(sync_byte);
			else
				key_reset = true;
			for (let i = 1; i <= 12; i++) {
				try {
					data = await this._writeAndExpect([sync_byte], 1);
				} catch (err) {
					if ('timeout' == err.message) continue;
					throw err;
				}
				if ((data[0] == 0x7) && (i >= minBytes)) return;
			}
			this._key = null;
		}
		throw new Error('Handshake failed.' + ((data) ? "" : '  No reply.'));
	}

	// ***  Utilities to write to the box's LCD display  ***

	// Display a standard mode name from stringtable
	async _display_mode_name(mode) {

		const release = await this._mutex.acquire();
		try {
			if ('string' == typeof (mode)) {
				let text = mode.substring(0, 8);
				await this._display_write(text.padEnd(8), 0, 8);
			} else {
				if (null == mode) mode = 0x64; // Null mode name means write blanks.

				// Mode number is just a stringtable offset.
				await this._writeAddress(0x4180, [mode]);
				await this._executeCommands([0x15]);
			}
		} finally {
			release();
		}
	}

	// Write a message to the display.
	// Line 0-1, Position 0-15
	async _display_write(message, line = 0, start = 0) {
		if ((message.length < 1) || (message.length > 16))
			throw new Error('Display message must be 1-16 characters long');
		if ((line < 0) || (line > 1))
			throw new Error('Line must be either 0 or 1');
		if ((start < 0) || (start > 15))
			throw new Error('Starting position must be between 0 and 15');
		if (message.length + start > 16)
			throw new Error('Message is too long to write at that position');

		for (let pos = 0; pos < message.length; pos++) {
			await this._writeAddress(0x4180, [message.charCodeAt(pos), start + pos + (line << 6)]);
			await this._executeCommands([0x13]);
		}
	}


	/*
		U T I L I T Y   F U N C T I O N S
	*/

	// Throw an error if the promise (such as a read operation)
	// does not complete within ms milliseconds.
	static timeout(ms, promise) {
		return new Promise((resolve, reject) => {
			setTimeout(() => reject(new Error("timeout")), ms);
			promise.then(resolve, reject);
		});
	}

	/**
	 * Generates an uint8 checksum for a packet. Checksums are generated any time a
	 * packet returns data instead of an error code. For the ET-312, this means
	 * during key exchange, and on reads.
	 *
	 * @param {UInt8Array} data uint8 array to create checksum for.
	 * @returns {UInt8} Checksum value.
	 * @private
	 */
	static generateChecksum(data) {
		return data.reduce((accum, v) => accum + v) % 256;
	}

	/**
	 * Checks data in packet to make sure checksum matches. Packets with checksums
	 * will always have the checksum as the last byte in the packet.
	 *
	 * @param {UInt8Array} data packet (uint8 array) to verify checksum for.
	 * @throws {Error} Thrown if checksum does not match expected value or data
	 *	is not at least 2 bytes long.
	 * @private
	 */
	static verifyChecksum(data) {
		if (data.length < 2) throw new Error('Data packet too small for checksum.');
		const checksum = data[data.length - 1];
		if (checksum !== ET312Serial.generateChecksum(data.slice(0, -1))) {
			throw new Error('Invalid checksum!');
		}
	}
}

export { ET312Serial };
