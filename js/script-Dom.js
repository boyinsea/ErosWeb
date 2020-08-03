/*
 * @license
 */
"use strict";

import { ET312Remote } from './ET312Remote.js';
import { audioUI } from './audio2.js';
import { webRTChelper } from './webRTC.js';

const STATE = {
	ctl: null,
	peer: null,
	dataConn: null,
	mediaConnection: null,
	videoShare: null
};

const UI = {
	audioUI: new audioUI()
};

document.addEventListener("DOMContentLoaded", () => {

	// First step: identify UI components.
	document.querySelectorAll('*[id]').forEach(el => UI[el.id] = el);

	// UI text substitutions, for dialogs
	document.querySelectorAll('*[textContent]').forEach(el => el.textContent = eval(el.getAttribute('textContent')));

	/*
		Install document- and window-level event handlers
	*/

	// Do final visual fixups and show UI once all elements are loaded and styled into final form.
	window.addEventListener("load", () => {
		//logResize();
		UI.appUi.hidden = false;
	});

	// Prevent wayward click and submit-type events from inadvertently resetting
	// forms (since there is no server to submit to anyways...)
	UI.controls.addEventListener("submit", (e) => { e.preventDefault(); });

	/*
		Set Defaults from local storage and QueryString parameters
	*/
	UI.inputName.value = localStorage.getItem('sceneName');

	const params = new URLSearchParams(window.location.search);
	UI.inputSId.value = params.get('id');
	UI.inputPIN.value = params.get('pin');

	/*
		Set up ET-312 UI components
	*/
	UI.modeArray.highlightMode = (newMode) => {

		const currentModeButton = UI.modeArray.querySelector('button.uk-button-primary');
		if (currentModeButton && (newMode != currentModeButton.value)) {
			currentModeButton.classList.replace('uk-button-primary', 'uk-button-secondary');
		}

		// highlight new mode, if any
		if (0 == newMode) return; // Styling on "stop" mode is never changed

		const newModeButton = UI.modeArray.querySelector(`button[value="${newMode}"]`);
		if (newModeButton) {
			newModeButton.classList.replace('uk-button-secondary', 'uk-button-primary');
		}
	};

	UI.modeArray.addEventListener("click", (e) => {
		let newMode = e.target.value;
		if (newMode && ('BUTTON' == e.target.tagName)) {
			e.preventDefault();
			newMode = parseInt(newMode);

			// Dispatch new mode to box.  Box will reply
			// with an info message containing updated
			// mode, MA setting and range values.
			if (0 == newMode) {
				STATE.ctl.stop();
			} else {
				STATE.ctl.setMode(newMode);
			}
		}
	});

	UI.powerLevel.highlightLevel = (level) => {
		const currentButton = UI.powerLevel.querySelector('span.uk-label[selected]');
		if (currentButton && (level != currentButton.value)) {
			currentButton.removeAttribute('selected');
		}
		const newButton = UI.powerLevel.querySelector(`span.uk-label[value="${level}"]`);
		if (newButton) newButton.setAttribute('selected', true);
	};

	UI.powerLevel.addEventListener("click", function (e) {

		if (UI.powerLevel.classList.contains("interactive")) {
			let newLevel = e.target.getAttribute("value");
			if (newLevel) {
				e.preventDefault();
				newLevel = parseInt(newLevel);

				// Dispatch new level to box.  Box will reply
				// with an info message which triggers a UI update.
				STATE.ctl.setLevel(newLevel);
			}
		}
	});

	configureSlider(UI.levelMultiAdjust, true); // Invert MA range values
	UI.levelMultiAdjust.addEventListener("change", (e) => {
		STATE.ctl.setValue(
			STATE.ctl.DEVICE.MAVALUE,
			[e.currentTarget.getValue()]);
	});

	configureSlider(UI.levelA);
	UI.levelA.addEventListener("change", (e) => {
		STATE.ctl.setValue(
			STATE.ctl.DEVICE.ADC4,
			[Math.round((e.currentTarget.getValue() / 99) * 255)]);
	});

	configureSlider(UI.levelB);
	UI.levelB.addEventListener("change", (e) => {
		STATE.ctl.setValue(
			STATE.ctl.DEVICE.ADC5,
			[Math.round((e.currentTarget.getValue() / 99) * 255)]);
	});

	UI.selSplitA.addEventListener("change", (e) => {
		STATE.ctl.setValue(STATE.ctl.DEVICE.SPLITA, [parseInt(e.currentTarget.value)]);
	});

	UI.selSplitB.addEventListener("change", (e) => {
		STATE.ctl.setValue(STATE.ctl.DEVICE.SPLITB, [parseInt(e.currentTarget.value)]);
	});

	/*
		Set up Audio and Video components
	*/
	UI.localAudio.volume = 0.1;
	audioUI.configureDropTarget(UI.dropTarget, UI.localAudio);

	// Adjust UI when a new audio file is loaded.
	UI.localAudio.addEventListener('loadedmetadata', async function () {
		UI.dropTarget.classList.toggle("gotFileActive", true);
		UI.dropTarget.querySelector("#fileName").innerText = UI.localAudio.title;
		const overlay = UI.dropTarget.querySelector('.preCover.uk-overlay');
		if (overlay) overlay.classList.remove("uk-overlay", "uk-overlay-default", "uk-position-cover");

		// Send file to remote sub
		/*
		if (STATE.dataConn) {
			const b = await fetch(UI.localAudio.currentSrc).then(r => r.blob());
			STATE.dataConn.send({
				estimAudioFile: {
					file: b,
					name: UI.localAudio.title,
					size: b.size,
					type: b.type,
					duration: UI.localAudio.duration
				}
			});
			console.log('file sent.');
		}
		*/
	});

	// Configure backup volume control for Safari
	// (default rendering doesn't work well in our layout)
	if (("Apple Computer, Inc." == navigator.vendor) && UI.backupVolume) {
		UI.backupVolume.hidden = false;
		UI.backupVolume.value = UI.localAudio.volume;
		UI.backupVolume.addEventListener("input", (e) => {
			console.log(`${UI.backupVolume.value} .. ${UI.localAudio.volume}`);
			UI.localAudio.volume = UI.backupVolume.value;
		});
		UI.localAudio.addEventListener('volumechange', (event) => {
			console.log(`Volume ${UI.localAudio.volume}`);
		});
	}

	// Give a one-time warning if playing an audiostim file but
	// ET-312 isn't connected or set to an audio mode.
	UI.localAudio.addEventListener('play', function () {
		let OK = UI.localAudioPlayWarning;
		if (STATE.ctl) {
			const m = STATE.ctl.getMode();
			if (m && m.startsWith("Audio")) OK = true;
		}
		if (!OK && !UI.ckMonitor.checked) {
			console.dir(STATE.ctl);
			UIkit.notification(
				(STATE.ctl) ?
				'Remember to select an Audio mode!' :
				"<span class='uk-text-small'>Use the \"Monitor\" checkbox to preview audio locally.  Audio will be sent to remote sub's ET-312 box once connected.</span>", { pos: 'bottom-center', status: 'primary' });
			UI.localAudioPlayWarning = true;
		}
	});

	UI.audioUI.init().then(() => {
		UI.audioUI.configureSelector(UI.localAudioDest, UI.localVideo);
		UI.audioUI.configureSelector(UI.cameraInput, null, 'videoinput');
		UI.audioUI.configureSelector(UI.microphoneInput, null, 'audioinput');
		UI.audioUI.configurePlayer(UI.localAudio);
		UI.audioUI.addMonitor(UI.localAudio, UI.ckMonitor, UI.localAudioDest);
	});


	/*
		Connect buttons and finalize UI appearance.
	*/
	UI.localAudioDest.nextElementSibling.addEventListener("click", testAudioOutput);
	UI.microphoneInput.nextElementSibling.addEventListener("click", testMicLevel);
	UI.butConnect.addEventListener("click", clickConnect);
	UI.butShare.addEventListener("click", clickShare);
	toggleUIConnected(false);
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

		// Save last-used scene Name
		localStorage.setItem('sceneName', UI.inputName.value);

		// Prevent multiple button presses. Connection setup can take a minute;
		// createPeerConnection will re-enable the button when ready.
		UI.butConnect.disabled = true;

		// Create connection to the remote peer.
		// When the connection is ready (or not), it will trigger a callback
		// which updates the UI to the "connected" state, or
		// displays an error UI if the connection fails.
		STATE.peer = createPeerConnection(sessionId);

	} else {

		// Tear down any connections in progress
		// if (STATE.estimAudioConnection) {
		// 	STATE.estimAudioConnection.close();
		// 	STATE.estimAudioConnection = null;
		// }

		if (STATE.dataConn) {
			// Save and null the STATE pointer to the data connection;
			// this prevents the UI from warning that the remote sub
			// closed the connection.
			const c = STATE.dataConn;
			STATE.dataConn = null;
			c.close();
		}

		if (STATE.peer) {
			STATE.peer.destroy();
			STATE.peer = null;
		}
		console.log("DOM peer destroyed");

		// Update UI to "not connected" state
		toggleUIConnected(false);
	}
}

// Toggle state based on presence of a connection to a remote session
// (connected, true|false).  Resets and destroys any Peer connection if
// state is set to false.
function toggleUIConnected(connected) {

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
		refreshUI(false); // Visually disable box controls
	}
}

// Functions to update the UI with the latest values from the remote box (info) object
const UI_UPDATE = {
	MODENUM: (v) => UI.modeArray.highlightMode(v),
	MAVALUE: (v) => UI.levelMultiAdjust.setValue(v),
	ADC4: (v) => UI.levelA.setValue(Math.round((v * 99) / 255)),
	ADC5: (v) => UI.levelB.setValue(Math.round((v / 255) * 99)),
	POWERLEVEL: (v) => UI.powerLevel.highlightLevel(v)

	// TODO: Audio levels?

};

// Refresh UI based on information from a remote ET-312 box
function refreshUI(info) {

	UI.iconLink.classList.toggle("connected", Boolean(info));

	if (info) {
		UI.verb.textContent = "Controlling";

		// Visually enable UI for interaction if currently disabled
		if (UI.controlsOnline.classList.contains("disabled")) {
			UI.controlsOnline.querySelectorAll('button, select, input').forEach((i) => i.disabled = false);
			UI.controlsOnline.classList.remove("disabled");
		}

		// UI reconfiguration.  This is typically only done at startup,
		// or if there are significant UI changes such as a new multi-adjust
		// range when the box mode changes.
		if (info.SPLITA) configureSplitSelect(UI.selSplitA, info.SPLITA, info);
		if (info.SPLITB) configureSplitSelect(UI.selSplitB, info.SPLITB, info);
		if (('MALOW' in info) && ('MAHIGH' in info)) UI.levelMultiAdjust.setRange(info.MALOW, info.MAHIGH);

		// Update any UI elements for which values were provided.
		// (sometimes info contains only one or two changed properties)
		for (const property in info) {
			// console.log(`info: ${property} = ${info[property]}`);
			if (property in UI_UPDATE) UI_UPDATE[property](info[property]);
		}

	} else {
		UI.verb.textContent = "Connected to";

		// Visually disable online-only UI for interaction until remote box connected
		if (!UI.controlsOnline.classList.contains("disabled")) {
			UI.controlsOnline.querySelectorAll('button, select, input').forEach((i) => i.disabled = true);
			UI.controlsOnline.classList.add("disabled");
		}
	}
}

function createPeerConnection(destId) {

	// https://elements.heroku.com/buttons/peers/peerjs-server

	const P = new Peer('', {
		host: 'erosweb-peerjs-server.herokuapp.com', //document.location.host,
		port: 443, // 9000,
		//path: '/peerjs',
		secure: true
	});

	P.on('open', () => {
		const dataConn = P.connect(destId, {
			metadata: {
				PIN: UI.inputPIN.value,
				sceneName: UI.inputName.value,
			},
			serialization: 'json'
		});

		// Data received from remote sub
		dataConn.on('data', (data) => {
			console.dir(data);
			for (const prop in data) {
				let obj = data[prop];
				console.log(`${prop} = ${JSON.stringify(obj)}`);
				if ('welcome' == prop) {
					if (true === obj) {
						// Display success message if the sub's ET-312 is linked.
						// If not, that situation results in a more detailed modal dialog displayed below.
						if (data.info) UIkit.notification('Connected!', { pos: 'top-left', status: 'success' });

						STATE.dataConn = dataConn;
						toggleUIConnected(true);
						STATE.dataConn.send({
							videoShare: Boolean(STATE.videoShare)
						});

						// Create MediaConnection for estim audio
						STATE.estimAudioConnection = P.call(
							destId,
							UI.localAudio.stream, {
								metadata: { estimAudio: true },
								sdpTransform: (sdp) => {
									const sdp2 = webRTChelper.sdpAudio(sdp);
									console.log(sdp2);
									return sdp2;
								}
							}
						);

						// if we are currently sharing audio/video, call the sub
						if (STATE.videoShare) gotConnection(P.call(destId, STATE.videoShare, { sdpTransform: webRTChelper.sdpVoice }));

					} else if (false === obj) {
						// welcome: false means the remote sub wants to close the connection.
						if (state.dataConn) state.dataConn.close();
					} else {
						// welcome: [object] means Connection refused; object contains error information.
						// This will be followed by a "close" event.
						if ('PIN Mismatch' == obj.error) UI.inputPIN.classList.toggle('uk-form-danger', true);
						showAlert('connectionRefused', obj.error).then(() => { UI.butConnect.disabled = false; });
					}
				}

				// sub's scene name, for UI
				if ('sceneName' == prop) UI.subName.textContent = obj;

				// Information about the sub's ET-312 box.  false == no box connected
				if ('info' == prop) {
					if (obj) {
						if (!STATE.ctl) STATE.ctl = new ET312Remote(dataConn);
						STATE.ctl.info(obj);
						refreshUI(obj);
					} else {
						STATE.ctl = null;

						// if this is part of the initial "welcome" message, display a warning
						if (true == data.welcome) {
							showAlert('welcomeNoBox');
						} else UIkit.notification(
							"Remote control of the sub's ET-312 box is disabled.", { pos: 'top-left', status: 'warning' }
						);
					}
				}

				// Information about scene limits
				if ('limits' == prop) {
					for (const limit in obj) {
						let v = obj[limit];
						console.log(`LIMIT: ${limit}: ${v}`);
						if ('changePowerLevel' == limit) {
							UI.powerLevel.classList.toggle('interactive', v);
						} else if ('maxLevel' == limit) {
							UI.levelA.setLimit(v);
							UI.levelB.setLimit(v);
						}
					}
				}

				// Sub has changed video sharing state
				if ('videoShare' == prop) {

					// Sub is now sharing too.
					if (obj && STATE.videoShare) {

						// First close any existing connection
						if (STATE.mediaConnection) STATE.mediaConnection.close();

						// Call back so sub can reply with their video stream.
						gotConnection(P.call(dataConn.peer, STATE.videoShare, { sdpTransform: webRTChelper.sdpVoice }));
					}

					// Sub has stopped sharing video; adjust our UI.
					else if (!obj) {
						UI.remoteVideo.pause();
						UI.remoteVideo.nextElementSibling.hidden = false; // Show overlay
						UI.remoteVideo.srcObject = null;
					}
				}
			}
		});

		dataConn.on('close', () => {

			if (STATE.estimAudioConnection) {
				STATE.estimAudioConnection.close();
				STATE.estimAudioConnection = null;
			}

			STATE.ctl = null;
			toggleUIConnected(false);

			// If we are still holding a data connection object,
			// this means that the sub has ended the scene.
			if (STATE.dataConn) {
				STATE.dataConn = null;
				UIkit.modal.alert(`Remote sub has ended the scene.`);
			}
		});

		dataConn.on('error', (err) => {
			// This will be followed by a "close" event if the connection has totally broken down
			console.log(`Data Connection error: ${err} (open? ${dataConn.open})`);
			UIkit.notification("Lost connection to the remote sub.", { pos: 'top-center', status: 'danger' });
		});
	});

	P.on('error', (err) => {
		STATE.peer = null; // Drop reference to the peer object so we can try again.
		if (err.message.startsWith('Could not connect to peer '))
			UI.inputSId.classList.toggle('uk-form-danger', true);
		showAlert('connectionFailed', err).then(() => {
			toggleUIConnected(false);
			UI.butConnect.disabled = false;
		});
	});

	P.on('call', (mediaConnection) => {
		// This happens when the sub attempts to connect with audio/video
		// console.log("Received a call; answering...");
		mediaConnection.answer(STATE.videoShare, { sdpTransform: webRTChelper.sdpVoice });
		gotConnection(mediaConnection);
	});

	return P;
}


/*
	SHARE / UNSHARE AUDIO AND VIDEO
*/

// Store and set up event handlers for a MediaConnection
function gotConnection(conn) {

	STATE.mediaConnection = conn;

	STATE.mediaConnection.on('stream', (stream) => {
		// console.log(`Got stream: ${stream}`)
		UI.remoteVideo.nextElementSibling.hidden = true; // Hide overlay
		UI.remoteVideo.srcObject = stream;
		UI.remoteVideo.autoplay = true;
	});

	// This happens when the media connection is closed, e.g. by the
	// remote dom ending the call.
	STATE.mediaConnection.on('close', () => {
		// console.log('Media connection closing...');
		UI.remoteVideo.nextElementSibling.hidden = false; // Show overlay
		UI.remoteVideo.srcObject = null;
		STATE.mediaConnection = null;
	});
}

// Given a device ID as a string, return a Constraint object
// suitable as input to getUserMedia.
function parseDeviceSelector(deviceId) {
	if ([null, '', 'default'].includes(deviceId))
		return true;
	else
		return { deviceId: { exact: deviceId } };
}

async function clickShare() {

	const constraints = {
		audio: parseDeviceSelector(UI.microphoneInput.getValue()),
		video: parseDeviceSelector(UI.cameraInput.getValue())
	};

	if (!STATE.videoShare) {
		try {
			STATE.videoShare = await navigator.mediaDevices.getUserMedia(constraints);

			UI.localVideo.nextElementSibling.hidden = true;
			UI.localVideo.srcObject = STATE.videoShare;
			UI.localVideo.muted = true;
			UI.localVideo.play();
			UI.butShare.textContent = 'Stop Sharing';

			// If connected to remote, send our audio/video now
			if (STATE.dataConn) {
				// Close any existing connection
				if (STATE.mediaConnection) STATE.mediaConnection.close();
				gotConnection(STATE.peer.call(UI.inputSId.value, STATE.videoShare, { sdpTransform: webRTChelper.sdpVoice }));
			}
		} catch (e) {
			if (
				((e instanceof DOMException) && (DOMException.NOT_FOUND_ERR == e.code)) ||
				(("OverconstrainedError" == e.name) && (e instanceof OverconstrainedError)) ||
				((e instanceof Error) && ("NotFoundError" == e.name))
			) {
				showAlert('mediaMissing', e);
			} else if ((e instanceof DOMException) && ('NotAllowedError' == e.name)) {
				showAlert('GUMCoach', e);
			} else throw e;
		}
	} else {

		UI.localVideo.pause();
		UI.localVideo.srcObject = null;
		STATE.videoShare.getTracks().forEach(track => { track.stop(); });
		STATE.videoShare = null;
		UI.localVideo.nextElementSibling.hidden = false;

		if (STATE.mediaConnection) STATE.mediaConnection.close();
		STATE.mediaConnection = null;

		UI.butShare.textContent = 'Share Audio/Video';
	}
}

/*
	AUDIO / VIDEO SETUP PANE
*/

// Test tones
function testAudioOutput(e) {
	const butTest = e.target;
	butTest.classList.add('disabled');
	const deviceToTest = butTest.previousElementSibling.getValue();
	UI.audioUI.testTone(deviceToTest, () => { butTest.classList.remove('disabled'); });
}

// Microphone level
async function testMicLevel(e) {

	let constraints = { audio: parseDeviceSelector(UI.microphoneInput.getValue()) };
	let audioStream = await navigator.mediaDevices.getUserMedia(constraints);
	const butTest = e.target;
	const meter = butTest.nextElementSibling;
	meter.hidden = false;
	UI.audioUI.testLevel(audioStream, meter);
	butTest.classList.add('disabled');

	UI.microphoneInput.addEventListener('change', async function () {
		audioStream.getTracks().forEach(track => {
			track.stop();
			track.dispatchEvent(new Event("ended"));
		});
		constraints = { audio: parseDeviceSelector(UI.microphoneInput.getValue()) };
		audioStream = await navigator.mediaDevices.getUserMedia(constraints);
		UI.audioUI.testLevel(audioStream, meter);
	});

	UI.pnlConfigAV.addEventListener("beforehide", () => {
		meter.hidden = true;
		audioStream.getTracks().forEach(track => {
			track.stop();
			track.dispatchEvent(new Event("ended"));
		});
		audioStream = null;
		butTest.classList.remove('disabled');
	}, { once: true });

}

/*
	UTILITIES
*/

// Extract alert text from page HTML and display it as a modal dialog.
function showAlert(name, err) {

	const e = document.querySelector(`.alert .${name}`);
	if (!e) throw new Error(`Alert '${name}' not found in page HTML.`);
	let h = e.innerHTML;
	if (err) h += `<pre>${err}</pre>`;
	return UIkit.modal.alert(h);
}

/*
Configure a <select> element for each channel of the "split"
mode, based on the current box configuration.
*/
function configureSplitSelect(selControl, currentMode, info) {
	while (selControl.firstChild) {
		selControl.removeChild(selControl.firstChild);
	}
	for (const boxMode in STATE.ctl.MODES) {
		if ((boxMode <= info.TOPMODE) && STATE.ctl.SPLITMODES.includes(parseInt(boxMode))) {
			const option = document.createElement("option");
			option.value = boxMode;
			option.text = STATE.ctl.MODES[boxMode];
			if (currentMode == boxMode) option.selected = true;
			selControl.appendChild(option);
		}
	}
}

// Configure the <range>, <span>/badge, and <button> elements within
// a DIV to create an interactive slider control.
function configureSlider(sliderDiv, inverse) {

	const range = sliderDiv.querySelector('input[type="range"]');
	sliderDiv.setRange = (low, high) => {
		range.min = low;
		range.max = high;
	};
	sliderDiv.setValue = (newValue) => {
		range.value = (inverse) ? parseInt(range.max) - newValue + parseInt(range.min) : newValue;
		range.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
	};
	sliderDiv.getValue = () => {
		const curValue = parseInt(range.value);
		return (inverse) ? parseInt(range.max) - curValue + parseInt(range.min) : curValue;
	};
	sliderDiv.setLimit = (limit) => {
		range.limit = limit;
		if (range.value > range.limit) range.setValue(limit);
	};

	const badge = sliderDiv.getElementsByClassName("uk-badge")[0];
	range.addEventListener("input", (e) => {
		if (range.value > range.limit) {
			console.log(`Value: ${range.value}; Limit: ${range.limit} [${sliderDiv}]`);
			e.stopPropagation();
			e.preventDefault();
			range.value = range.limit;
			sliderDiv.classList.toggle('atLimit', true);
			setTimeout(() => { sliderDiv.classList.toggle('atLimit', false); }, 2250);
		} else if (badge) badge.innerText = range.value;
	}, { capture: true });

	const upDown = sliderDiv.getElementsByTagName('button');
	if (2 == upDown.length) {
		upDown[0].addEventListener("click", (e) => {
			range.stepDown();
			range.dispatchEvent(new Event('input', { bubbles: true }));
			range.dispatchEvent(new Event('change', { bubbles: true }));
		});
		upDown[1].addEventListener("click", (e) => {
			range.stepUp();
			range.dispatchEvent(new Event('input', { bubbles: true }));
			range.dispatchEvent(new Event('change', { bubbles: true }));
		});
	}
}
