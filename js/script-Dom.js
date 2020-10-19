/*
 * @license
 */
"use strict";

import { ET312Remote } from './ET312Remote.js';
import { EWUtility } from './utility.js';
import { AudioUI } from './audio2.js';

const STATE = {
	et312: new ET312Remote(),
	peer: null,
	dataConn: null,
	mediaConnection: null,
	videoShare: null
};

const UI = {
	audioUI: new AudioUI(async () => {
		if (UI.audioUI.sourceSelectionEnabled) {
			// Configure audio output (in response to first user interaction)
			await UI.localAudio.setSinkId(UI.estimAudioDest.getValue());
			await UI.remoteVideo.setSinkId(UI.localAudioDest.getValue());
		}
	})
};

document.addEventListener("DOMContentLoaded", () => {

	// First step: identify UI components.
	document.querySelectorAll('*[id]')
		.forEach(el => UI[el.id] = el);

	// UI text substitutions, for dialogs
	document.querySelectorAll('*[textContent]')
		.forEach(el => el.textContent = eval(el.getAttribute('textContent')));

	/*
		Install document- and window-level event handlers
	*/

	// Show UI once all elements are loaded and styled into final form.
	window.addEventListener("load", () => {
		UI.appUi.hidden = false;
		UI.modeArray.parentElement.dispatchEvent(new Event('scroll'));
	});

	// Prevent wayward click and submit-type events from inadvertently resetting
	// forms (since there is no server to submit to anyways...)
	UI.controls.addEventListener("submit", (e) => { e.preventDefault(); });

	// Pressing "Enter" while Session ID or PIN is focused automatically Connects.
	document.addEventListener('keydown', (k) => {
		const l = document.activeElement;
		if (("Enter" == k.code) && ((l == UI.inputSId) || (l == UI.inputPIN)))
			UI.butConnect.dispatchEvent(new Event('click'));
	});


	/*
		Set Defaults from local storage and QueryString parameters
	*/
	UI.inputName.value = localStorage.getItem('sceneName');

	const params = new URLSearchParams(window.location.search);
	UI.inputSId.value = params.get('id');
	UI.inputPIN.value = params.get('pin');

	/*
		E T - 3 1 2   E V E N T S   (from remote box)
	*/
	STATE.et312.addEventListener('connection', (e) => {
		UIkit.notification('Connected to remote ET-312!', { pos: 'bottom-right', status: 'success' });
	});

	STATE.et312.addEventListener('close', (e) => {});

	STATE.et312.addEventListener('remoteControl', (e) => {
		if (e.detail) {
			UI.verb.textContent = "Controlling";
		} else {
			// Only show UI when remote control is lost while conenction remains.
			// Do not clutter UI if the whole connection has ended.
			if (STATE.dataConn) {
				UI.verb.textContent = "Connected to";
				UIkit.notification(
					"Remote control of the sub's ET-312 box is disabled.", { pos: 'bottom-right', status: 'warning' });
			}
		}

		// Visually enable/disable UI for interaction
		UI.controlsOnline.querySelectorAll('button, select, input')
			.forEach(i => i.disabled = !e.detail);
		UI.controlsOnline.classList.toggle("disabled", !e.detail);
		UI.iconLink.classList.toggle("connected", e.detail);
	});

	STATE.et312.addEventListener('status', refreshUI);

	/*
		E T - 3 1 2   U I   C O N T R O L S
	*/

	// *** MODE SELECTION ***
	UI.modeArray.highlightMode = (newMode) => {
		const currentModeButton = UI.modeArray.querySelector('button.uk-button-primary');
		if (currentModeButton && (newMode != currentModeButton.value))
			currentModeButton.classList.replace('uk-button-primary', 'uk-button-secondary');

		// highlight new mode, if any
		if (0 == newMode) return; // Styling on "stop" mode is never changed

		const newModeButton = UI.modeArray.querySelector(`button[value="${newMode}"]`);
		if (newModeButton) newModeButton.classList.replace('uk-button-secondary', 'uk-button-primary');
	};

	UI.modeArray.setTopMode = (topMode) => {
		UI.modeArray.querySelectorAll('button[value]')
			.forEach(el => {
				el.disabled = (Number(el.value) > topMode);
				el.hidden = el.disabled || el.hidden;
			});
		UI.modeArray.parentElement.dispatchEvent(new Event('scroll'));
	}

	UI.modeArray.addEventListener("click", (e) => {
		let newMode = e.target.value;
		if (newMode && ('BUTTON' == e.target.tagName)) {
			e.preventDefault();
			newMode = parseInt(newMode);

			// Dispatch new mode to box.  Box will reply
			// with an info message containing updated
			// mode, MA setting and range values.
			if (0 == newMode) STATE.et312.execute('stop');
			else {
				// Retrieve last-used MA setting for this mode, if any
				const lastMAValues = JSON.parse(localStorage.getItem('lastMA')) || {};
				const ma = lastMAValues[STATE.et312.MODES[newMode]];
				if (ma) newMode = { mode: newMode, MA: ma };
				STATE.et312.execute('setMode', newMode);
			}
		}
	});

	// Show or hide up/down "reminder" icons depending on scroll state.
	UI.modeArray.parentElement.addEventListener("scroll", (e) => {
		const t = e.target;
		t.previousElementSibling.classList.toggle('hidden', (0 == t.scrollTop));
		t.nextElementSibling.classList.toggle('hidden', (t.scrollTop + t.offsetHeight == t.scrollHeight));
		t.nextElementSibling.classList.toggle('hidden', (t.scrollHeight - t.scrollTop === t.clientHeight));
	});

	UI.selSplitA.addEventListener("change", e =>
		STATE.et312.setValue(STATE.et312.DEVICE.SPLITA, parseInt(e.currentTarget.value))
	);

	UI.selSplitB.addEventListener("change", e =>
		STATE.et312.setValue(STATE.et312.DEVICE.SPLITB, parseInt(e.currentTarget.value))
	);

	// *** MULTI-ADJUST AND OUTPUT LEVELS ***
	EWUtility.configureSlider(UI.levelMultiAdjust, { inverse: true });
	UI.levelMultiAdjust.addEventListener("change", (e) => {
		const ma = e.currentTarget.getValue();
		STATE.et312.setValue(STATE.et312.DEVICE.MAVALUE, ma);

		// Save last-used MA setting for this mode, if any
		const lastMAValues = JSON.parse(localStorage.getItem('lastMA')) || {},
			mode = STATE.et312.mode;

		if (mode) {
			lastMAValues[mode] = ma;
			localStorage.setItem('lastMA', JSON.stringify(lastMAValues));
		}
	});

	EWUtility.configureSlider(UI.levelA, { singleStep: true });
	UI.levelA.addEventListener("change", (e) => {
		STATE.et312.setValue(STATE.et312.DEVICE.ADC4,
			Math.round((e.currentTarget.getValue() / 99) * 255));
	});

	EWUtility.configureSlider(UI.levelB, { singleStep: true });
	UI.levelB.addEventListener("change", (e) => {
		STATE.et312.setValue(STATE.et312.DEVICE.ADC5,
			[Math.round((e.currentTarget.getValue() / 99) * 255)]);
	});

	UI.btnRamp.addEventListener("click", (e) => {
		e.preventDefault();
		STATE.et312.execute('startRamp');
	});

	/// *** "ADVANCED" PANE CONTROLS ***
	UI.powerLevel.highlightLevel = (level) => {
		const currentButton = UI.powerLevel.querySelector('span.uk-label[selected]');
		if (currentButton && (level != currentButton.value)) currentButton.removeAttribute('selected');
		const newButton = UI.powerLevel.querySelector(`span.uk-label[value="${level}"]`);
		if (newButton) newButton.setAttribute('selected', true);
	};

	UI.powerLevel.addEventListener("click", function (e) {
		e.preventDefault();
		if (UI.powerLevel.classList.contains("interactive")) {
			let newLevel = e.target.getAttribute("value");
			// Dispatch new level to box.  Box will reply
			// with an info message which triggers a UI update.
			if (newLevel) STATE.et312.execute('setPowerLevel', parseInt(newLevel));
		}
	});

	UI.inputRampLevel.addEventListener("change", (e) => {
		UI.btnRamp.innerText = `START (${UI.inputRampLevel.value}%)`;
		if (e.isTrusted)
			STATE.et312.setValue(
				STATE.et312.DEVICE.A_RAMPLEVEL,
				155 + parseInt(e.currentTarget.value));
	});

	UI.inputRampTime.addEventListener("change", (e) => {
		STATE.et312.setValue(STATE.et312.DEVICE.A_RAMPTIME, parseInt(e.currentTarget.value));
	});

	//	VISIBLE / AVAILABLE MODES
	//	localStorage holds a list of mode types that the user
	//	has explicitly HIDDEN (so that new modes default to
	//  being shown).
	UI.pnlConfig.addEventListener('beforehide', (e) => {
		let modes = [];
		for (const control of UI.modeSelect.querySelectorAll("input[name]"))
			if (!control.checked) modes.push(control.name);
		localStorage.setItem('modeSelect', modes.join(','));
		localStorage.setItem('modeScroll', UI.modeScroll.checked);
	});

	UI.modeSelect.addEventListener("change", (e) => {
		const buttons = UI.modeArray.getElementsByClassName(e.target.name);
		for (const el of buttons) el.hidden = (!e.target.checked || el.disabled);
		UI.modeArray.parentElement.dispatchEvent(new Event('scroll'));
	});

	UI.modeScroll.addEventListener("change", (e) => {
		const scrollArea = UI.modeArray.parentElement;
		scrollArea.classList.toggle('uk-overflow-auto', e.target.checked);
		scrollArea.classList.toggle('uk-margin-small-bottom', !e.target.checked);
		scrollArea.previousElementSibling.hidden = !e.target.checked;
		scrollArea.nextElementSibling.hidden = !e.target.checked;
		scrollArea.dispatchEvent(new Event('scroll'));
	});

	const modeScroll = localStorage.getItem('modeScroll');
	UI.modeScroll.checked = ("true" == modeScroll);
	UI.modeScroll.dispatchEvent(new Event('change', { bubbles: true }));

	const modes = localStorage.getItem('modeSelect');
	if (modes) {
		for (const modeName of modes.split(',')) {
			const control = UI.modeSelect.querySelector(`input[name="${modeName}"]`);
			if (control) {
				control.checked = false;
				// Firing the "change" event causes the checkbox
				// to hide the affected mode buttons.
				control.dispatchEvent(new Event('change', { bubbles: true }));
			}
		}
	}

	/*
		Set up Audio and Video components
	*/
	UI.localAudio.volume = 0.1;
	UI.remoteVideo.autoplay = true;
	UI.remoteVideo.muted = true; // Enables video to start streaming

	UI.butUnmute.addEventListener('click', (e) => {
		e.preventDefault();
		UI.remoteVideo.muted = false;
		UI.butUnmute.hidden = true;
	});


	/*
		eStim Audio
	*/
	AudioUI.configureDropTarget(UI.dropTarget, UI.localAudio);

	// Configure backup volume control for Safari, if necessary
	UI.audioUI.configureAltVolume(UI.localAudio, UI.backupVolume);

	// Forward interesting events to remote sub
	UI.audioUI.configureForwarding(UI.localAudio, () => { return STATE.dataConn; });

	// Adjust UI when a new audio file is loaded.
	UI.localAudio.addEventListener('loadedmetadata', (e) => {
		UI.dropTarget.classList.toggle("gotFileActive", true);
		UI.dropTarget.querySelector("#fileName")
			.innerText = e.target.title;
		const overlay = UI.dropTarget.querySelector('.preCover.uk-overlay');
		if (overlay) overlay.classList.remove("uk-overlay", "uk-overlay-default", "uk-position-cover");
	});

	// "Autoplay" handling with remote-control awareness
	UI.localAudio.addEventListener('canplaythrough', (e) => {
		if (UI.ckAutoplay.checked && !STATE.dataConn) e.target.play();
	});
	UI.localAudio.addEventListener('remoteLoad', (e) => {
		if (UI.ckAutoplay.checked) e.target.play();
	});

	// Give a one-time warning if playing an audiostim file but
	// ET-312 isn't connected or set to an audio mode.
	UI.localAudio.addEventListener('play', () => {
		let OK = UI.localAudioPlayWarning;
		const m = STATE.et312.mode;
		if (m && m.startsWith("Audio")) OK = true;
		if (!OK) {
			UIkit.notification(
				(STATE.et312.connected) ?
				'Remember to select an Audio mode!' :
				"<span class='uk-text-small'>Audio will be sent to remote sub's ET-312 box once connected.</span>", { pos: 'bottom-right', status: 'primary' });
			UI.localAudioPlayWarning = true;
		}
	});

	UI.audioUI.init()
		.then(() => {
			UI.audioUI.configureSelector(UI.estimAudioDest, UI.localAudio);
			UI.audioUI.configureSelector(UI.localAudioDest, UI.localVideo);
			UI.audioUI.configureSelector(UI.cameraInput, null, 'videoinput');
			UI.audioUI.configureSelector(UI.microphoneInput, null, 'audioinput');
		});
	UI.pnlConfig.addEventListener("beforeshow", UI.audioUI.reconfigure, { once: true });

	/*
		Connect buttons and finalize UI appearance.
	*/
	UI.estimAudioDest.previousElementSibling.querySelector("span.click")
		.addEventListener("click", UI.audioUI.testAudioOutput);
	UI.localAudioDest.previousElementSibling.querySelector("span.click")
		.addEventListener("click", UI.audioUI.testAudioOutput);
	UI.microphoneInput.previousElementSibling.querySelector("span.click")
		.addEventListener("click", e => { UI.audioUI.testMicLevel(e, UI.pnlConfig, 'beforehide'); });
	UI.butConnect.addEventListener("click", clickConnect);
	UI.butShare.addEventListener("click", clickShare);
	toggleConnectionState(false);
});


/*
	CONNECT / DISCONNECT FROM REMOTE SESSION
*/
async function clickConnect() {

	if (!STATE.peer) {

		const sessionId = UI.inputSId.value.trim();

		if ("" == sessionId) {
			UI.inputSId.classList.add('uk-form-danger');
			UIkit.notification("Enter the sub's Session ID to connect.", 'danger');
			return;
		}

		// Make sure we have a scene name so the remote user knows who is connecting
		if ("" == UI.inputName.value) {
			UI.inputName.classList.add('uk-form-danger');
			UIkit.notification('Enter a name to identify Yourself to the remote sub.', 'danger');
			return;
		}

		// Prevent multiple button presses. Connection setup can take a minute;
		// createPeerConnection will re-enable the button when ready.
		UI.butConnect.disabled = true;

		// Save last-used scene Name
		localStorage.setItem('sceneName', UI.inputName.value);

		// Create connection to the remote peer.
		// When the connection is ready (or not), it will trigger a callback
		// which updates the UI to the "connected" state, or
		// displays an error UI if the connection fails.
		STATE.peer = createPeerConnection(sessionId);

	} else {

		// Tear down any connections in progress
		if (STATE.dataConn) {
			if ("" == navigator.vendor) {
				// Firefox doesn't forward a "close" event to the remote sub
				// (PeerJS issue) so we ask the remote sub to close the
				// connection for us.
				STATE.dataConn.send({ goodbye: true });
				STATE.dataConn = null;
				return;
			} else {
				// Save and null the STATE pointer to the data connection;
				// this prevents the UI from warning that the remote sub
				// closed the connection during the close event handler.
				const c = STATE.dataConn;
				STATE.dataConn = null;
				c.close();
			}
		}
	}
}

// Toggle state based on presence of a connection to a remote session
// (connected, true|false).  This does not affect the ET-312 UI.
function toggleConnectionState(connected) {

	UI.butConnect.textContent = (connected) ? "Disconnect" : "Connect";
	UI.butConnect.disabled = false;

	UI.pnlSession.classList.toggle("connected", connected);
	UI.inputName.classList.remove('uk-form-danger');

	UI.inputName.disabled = connected;
	UI.inputSId.disabled = connected;
	UI.inputPIN.disabled = connected;

	if (connected) {
		UI.inputSId.classList.toggle('uk-form-danger', false);
		UI.inputPIN.classList.toggle('uk-form-danger', false);
	} else {
		// If we are still holding a data connection object,
		// this means that the sub has ended the scene.
		if (STATE.dataConn) {
			STATE.dataConn = null;
			UIkit.modal.alert(`Remote sub has ended the scene.`);
		}

		if (STATE.peer) {
			STATE.peer.destroy();
			STATE.peer = null;
		}
	}
}

// Refresh UI based on information from ET-312
function refreshUI(e) {

	// Functions to update the UI with the latest values from the remote box (info) object
	const UI_UPDATE = {
		MODENUM: (v) => UI.modeArray.highlightMode(v),
		MAVALUE: (v) => UI.levelMultiAdjust.setValue(v),
		ADC4: (v) => UI.levelA.setValue(Math.round((v * 99) / 255)),
		ADC5: (v) => UI.levelB.setValue(Math.round((v / 255) * 99)),
		POWERLEVEL: (v) => UI.powerLevel.highlightLevel(v),
		A_RAMPLEVEL: (v) => {
			const r = v - 155;
			if (parseInt(UI.inputRampLevel.value) != r) {
				UI.inputRampLevel.value = r;
				UI.inputRampLevel.dispatchEvent(new Event('change'));
			}
		},
		A_RAMPTIME: (v) => { UI.inputRampTime.value = v; },
		RAMPVALUE: (v) => { UI.rampLevel.innerText = `${v - 155}%`; },
		RAMPSELECT: (v) => {
			UI.btnRamp.hidden = (v == 39);
			UI.rampLevel.hidden = (v == 1);
		},
		TOPMODE: (v) => UI.modeArray.setTopMode(v)
		// TODO: Audio levels?

	};

	const info = e.detail;
	if (info) {
		// Control reconfiguration.  This is typically only done at startup,
		// or if there are significant UI changes such as a new multi-adjust
		// range when the box mode changes.
		if (info.SPLITA) STATE.et312.configureSplitSelect(UI.selSplitA, info.SPLITA, info.TOPMODE);
		if (info.SPLITB) STATE.et312.configureSplitSelect(UI.selSplitB, info.SPLITB, info.TOPMODE);
		if (('MALOW' in info) && ('MAHIGH' in info)) UI.levelMultiAdjust.setRange(info.MALOW, info.MAHIGH);

		// Update any UI elements for which values were provided.
		// (sometimes info contains only one or two changed properties)
		for (const property in info)
			if (property in UI_UPDATE) UI_UPDATE[property](info[property]);
	}
}

// Connect to the peer indicated by |destId| and return the
// Peer object.  Define handler functions for callbacks, such
// as the connection opening and data being received from the
// remote peer.
//
//	|destId| is case-insensitive; "-" characters are ignored.
//
function createPeerConnection(destId) {

	// https://elements.heroku.com/buttons/peers/peerjs-server
	const P = new Peer('', {
		host: 'erosweb-peerjs-server.herokuapp.com',
		port: 443,
		secure: true
	});

	P.on('open', () => {
		const dataConn = P.connect(destId.replace('-', '')
			.toUpperCase(), {
				reliable: true,
				metadata: {
					PIN: UI.inputPIN.value,
					sceneName: UI.inputName.value,
				}
			});

		dataConn.on('open', () => {
			dataConn.peerConnection.addEventListener('connectionstatechange', (e) => {
				if (("failed" == e.target.connectionState)) { // || ("disconnected" == e.target.connectionState)) {
					STATE.dataConn = null;
					dataConnectionError(e);
					dataConn.close();
				}
			});
		});

		// Data received from remote sub
		dataConn.on('data', (data) => {

			for (const prop in data) {
				let obj = data[prop];

				if (STATE.et312.consumeMessage([prop, obj])) continue;
				if (AudioUI.handleEstimAudio([prop, obj], UI.localAudio)) continue;

				switch (prop) {
				case 'welcome':
					if (true === obj) {
						// welcome: true means the sub is willing to accept connection;
						// proceed with setup steps.
						STATE.dataConn = dataConn;
						STATE.et312.connect(dataConn);
						toggleConnectionState(true);

						// Show a warning message if the sub explicitly reports that
						// no box is presently connected.
						if (false === data.ET312) EWUtility.showAlert('welcomeNoBox');

						// Report video sharing status, either by calling the sub
						// if video is available, or reporting "false".
						if (STATE.videoShare)
							setupMediaConnection(P.call(dataConn.peer, STATE.videoShare));
						else
							STATE.dataConn.send({ videoShare: false });

						// If any eStimAudio is active, send it to the sub now
						if (UI.localAudio.readyState > 0)
							UI.localAudio.dispatchEvent(new Event('loadedmetadata'));

					} else if (false === obj) {
						// welcome: false means the remote sub wants to close the connection.
						if (STATE.dataConn) STATE.dataConn.close();
					} else {
						// welcome: [object] means Connection refused; object contains error information.
						if ('PIN Mismatch' == obj.error) UI.inputPIN.classList.toggle('uk-form-danger', true);
						EWUtility.showAlert('connectionRefused', obj.error);
						dataConn.close();
					}
					break;

					// sub's scene name, for UI
				case 'sceneName':
					UI.subName.textContent = obj;
					break;

					// Information about scene limits
				case 'limits':
					for (const limit in obj) {
						let v = obj[limit];
						switch (limit) {
						case 'changePowerLevel':
							UI.powerLevel.classList.toggle('interactive', v);
							break;
						case 'maxLevel':
							UI.levelA.setLimit(v);
							UI.levelB.setLimit(v);
							break;
						}
					}
					break;

					// Sub has changed video sharing state; this property should
					// only be sent when a media connection is already in place but
					// the sub wants to add (or stop) video since adding a stream
					// requires renegotiation of the MediaConnection.  It should
					// NOT appear as part of a Welcome message, since the Dom
					// usually initiates a connection by calling the sub.
				case 'videoShare':
					if (!('welcome' in data)) {
						// true: Sub is sharing.  If we are sharing too,
						// close any existing connection and call back so
						// they can answer with their stream.
						if (obj && STATE.videoShare) {
							if (STATE.mediaConnection) {
								// UI.remoteVideo.pause();
								// UI.remoteVideo.srcObject = null;
								STATE.mediaConnection.close();
							}
							setupMediaConnection(P.call(dataConn.peer, STATE.videoShare));
						} else {
							if (!obj) {
								// false: Sub has stopped sharing video; adjust our UI.
								if (STATE.videoShare) {
									UI.remoteVideo.pause();
									UI.remoteVideo.srcObject = null;
									UI.remoteVideo.nextElementSibling.hidden = false; // Show overlay
								} else STATE.mediaConnection.close();
							}
						}
					}
					break;
				default:
					console.warn(`Unhandled message: ${prop}`);
				}
			}
		});

		dataConn.on('close', () => {
			toggleConnectionState(false);
			STATE.et312.close();
		});

		// This will be followed by a "close" event if the connection has totally broken down
		dataConn.on('error', dataConnectionError);
	});

	P.on('error', (err) => {
		if ("peer-unavailable" == err.type) UI.inputSId.classList.toggle('uk-form-danger', true);
		toggleConnectionState(false);
		UI.butConnect.disabled = false;
		EWUtility.showAlert('connectionFailed', err);
	});

	P.on('call', (mediaConnection) => {
		// This happens when the sub attempts to connect with audio/video
		mediaConnection.answer(STATE.videoShare);
		setupMediaConnection(mediaConnection);
	});

	return P;
}

// Utility routine to display a connection error message;
// this can be triggered in multiple places...
function dataConnectionError(err) {
	console.warn(err, "### Data Connection Error");
	UIkit.notification("Lost connection to the remote sub.", { pos: 'bottom-right', status: 'danger' });
}

/*
	SHARE / UNSHARE AUDIO AND VIDEO
*/

// Store and set up event handlers for a MediaConnection
function setupMediaConnection(conn) {

	STATE.mediaConnection = conn;

	STATE.mediaConnection.on('stream', (stream) => {
		// Sometimes the event fires twice for the same stream (in error); ignore
		if (UI.remoteVideo.srcObject && (UI.remoteVideo.srcObject.id == stream.id)) return;

		UI.remoteVideo.nextElementSibling.hidden = true; // Hide overlay
		UI.remoteVideo.srcObject = stream;
		UI.butUnmute.hidden = !UI.remoteVideo.muted;
	});

	// This happens when the media connection is closed, e.g. by
	// manual disconnect or the remote sub ending the call.
	STATE.mediaConnection.on('close', () => {
		UI.remoteVideo.pause();
		UI.butUnmute.hidden = true; // In case user hasn't dispatched it
		UI.remoteVideo.nextElementSibling.hidden = false; // Show overlay
		UI.remoteVideo.srcObject = null;
		STATE.mediaConnection = null;
	});
}

async function clickShare() {

	const constraints = {
		audio: AudioUI.parseDeviceSelector(UI.microphoneInput.getValue()),
		video: AudioUI.parseDeviceSelector(UI.cameraInput.getValue())
	};

	if (!STATE.videoShare) {
		// Sharing not active; begin
		try {
			STATE.videoShare = await navigator.mediaDevices.getUserMedia(constraints);

			UI.localVideo.nextElementSibling.hidden = true;
			UI.localVideo.srcObject = STATE.videoShare;
			UI.localVideo.muted = true;
			UI.localVideo.play();
			UI.butShare.textContent = 'Stop Sharing';

			// If connected to remote, send our audio/video now
			if (STATE.dataConn) {
				if (STATE.mediaConnection) STATE.mediaConnection.close(); // Close any existing
				setupMediaConnection(STATE.peer.call(STATE.dataConn.peer, STATE.videoShare));
			}
		} catch (e) {
			if (
				((e instanceof DOMException) && (DOMException.NOT_FOUND_ERR == e.code)) ||
				(("OverconstrainedError" == e.name) && (e instanceof OverconstrainedError)) ||
				((e instanceof Error) && ("NotFoundError" == e.name))
			) {
				EWUtility.showAlert('mediaMissing', e);
			} else if ((e instanceof DOMException) && ('NotAllowedError' == e.name)) {
				EWUtility.showAlert('GUMCoach', e);
			} else throw e;
		}
	} else {
		// Sharing active; stop
		UI.localVideo.pause();
		UI.localVideo.srcObject = null;
		AudioUI.stop(STATE.videoShare);
		STATE.videoShare = null;
		UI.localVideo.nextElementSibling.hidden = false;
		UI.butShare.textContent = 'Share Audio/Video';
	}
}
