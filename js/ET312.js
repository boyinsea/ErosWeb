'use strict';
import { Mutex, Semaphore, withTimeout } from './lib/async-mutex.js';

/**
 * Generates an uint8 checksum for a packet. Checksums are generated any time a
 * packet returns data instead of an error code. For the ET-312, this means
 * during key exchange, and on reads.
 *
 * @param {UInt8Array} data uint8 array to create checksum for.
 * @returns {UInt8} Checksum value.
 * @private
 */
function generateChecksum(data) {
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
function verifyChecksum(data) {
	if (data.length < 2) throw new Error('Data packet too small for checksum.');
	const checksum = data[data.length - 1];
	if (checksum !== generateChecksum(data.slice(0, -1))) {
		throw new Error('Invalid checksum!');
	}
}

/**
 * @classdesc Provides connection and read/write capabilities for communicating
 * with the Erostek ET-312 electrostim unit.
 */
class ET312Base {
	/**
	 * Sets up an ET312 object.
	 *
	 * @constructor
	 */
	constructor() {
		this._key = null;
	}

	/**
	 * Function responsible for opening a connection. Connection type is based on
	 * subclass.
	 *
	 * @throws {Error} Exception thrown on opening error.
	 */
	async open() {
		throw new Error('Subclass should implement this function!');
	}

	/**
	 * Function that simulates a synchronous read/write exchange. For the ET312,
	 * all functions will write bytes, then expect a return. Due to how ET312
	 * communication works, it can be assumed that a value written to the ET312
	 * will get a response. Response length is also always known ahead of time.
	 *
	 * Note that in the situation where the ET312 is set to 'Master Link' mode while
	 * talking to the host, this function will fail, as bytes will be sent without
	 * a command having first been sent. However, operating with the PC host in
	 * slave mode is out of the scope of this library.
	 *
	 * @param {UInt8Array} data Data to send to ET312. Should have checksum appended
	 * and be encrypted (if needed).
	 * @param {uint8} length Amount of data to expect in the reply, in bytes.
	 * @returns {Promise} Promise that resolves (with a Buffer object) when
	 * expected number of bytes have arrived.
	 * @throws {Error} Throws on wrong read length (too many bytes read), or on
	 * invalid checksum.
	 * @private
	 */
	async writeAndExpect(data, length) {
		throw new Error('Subclass should implement this function!');
	}

	/**
	 * Encrypts a single byte to be transferred to the ET312. Encryption algorithm
	 * is an xor of the key exchanged with the ET312, the byte, and 0x55.
	 *
	 * @param {uint8} byte Byte to be encrypted.
	 * @returns {uint8} Encrypted byte.
	 * @private
	 */
	encryptByte(byte) {
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
	async keyExchange() {
		let packet = [0x2f, 0x00];
		packet.push(generateChecksum(packet));
		let data = await this.writeAndExpect(packet, 3);
		// Look for 0x21 in the data.  When recovering from a connection error,
		// excess data (typically 0x07) can precede the key-exchange packet.
		let packetStart = data.indexOf(0x21);
		if (-1 == packetStart) {
			throw new Error(`Not a key exchange packet - received [${data}], did not see 0x21.`);
		} else if (packetStart > 0) {
			let moreData = await this.writeAndExpect(null, packetStart);
			let newBuffer = new Uint8Array(3 + moreData.length);
			newBuffer.set(data);
			newBuffer.set(moreData, data.length);
			data = newBuffer;
		}
		this._key = data[packetStart + 1];
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
	async handshake() {

		console.log(`Begin handshake.  Our key is ${this._key}`);

		let sync_byte = 0x00;
		if (this._key) sync_byte = this.encryptByte(sync_byte);
		let data;
		for (let i = 0; i < 12; i++) {
			try {
				data = await this.writeAndExpect([sync_byte], 1);
			} catch (err) {
				if ('timeout' == err.message) continue;
				throw err;
			}
			if (data[0] == 0x7)
				return;
			else {
				console.warn(`Received ${data} expected 0x07.`);
			}
		}
		throw new Error('Handshake failed.' + ((data) ? "" : '  No reply.'));
	}

	/**
	 * Read the value from an address on the ET312. Addresses are mapped to a
	 * virtual space.
	 *
	 * - 0x0000 - 0x0200 - ROM (Last 512 bytes of Flash)
	 * - 0x4000 - 0x4400 - RAM (First 1k of RAM)
	 * - 0x8000 - 0x8200 - EEPROM (512 bytes of EEPROM)
	 *
	 * Any address values falling in between these ranges will repeat. e.g. 0x0230
	 * will translate to 0x0030.
	 *
	 * See memory table at https://www.buttshock.com/doc/et312/ for more
	 * information on memory tables and maps.
	 *
	 * @param {uint16} address Address to read a value from.
	 * @returns byte value at the address requested.
	 */
	async readAddress(address) {
		let packet = [0x3c, address >> 8, address & 0xff];
		packet.push(generateChecksum(packet));
		let data = await this.writeAndExpect(packet.map(this.encryptByte, this), 3);
		return data[1];
	}

	/**
	 * Write between 1-8 bytes to an address on the ET312. If more than one byte
	 * is written, the write is considered sequential. Addresses are mapped to a
	 * virtual space.
	 *
	 * - 0x0000 - 0x0200 - ROM (Last 512 bytes of Flash)
	 * - 0x4000 - 0x4400 - RAM (First 1k of RAM)
	 * - 0x8000 - 0x8200 - EEPROM (512 bytes of EEPROM)
	 *
	 * Any address values falling in between these ranges will repeat. e.g. 0x0230
	 * will translate to 0x0030.
	 *
	 * Writes to ROM will fail silently. Writes to RAM should be aware of values
	 * that are being written to, as mapped RAM space does contain registered and
	 * other important addresses that can affect operation.
	 *
	 * See memory table at https://www.buttshock.com/doc/et312/ for more
	 * information on memory tables and maps.
	 *
	 * Set the commandBytes parameter to (2) if more than one command is
	 * sent (the ET-312 will reply with one ACK per command).
	 *
	 * @param {uint16} address Address to write value(s) to.
	 * @param {array} cmd Array of 1-8 bytes to write to address requested.
	 * @throws {Error} Throws on wrong array size in arguments.
	 */
	async writeAddress(address, data, commandBytes = 1) {

		// console.log(`WriteAddress 0x${address.toString(16)} : [${data}]`);

		if (!(data instanceof Uint8Array) && !(data instanceof Array)) {
			throw new Error(`Wrong data type for write; expected Array or Uint8Array, got ${data.constructor.name}`);
		}
		if (data.length > 8) {
			throw new Error('Cannot write more than 8 bytes at once.');
		}
		if (data.length < 1) {
			throw new Error('Must write at least 1 byte.');
		}
		let packet = [((0x3 + data.length) << 0x4) | 0xd,
			address >> 8,
			address & 0xff
		];
		packet = packet.concat(data);
		packet.push(generateChecksum(packet));
		let result = await this.writeAndExpect(packet.map(this.encryptByte, this), commandBytes);
		return result;
	}

	/**
	 * Resets the crypto key on the ET312. This should be run before all
	 * disconnections and shutdowns, as otherwise the crypto key must be kept
	 * across ET312 power on/off sessions. By resetting the key at the end of a
	 * session, the usual handshake/key exchange initialization will work multiple
	 * times in the same power on/off session.
	 *
	 */
	async resetKey() {
		await this.writeAddress(0x4213, [0x0]);
		this._key = null;
	}

	/**
	 * Read the currently running mode for the box.
	 * @returns {Promise} Promise that resolves on successful read, with mode as
	 * argument.
	 */
	async readMode() {
		return await this.readAddress(0x407b);
	}
}

class ET312Serial extends ET312Base {

	/**
	 * Creates an ET312 object with a serial port connection via WebSerial API
	 *
	 * @constructor
	 */
	constructor(port) {
		super();
		this._port = port;
		if (!this._port) throw new Error('No port specified.');
		this._mutex = new Mutex(); // Used to synchronize read/write operations
	}

	/**
	 * Function that simulates a synchronous read/write exchange. For the ET312,
	 * all functions will write bytes, then expect a return. Due to how ET312
	 * communication works, it can be assumed that a value written to the ET312
	 * will get a response. Response length is also always known ahead of time.
	 *
	 * Note that in the situation where the ET312 is set to 'Master Link' mode while
	 * talking to the host, this function will fail, as bytes will be sent without
	 * a command having first been sent. However, operating with the PC host in
	 * slave mode is out of the scope of this library.
	 *
	 * Serial port specific implementation: Writes a value to the serial port, and
	 * waits for a specified number of bytes in reply.
	 *
	 * @param {UInt8Array} data Data to send to ET312. Should have checksum appended
	 * and be encrypted (if needed).
	 * @param {uint8} length Amount of data to expect in the reply, in bytes.
	 * @returns {Unit8Array} containging the expected number of bytes.
	 * @throws {Error} Throws on wrong read length (too many bytes read), invalid
	 *	checksum, or timeout/too few bytes read.
	 * @private
	 */
	async writeAndExpect(data, length) {
		// console.log(`${Date.now()} in writeAndExpect`);
		const release = await this._mutex.acquire(); // Make sure no one else is using the ET-312
		// console.log(`${Date.now()} Got mutex; proceeding...`);

		let buffer = new Uint8Array(0);
		try {
			if (data) {
				// console.log(`Writing: [${data}]; expecting ${length} bytes.`);
				await this._writer.write(new Uint8Array(data));
			}

			// Now read 'length' bytes from the stream
			// Time out if a response is not received promptly; this indicates that the
			// ET312 is not connected, turned on, or functioning properly.
			let t;
			while (buffer.length < length) {
				const { value, done } = await Promise.race([
					this._reader.read(),
					new Promise((_, reject) => t = setTimeout(() => {
						console.log(`Wrote: [${data}]; expecting ${length} bytes.`);
						console.log(`Received ${buffer.length} bytes so far: [${buffer}]; done: ${done}`);
						reject(new Error('timeout'));
					}, 1000))
				]);
				clearTimeout(t);

				// Append any new data to existing buffer
				if (value) buffer = Uint8Array.from([...buffer,...value]);

				// console.log(`Read: ${value}; done: ${done}; buffer: [${buffer}]`);
			}

			if (buffer.length > length) {
				buffer = buffer.slice(-1 * length);
				console.warn(`Excess serial data: was expecting ${length} bytes.  Returning [${buffer}].`);
			}

			// If key exchange has been completed and we are expecting more than 1 byte back,
			// assume we have a checksum.
			if (this._key && (length > 1)) verifyChecksum(buffer);

			// console.log(`Received OK: ${buffer}`);
			return buffer;
		} catch (err) {
			if ('timeout' == err.message) err.buffer = buffer;
			throw err;
		} finally {
			release();
		}
	}

	/**
	 * Function to request a port, open a connection, and prepare to communicate
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
	async connect() {
		try {
			// - Wait for the port to open.
			await this._port.open({
				baudrate: 19200
			});

			// Get ready to read and write stream
			this._reader = this._port.readable.getReader();
			this._writer = this._port.writable.getWriter();

			// Synchronize protocol
			await this.handshake();

			// Exchange keys
			await this.keyExchange();

			return true;
		} catch (err) {
			await this.close();
			throw err;
		}
	}

	// Close the connection to the ET-312.
	async close(force) {
		if (!this._port) {
			return;
		}

		if (this._writer) {
			if (this._key && !force) await this.resetKey();
			await this._writer.releaseLock();
			this._writer = null;
		}

		if (this._port.readable && this._reader) {
			await this._reader.cancel();
		}
		this._reader = null;
		await this._port.close();
		this._port = null;
	}
}

export { ET312Serial, ET312Base };
