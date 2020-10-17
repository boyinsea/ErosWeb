'use strict';

/***
	A class to interact with the browser and configure audio-related UI elements
	like source/sink selectors, players, and drop targets.
*/
class AudioUI {

	constructor(setupFunction) {

		// for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(this)))
		// 	if (('constructor' !== method) && this[method] && this[method].bind) this[method] = this[method].bind(this);

		const dcr = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(this));
		for (const method in dcr)
			if (('constructor' !== method) && !dcr[method].get) this[method] = this[method].bind(this);
		// && this[method].bind


		this._audioCtx = null;
		this._allowReconfiguration = false;
		this.DEFAULT_NAME = {
			audiooutput: "Default Audio Output",
			audioinput: "Default Audio Input",
			videoinput: "Default Camera"
		};

		// Add a placeholder function to return the current remote connection, if any.
		// By default, this returns null.  The "configureForwarding" function may
		// replace this function with a new, user-supplied function that returns the
		// remote connection from the environment in which we are running.  [This is
		// done because there is no good way to store a "pointer" to the connection
		// state variable.]
		this.getConnection = () => { return null };

		window.addEventListener("click", () => {
			const ctx = this.AudioCtx;
			if ('running' != ctx.state) ctx.resume();
			if (setupFunction) setupFunction();
		}, { once: true });
	}

	get AudioCtx() {
		if (!this._audioCtx) this._audioCtx = new(window.AudioContext || window.webkitAudioContext)();
		return this._audioCtx;
	}

	get sourceSelectionEnabled() { return 'setSinkId' in HTMLMediaElement.prototype };

	// Attempt to ascertain the ability of the browser to enumerate available
	// audio devices, net of any permissions.  init() can be called multiple times
	// if we think the access permissions granted by the user have changed.
	//
	//	no devices at all => selection is not supported (e.g. Safari)
	//		* 0 == this.selectList.length
	//
	//	device exists, but deviceid value is null => not enabled
	//		* "" == this.selectList[0].deviceId
	//		-- try calling getUserMedia() before accessing a selector
	//
	//	at least one entry where deviceid is not null => enabled
	//		* "" != this.selectList[0].deviceId
	async init() {

		this.selectList = {
			audiooutput: [],
			audioinput: [],
			videoinput: []
		}

		const deviceInfos = await navigator.mediaDevices.enumerateDevices();
		for (const deviceInfo of deviceInfos) {
			const option = document.createElement('option');
			option.value = deviceInfo.deviceId;
			option.text = deviceInfo.label.replace(/\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)$/, "");

			if (deviceInfo.kind in this.selectList) {
				if ('' == option.text) option.text = this.DEFAULT_NAME[deviceInfo.kind];
				this.selectList[deviceInfo.kind].push(option);
			}
		}
	}

	// Configure a <select> element to serve as the input or output selector for a media element,
	// based on the environment configuration as determined by init.
	configureSelector(selectorDiv, player, kind = 'audiooutput') {

		if (!this.selectList) throw new Error("audioUI class not initialized.  Call init()");

		// selector could be a div containing a label, etc., as well as the <select> control.
		const selector = (selectorDiv instanceof HTMLSelectElement) ? selectorDiv : selectorDiv.querySelector("select");

		// Wire up function for retrieving value
		selectorDiv.getValue = () => { return selector.value; };

		// Configure selector
		selectorDiv.setAttribute('kind', kind);
		selector.options.length = 0; // Get rid of any existing options in selector
		const list = this.selectList[kind];

		if (('audiooutput' == kind) && !this.sourceSelectionEnabled) {

			// Device selection is not enabled, e.g. Safari
			this.createDefault(selector, kind);
			selector.disabled = true;

		} else if (list.length && ("" != list[0].value)) {
			// Device selection is enabled, and a choice of devices exists

			// Get previous default, if any
			let defaultDest = localStorage.getItem(selectorDiv.id);
			if (!defaultDest) defaultDest = 'default';

			// Populate select list, taking previous selection into account.
			list.forEach(child => {
				const c = child.cloneNode(true);
				if (c.value == defaultDest) c.selected = true;
				selector.appendChild(c);
			});

			// Wire up handler for selecting a new destination
			selector.addEventListener('change', async function (e) {
				localStorage.setItem(selectorDiv.id, e.target.value); // Save last-used value
				if (player) await player.setSinkId(e.target.value);
			});

			selectorDiv.hidden = false; // Enable UI

		} else {
			// Output device selection capability may exist, but is not enabled.
			this.createDefault(selector, kind);
			this._allowReconfiguration = true;

			// Set up for reconfiguration
			selector.container = selectorDiv;
			if (player) selector.container.player = player;
			selectorDiv.hidden = false;
		}
	}

	createDefault(selector, kind) {
		const option = document.createElement('option');
		option.value = "";
		option.text = this.DEFAULT_NAME[kind];
		selector.appendChild(option);
	}

	// Run a re-configuration process for an output selector in response to an
	// event (typically focusin) by calling getUserMedia to attempt to unlock
	// access to more media devices.
	async reconfigure(e) {

		if (!this._allowReconfiguration) return;

		// AudioUI.consumeEvent(e);
		/*
				await UIkit.modal.alert(
					`<div class="uk-modal-body">
						<b>Please allow access to the microphone</b>
						<p>Your browser will prompt you to allow access to your
						computer's microphone after you click "OK" on this page.  Please
						respond with "allow" to enable output source selection.
						</p>
						<p class="uk-text-meta">ErosWeb "solo" mode does not actually use the microphone.
						However, all the discrete audio devices on your system –
						including output devices like speakers and headsets –
						are bundled together with the microphone for security purposes.
						Granting access to the microphone enables ErosWeb to use those
						additional output devices.
						</p>
						<p class="uk-text-meta"><b>If you do not see a dialog</b>, you may have accidentally
						blocked access to the microphone already.  Go to the security settings in
						your browser (in Google Chrome, this is
						<code>chrome://settings/content/microphone</code>) and reset
						permissions for the site "<code>${document.location.origin}</code>".
						</div>`, { stack: true }
				);
		*/
		try {
			// Calling "getUserMedia" prompts the user to unlock access to more devices.
			const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

			// We don't need to use the streams returned by this gUM call
			AudioUI.stop(stream);

			// Re-initialize this object; hopefully read a list of devices & re-configure
			await this.init();

			// Reconfigure all active selectors
			for (const selector of document.querySelectorAll(`*[kind] select`)) {
				if (selector.disabled) continue;
				const targetKind = selector.container.getAttribute('kind');
				this.configureSelector(selector.container, selector.container.player, targetKind);
				delete selector.container; // Temporary property no longer needed.
			}
		} catch (err) {
			// This means that the user did not allow us access to media devices.
			// Just ignore that error.
			if ('Permission denied' != err.message) throw err;
		}
	}

	// Enable drag-and-drop support for local files;
	// call this from DOMContentLoaded event handler.
	static configureDropTarget(target, player) {

		// Prevent the default behavior for window drops
		window.addEventListener('dragleave', AudioUI.consumeEvent, false);
		window.addEventListener('dragover', AudioUI.consumeEvent, false);
		window.addEventListener('drop', AudioUI.consumeEvent, false);

		// Configure drop target
		target.addEventListener('dragenter', AudioUI.consumeEvent, false);
		target.addEventListener('dragover', e => {
			AudioUI.consumeEvent(e);
			e.dataTransfer.dropEffect = 'copy';
			target.classList.add('uk-dragover');
		}, false);
		target.addEventListener('dragleave', e => {
			AudioUI.consumeEvent(e);
			target.classList.remove('uk-dragover');
		}, false);
		target.addEventListener('drop', e => {
			AudioUI.consumeEvent(e);
			const transfer = e.dataTransfer;
			if (!transfer || !transfer.files || (1 != transfer.files.length)) {
				e.dataTransfer.dropEffect = 'none';
				return;
			}
			this._loadFile(transfer.files, player);
			target.classList.remove('uk-dragover');
			return false;
		}, false);

		// Enable manual file selection via an <input type="file"> element
		const fileUpload = target.querySelector('input[type="file"]');
		if (fileUpload) {
			fileUpload.addEventListener('change', e => {
				AudioUI.consumeEvent(e);
				if (e.target.files) this._loadFile(e.target.files, player);
				e.target.value = '';
			}, false);
		}

		// Configure player controls
		const ckLoop = target.querySelector('input[type="checkbox"].loop');
		if (ckLoop) {
			ckLoop.checked = player.loop;
			ckLoop.addEventListener('change', () => { player.loop = ckLoop.checked; });
		}
	}

	// Internal method; load an audio file into the player
	static _loadFile(file, player) {
		if (file instanceof FileList) file = file[0];
		if ('' != player.canPlayType(file.type)) {
			player.title = file.name;
			player.src = URL.createObjectURL(file);
		} else {
			let msg = file.type;
			msg = ('' == msg) ? "unknown type" : `type "${msg}"`;
			UIkit.notification(
				`<p class="uk-text-small">Cannot play file of ${msg}.  (${file.name})</p>`, { pos: 'bottom-center', status: 'warning' }
			);
		}
	}

	/*
		A U D I O   P L A Y E R   C O M M A N D   R E M O T I N G
	*/

	// Configure a player for remoting
	configureForwarding(player, connectionFn) {

		if ('function' != typeof connectionFn)
			throw new Error(`Cannot configure forwarding.  Expected function to return connection; got ${typeof connectionFn}`);

		// Store a reference to a function which returns connection status.
		// This allows the status to change externally to this class, but
		// still be referenced by forwardAudioEvent when needed.
		this.getConnection = connectionFn;

		['play', 'pause', 'seeked', 'volumechange', 'loadedmetadata'].forEach(e => player.addEventListener(e, this.forwardAudioEvent));
	}

	// Event handler
	async forwardAudioEvent(e) {

		const dataConn = this.getConnection();
		if (!dataConn) return;

		let obj;
		switch (e.type) {
		case 'play':
			obj = { play: true };
			break;
		case 'pause':
			obj = { play: false };
			break;
		case 'seeked':
			if (e.target.loop && (0 == e.target.currentTime))
				obj = { seek: -1 };
			else
				obj = { seek: e.target.currentTime };
			break;
		case 'volumechange':
			obj = { volume: e.target.volume };
			break;
		case 'loadedmetadata':
			// Pause playback and temporarily hide controls until
			// remote sub has received and loaded the file
			e.target.pause();
			e.target.hidden = true;

			// Send currently-loaded content to remote sub
			const r = await fetch(e.target.currentSrc);
			const b = await r.blob();
			obj = {
				file: b,
				name: e.target.title,
				size: b.size,
				type: b.type,
				duration: e.target.duration,
				volume: e.target.volume,
				seek: e.target.currentTime
			};
			break;
		}
		dataConn.send({ estimAudio: obj });
	}

	// Handle a received {estimAudio} object and pass it to the player.
	static handleEstimAudio(message, player) {

		if ("estimAudio" != message[0]) return false;
		const obj = message[1];

		// Dom/controller side processing:
		// eStimAudio file transfer completed; re-enable player controls
		if (true === obj) {
			player.hidden = false;
			player.dispatchEvent(new Event('remoteLoad'));
		} else {
			if ('file' in obj) player.src = URL.createObjectURL(new Blob([obj.file], { type: obj.type }));
			if ('volume' in obj) player.volume = obj.volume;
			if ('seek' in obj) {
				if (-1 == obj.seek) {
					// Loop
					player.currentTime = 0;
					player.play();
				} else player.currentTime = obj.seek;
			}
			if ('play' in obj) {
				if (obj.play) player.play();
				else player.pause();
			}
		}
		return true;
	}

	// Configure backup volume control for Safari, if necessary
	// (default rendering doesn't work well in some layouts)
	configureAltVolume(player, ctlVolume) {
		if (("Apple Computer, Inc." != navigator.vendor) || !ctlVolume) return;
		if (("INPUT" != ctlVolume.tagName) || ("range" != ctlVolume.type))
			throw new Error(`Backup volume control (${ctlVolume.id}) is of incorrect type.  Expected INPUT[type="range"].`);

		ctlVolume.hidden = false;
		ctlVolume.value = player.volume;

		if (navigator.appVersion.match(/\(iPad;/)) {
			// iOS doesn't support control of the volume property;
			// work-around is to call the event forwarder directly
			// to pass along volume-change commands.
			ctlVolume.addEventListener("input", (e) => {
				forwardAudioEvent({
					type: 'volumechange',
					target: { volume: e.target.value }
				});
			});
		} else {
			// On MacOS, volume can be set and volumechange
			// events are fired in the normal way when the
			// player's volume is manipulated by the backup
			// volume control.
			ctlVolume.addEventListener("input", e => player.volume = e.target.value);
		}
	}

	/*
		U S E R - F A C I N G   T E S T   M E T H O D S
	*/

	// Test tones
	testAudioOutput(e) {
		const butTest = e.target;
		const deviceToTest = butTest.previousElementSibling || butTest.parentElement.nextElementSibling;
		if (!deviceToTest || !("getValue" in deviceToTest))
			throw new Error('testAudioOutput Cannot find associated selector');
		else {
			butTest.classList.add('disabled');
			this._testTone(deviceToTest.getValue(), () => { butTest.classList.remove('disabled'); });
		}
	}

	// Microphone level
	testMicLevel(e, stopTestElement, stopTestEvent) {

		let audioStream;

		const butTest = e.target;
		const deviceSelector = butTest.previousElementSibling || butTest.parentElement.nextElementSibling;
		const meter = butTest.nextElementSibling || deviceSelector.nextElementSibling;

		if (!deviceSelector || !("getValue" in deviceSelector)) throw new Error('testMicLevel Cannot find associated selector');

		meter.hidden = false;
		butTest.classList.add('disabled');
		deviceSelector.addEventListener('change', runMicTest);

		stopTestElement.addEventListener(stopTestEvent, () => {
			meter.hidden = true;
			AudioUI.stop(audioStream);
			audioStream = null;
			butTest.classList.remove('disabled');
			deviceSelector.removeEventListener('change', runMicTest);
		}, { once: true });

		runMicTest(this);

		async function runMicTest(c) {
			AudioUI.stop(audioStream);
			const constraints = { audio: AudioUI.parseDeviceSelector(deviceSelector.getValue()) };
			audioStream = await navigator.mediaDevices.getUserMedia(constraints);
			c._testLevel(audioStream, meter);
		}
	}

	// Generate test tone in the selected output device
	async _testTone(deviceId, atEnd) {

		const oscillator = this.AudioCtx.createOscillator();
		const lfo = this.AudioCtx.createOscillator();
		lfo.frequency.value = 2.0; // 2Hz: two oscillations per second

		// create a gain whose gain AudioParam will be controlled by the LFO
		const gain = this.AudioCtx.createGain();

		// connect the LFO to the gain AudioParam. This means the value of the LFO
		// will not produce any audio, but will change the value of the gain instead
		lfo.connect(gain.gain);
		oscillator.connect(gain);

		if (this.sourceSelectionEnabled) {
			// Get the output of the audio graph as a stream
			const dest = this.AudioCtx.createMediaStreamDestination();
			gain.connect(dest);

			// Connect the stream to an Audio() object which we can set
			// the destination of and play.
			const player = new Audio();
			player.srcObject = dest.stream;
			await player.setSinkId(deviceId);
			player.play();
		} else {
			// Output device selection isn't possible (Safari/Firefox)
			gain.connect(this.AudioCtx.destination);
		}

		oscillator.start();
		lfo.start();

		// Turn the player off after 2.5 seconds
		if (atEnd) oscillator.onended = atEnd;
		oscillator.stop(this.AudioCtx.currentTime + 2.5);
	}

	// Measure input level from the indicated stream and update the .value property of the uiElement
	_testLevel(stream, uiElement) {

		const analyser = this.AudioCtx.createAnalyser();
		analyser.smoothingTimeConstant = 0.8;
		analyser.fftSize = 1024;

		const microphone = this.AudioCtx.createMediaStreamSource(stream);

		// TODO: deprecated; port this to use an AudioWorklet...
		const javascriptNode = this.AudioCtx.createScriptProcessor(2048, 1, 1);

		microphone.connect(analyser);
		analyser.connect(javascriptNode);
		javascriptNode.connect(this.AudioCtx.destination); // OK because the node never outputs

		javascriptNode.onaudioprocess = function () {
			const array = new Uint8Array(analyser.frequencyBinCount);
			analyser.getByteFrequencyData(array);
			const values = array.reduce((t, c) => t + c, 0);
			uiElement.value = values / array.length;
		}

		stream.getTracks()[0].onended = (e) => {
			microphone.disconnect(analyser);
			analyser.disconnect(javascriptNode);
			javascriptNode.disconnect(this.AudioCtx.destination);
		};
	}


	/*
		U T I L I T I E S
	*/

	static parseDeviceSelector(deviceId) {
		if ([null, '', 'default'].includes(deviceId))
			return true;
		else
			return { deviceId: { exact: deviceId } };
	}

	static stop(stream) {
		if (stream)
			stream.getTracks()
			.forEach(track => {
				track.stop();
				track.dispatchEvent(new Event("ended"));
			});
	}

	// Make an event go away.  This needs to be a separate, static function
	// so it can be attached to the window object.
	static consumeEvent(e) {
		e.stopPropagation();
		e.preventDefault();
	}
}

export { AudioUI };
