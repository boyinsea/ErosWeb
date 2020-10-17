/*
 * @license
 */
"use strict";

import { ET312Serial } from './ET312Serial.js';
import { ET312Server } from './ET312Server.js';
import { EWUtility } from './utility.js';
import { AudioUI } from './audio2.js';

const STATE = {
	et312: new ET312Serial(),
	peer: null,
	dataConn: null,
	mediaConnection: null,
	videoShare: null,
	debug: false
};

const UI = {};

document.addEventListener("DOMContentLoaded", () => {

	// Identify UI components.
	document.querySelectorAll('*[id]')
		.forEach(el => { UI[el.id] = el; });

	// UI text substitutions, for dialogs
	document.querySelectorAll('*[textContent]')
		.forEach(el => el.textContent = eval(el.getAttribute('textContent')));

	// Display an error message and no other UI if we can't run.
	if (!("serial" in navigator)) {
		UI.notSupported.hidden = false;
		UI.appUi.hidden = true;
		return;
	}

	//	Finish configuring UI object if we are going to run...
	UI.estimAudio = new Audio(); // Renderer only; not present in UI.
	UI.audioUI = new AudioUI(async () => {
		// Configure audio outputs (in response to first user interaction)
		await UI.estimAudio.setSinkId(UI.estimAudioDest.getValue());
		await UI.remoteVideo.setSinkId(UI.localAudioDest.getValue());
	});


	/*
		Read URL query parameters & restore page defaults
	*/

	const params = new URLSearchParams(window.location.search);
	STATE.debug = params.has('debug');
	UI.inputName.value = localStorage.getItem('sceneName');


	/*
		Install document- and window-level event handlers
	*/

	// Final visual cleanups once all elements are loaded and styled into final form.
	window.addEventListener("load", () => {
		if (UI.notSupported.hidden) {
			UI.appUi.hidden = false; // Show the UI
			EWUtility.resize(UI.log);
		}
	});

	window.addEventListener("resize", () => { EWUtility.resize(UI.log); });

	// Navigation warning if currently connected to ET312;
	// should disconnect first to reset key.  (This only
	// seems to work with the "= function" syntax.)
	window.onbeforeunload = function (e) {
		if (STATE.et312.connected) {
			e.preventDefault();
			return '';
		}
	};

	// "Enter" in Scene Name or PIN is like clicking "Present"
	document.addEventListener('keydown', (k) => {
		const l = document.activeElement;
		if (("Enter" == k.code) && ((l == UI.inputName) || (l == UI.inputPIN)))
			UI.butPresent.dispatchEvent(new Event('click'));
	});

	// Capture "timeout" and similar errors when talking to ET-312
	window.addEventListener("unhandledrejection", async function (e) {
		console.error(e, "### Unhandled rejection!");
	});

	/*
		Configure ET-312 Events and Controls
	*/

	// EVENTS

	STATE.et312.addEventListener('connection', (e) => {
		UI.controlsOnline.classList.toggle("disabled", false);
		UI.iconBoxLink.classList.toggle("connected", true);
		UI.butConnect.textContent = "Unlink ET-312";
		UI.log.textContent += 'ET-312 linked and ready.\n';

		// If a remote Dom is connected, give remote control.
		// Otherwise, request just enough information to update our UI.
		if (STATE.dataConn && STATE.dataConn.open) toggleRemoteControl(true);
		else e.target.requestStatus([e.target.DEVICE.POWERLEVEL]);
	});

	STATE.et312.addEventListener('status', refreshBoxUI);

	STATE.et312.addEventListener('remoteControl', (e) => {
		UI.iconLink.classList.toggle("connected", e.detail);
		if (e.detail) {
			UI.verb.textContent = " is controlling the ET-312.";
			UI.log.textContent += `${UI.domName.textContent} is controlling the ET-312.\n`;
			UIkit.notification(
				`<b>${UI.domName.textContent}</b> has taken control of the ET-312.`, { pos: 'bottom-right', status: 'warning' }
			);
		} else {
			UI.verb.textContent = " is connected.";

			// If the connection to the box is still alive, this was a normal disconnect.
			if (STATE.et312.connected) {
				UI.log.textContent += `${UI.domName.textContent} has relinquished control of the ET-312.\n`;
				UIkit.notification(
					"ET-312 has ramped down and is under local control.", { pos: 'bottom-right', status: 'primary' }
				);
			} else {
				// Otherwise, remote control was lost because of an error.
				UI.log.textContent += `Remote control of the ET-312 disabled.\n`;
			}
		}
	});

	STATE.et312.addEventListener('close', (e) => {
		UI.controlsOnline.classList.toggle("disabled", true);
		UI.iconBoxLink.classList.toggle("connected", false);
		UI.butConnect.textContent = "Link ET-312";
		UI.log.textContent += 'ET-312 unlinked.\n';
	});

	STATE.et312.addEventListener('error', (e) => {
		switch (e.message) {
		case "Connection Failure":
			UI.log.textContent += `Error linking ET-312: ${e.error.message}\n`;
			EWUtility.showAlert('noConnect', e.error.message);
			break;
		case "Connection Lost":
			UI.log.textContent += 'Error: Connection to ET-312 reset.\n';
			EWUtility.showAlert('connectionLost', e.reason);
			break;
		}
	});

	// CONTROLS

	// No server to submit data to!  This keeps wayward click and
	// submit-type events from inadvertently resetting the form.
	UI.controls.addEventListener("submit", (e) => { e.preventDefault(); });

	UI.powerLevel.highlightLevel = (level) => {
		const currentButton = UI.powerLevel.querySelector('span.uk-label[selected]');
		if (currentButton && (level != currentButton.value)) {
			currentButton.removeAttribute('selected');
		}
		const newButton = UI.powerLevel.querySelector(`span.uk-label[value="${level}"]`);
		if (newButton) newButton.setAttribute('selected', true);
	};

	UI.butStop.addEventListener("click", async (e) => {
		await STATE.et312.execute('stop'); // Ramp down box.
		toggleRemoteControl(false);
	});

	UI.powerLevel.addEventListener("click", async function (e) {
		let newLevel = e.target.getAttribute("value");
		if (newLevel) {
			e.preventDefault();
			newLevel = parseInt(newLevel);

			// Dispatch set level command to box
			STATE.et312.execute('setPowerLevel', newLevel);
		}
	});

	/*
		Configure settings/limits UI
	*/
	EWUtility.configureSlider(UI.limitMaxLevel);
	let limitMax = Number(localStorage.getItem('limitMaxLevel'));
	if (0 == limitMaxLevel) limitMax = 99;
	UI.limitMaxLevel.setValue(limitMax);
	UI.limitPowerLevel.checked = ("true" === localStorage.getItem('limitPowerLevel'));

	/*
		Connect buttons and other UI components
	*/
	UI.notSupported.hidden = true;
	UI.butConnect.addEventListener("click", clickConnect);
	UI.butStatus.addEventListener("click", clickStatus);
	UI.butPresent.addEventListener("click", clickPresent);
	UI.butShare.addEventListener("click", clickShare);
	UI.butLinkCopy.addEventListener("click", copyLink);
	UI.estimAudioDest.nextElementSibling.addEventListener("click", UI.audioUI.testAudioOutput);
	UI.localAudioDest.nextElementSibling.addEventListener("click", UI.audioUI.testAudioOutput);
	UI.microphoneInput.nextElementSibling.addEventListener("click", e => { UI.audioUI.testMicLevel(e, UI.pnlConfigAV, 'beforehide'); });
	UI.pnlLimits.addEventListener("beforehide", () => {
		localStorage.setItem('limitPowerLevel', UI.limitPowerLevel.checked);
		localStorage.setItem('limitMaxLevel', UI.limitMaxLevel.getValue());
		if (STATE.dataConn) STATE.dataConn.send({ limits: getLimits() });
	});

	// Finalize audio/video component setup
	UI.estimAudio.addEventListener('canplaythrough', () => {
		if (STATE.dataConn) {
			STATE.dataConn.send({ estimAudio: true });
			UI.iconEstimAudio.classList.toggle("connected", true);
		}
	});

	UI.audioUI.init()
		.then(() => {
			UI.audioUI.configureSelector(UI.estimAudioDest, UI.estimAudio);
			UI.audioUI.configureSelector(UI.localAudioDest, UI.remoteVideo);
			UI.audioUI.configureSelector(UI.cameraInput, null, 'videoinput');
			UI.audioUI.configureSelector(UI.microphoneInput, null, 'audioinput');
		});
	UI.pnlConfigAV.addEventListener("beforeshow", UI.audioUI.reconfigure, { once: true });

});


/*
	E T - 3 1 2   C O N T R O L
*/

// Connect / Disconnect from box
async function clickConnect() {

	UI.butConnect.disabled = true;

	try {
		if (STATE.et312.connected) {
			await toggleRemoteControl(false);
			await STATE.et312.close(); // Reset key & close serial connection
		} else {
			let port = await navigator.serial.requestPort();
			await STATE.et312.connect(port);
		}
	} catch (err) {
		if ('NotFoundError' == err.name) UI.log.textContent += 'No port was selected.\n';
	} finally {
		UI.butConnect.disabled = false;
	}
}

// Acquire (or relinquish) remote control of the ET-312 front panel.
async function toggleRemoteControl(remoteControl) {

	if (!STATE.et312.connected) return;

	if (remoteControl) {
		if (!STATE.dataConn || !STATE.dataConn.open) throw new Error('No open data connection.');
		await STATE.et312.takeControl(true);
	} else {
		const control = await STATE.et312.hasControl();
		if (control) await STATE.et312.takeControl(false); // Turn off remote control
	}
}

// Refresh local UI elements with updated information from the box
function refreshBoxUI(e) {
	const info = e.detail;
	for (const prop in info) {
		const value = info[prop];
		switch (prop) {
		case 'POWERLEVEL':
			UI.powerLevel.highlightLevel(value);
			break;
		}
	}
}

// Utility function to display the status of the connected box.
async function clickStatus() {

	if (STATE.et312.connected) {
		UI.log.textContent = '>>> ET-312 Status >>>\n';
		const info = await STATE.et312.requestStatus(true);
		for (const property in info) {
			const pd = STATE.et312.DEVICE[property];
			if (pd) UI.log.textContent += `${pd.description}: ${info[property]}\n`;
		}
	} else {
		UI.log.textContent += 'Not connected to ET-312.\n';
	}
}


/*
	R E M O T E   C O N N E C T I O N S
*/

// PRESENT CONTROL TO / WITHHOLD CONTROL FROM REMOTE USERS
async function clickPresent() {

	if (!STATE.peer) {

		// Make sure we have a scene name so the remote user knows who they're connecting to
		if ("" == UI.inputName.value) {
			UI.inputName.classList.add('uk-form-danger');
			UIkit.notification('Enter a Name to identify yourself to the remote Dom.', 'danger');
			return;
		}

		// Save last-used scene Name
		localStorage.setItem('sceneName', UI.inputName.value);

		// Create peer connectoid and get ready to receive a connection.
		// When the connectoid is ready, it will trigger a callback
		// which toggles application state to "connected" and updates
		// the button state/remaining UI components.
		UI.butPresent.disabled = true;
		STATE.peer = createPeerConnection(UI.inputName.value);

	} else {

		// Notify any remote peer that connection is ending
		if (STATE.dataConn) STATE.dataConn.send({ welcome: false });

		// Destroy peer, which closes all connections on the way down.
		STATE.peer.destroy();
		STATE.peer = null;
	}
}

function toggleUIPresent(present) {

	UI.butPresent.textContent = (present) ? "End Scene" : "Present";
	UI.butPresent.disabled = false;

	UI.inputName.disabled = present;
	UI.inputPIN.disabled = present;

	if (present) {
		UI.inputName.classList.remove('uk-form-danger');
		UI.sessionId.textContent = EWUtility.idFormat(STATE.peer.id);
		UI.pnlSessionId.classList.replace('uk-invisible', 'uk-animation-scale-up');
	} else {
		UI.sessionId.textContent = '';
		UI.pnlSessionId.classList.replace('uk-animation-scale-up', 'uk-invisible');
		UI.log.textContent += `Remote connection disabled.\n`;
	}
	EWUtility.resize(UI.log);
}

function createPeerConnection(name) {

	// https://elements.heroku.com/buttons/peers/peerjs-server

	// Generate a Session ID based on a hash of the scene name & current time.
	const sessionId = EWUtility.getSessionId(name);

	UI.log.textContent += `Preparing to go online...\n`;
	const P = new Peer(sessionId, {
		host: 'erosweb-peerjs-server.herokuapp.com',
		port: 443,
		secure: true
	});

	P.on('open', () => {
		UI.log.textContent += `Ready to accept a remote connection.\n`;
		toggleUIPresent(true);

		// Ping the peerjs server once every 20 minutes while presenting;
		// this keeps the server from idling and interrupting the connection.
		STATE.keepalive = setInterval(() => {
			fetch(`https://${P.options.host}/`);
		}, 1000 * 60 * 20);
	});

	P.on('close', () => {
		if (STATE.keepalive) clearInterval(STATE.keepalive);
		toggleUIPresent(false);
	});

	P.on('error', (err) => {
		UI.log.textContent += `${err}\nConnection failed, try to Present again.\n`;
		STATE.peer.destroy();
		STATE.peer = null;
		toggleUIPresent(false);
		EWUtility.showAlert('connectionFailed', err);
	});

	// This happens when a remote peer establishes a data connection.
	// Save connectoid and set up handlers for important events.
	P.on('connection', (dataConnection) => {

		console.log(`Data Connection: ${dataConnection.connectionId}`);

		// If a data connection is already open to another Dom, reply with an error
		// as soon as the connection opens.  This will case the remote DOM to close
		// the connection.
		if (STATE.dataConn) {

			dataConnection.on('open', () => {
				dataConnection.send({ welcome: { error: "Another Dom is already connected to this session." } });
				UI.log.textContent += `${dataConnection.metadata.sceneName} also attempted to connect.\n`;
			});

		} else {
			// Set up handlers for connection events.

			// open occurs once, the very first time the connection is ready to use.
			dataConnection.on('open', () => {

				const sceneName = dataConnection.metadata.sceneName;

				// Validate PIN, if any
				const PIN = UI.inputPIN.value;
				if (PIN && (PIN != dataConnection.metadata.PIN)) {
					dataConnection.send({ welcome: { error: "PIN Mismatch" } });
					dataConnection.close();
					UI.log.textContent += `${dataConnection.metadata.sceneName} attempted to connect but PIN was incorrect.\n`;
					return;
				}

				// Handle errors not trapped by peerJS
				dataConnection.peerConnection.addEventListener('connectionstatechange', (e) => {
					if (("failed" == e.target.connectionState) || ("disconnected" == e.target.connectionState)) {
						dataConnectionError();
						dataConnection.close();
					}
				});

				// UI
				UI.domName.textContent = sceneName;
				UI.log.textContent += `${sceneName} has connected.\n`;
				UIkit.notification(`<b>${sceneName}</b> has connected.`, { pos: 'bottom-right', status: 'success' });
				UI.pnlSession.classList.toggle("connected", true);

				STATE.dataConn = dataConnection; // Save data connection object

				// Hook up box server (regardless of whether the controller is
				// presently connected to a box; that state can change).
				STATE.server = new ET312Server(STATE.et312, dataConnection);

				// Send welcome message
				dataConnection.send({
					welcome: true,
					sceneName: UI.inputName.value,
					limits: getLimits(),
					ET312: STATE.et312.connected
				});

				// Acquire remote control if possible
				toggleRemoteControl(true);
			});

			// This event occurs every time a data message is received
			dataConnection.on('data', async (data) => {

				for (const prop in data) {
					let obj = data[prop];

					if (await STATE.server.consumeMessage([prop, obj], STATE.et312)) continue;
					if (AudioUI.handleEstimAudio([prop, obj], UI.estimAudio)) continue;

					switch (prop) {
					case 'videoShare':
						// Video Sharing – We only need to initiate a call when
						// the Dom reports that they are NOT sharing video in response
						// to our "welcome" message (instead of initiating a call).
						// Ignore the message unless we have video to share.
						if (!obj && STATE.videoShare) STATE.mediaConnection = P.call(STATE.dataConn.peer, STATE.videoShare);
						break;

					case 'goodbye':
						// Manual connection close initiated by Dom;
						// works around a PeerJS issue when Dom is running Firefox.
						if (obj) dataConnection.close();
						break;

					default:
						console.warn(`Unrecognized command: ${prop}`);
					}
				}
			});

			// This event happens when the remote Dom disconnects, either on purpose
			// or because of a connection error.
			dataConnection.on('close', async () => {

				// Update UI
				UI.log.textContent += `${UI.domName.textContent} disconnected.\n`;
				UIkit.notification(`<b>${UI.domName.textContent}</b> disconnected.`, { pos: 'bottom-right', status: 'primary' });
				UI.pnlSession.classList.toggle("connected", false);

				// Tear down connection components – do this immediately so that nothing
				// tries to use the connection.
				if (STATE.server) STATE.server.disconnect(STATE.et312); // Wind down server, if any
				STATE.server = null;
				STATE.dataConn = null;

				// End anything that may be going on in the scene
				UI.estimAudio.pause(); // Stop playing estim audio, if any
				if (STATE.et312.connected) {
					await STATE.et312.execute('stop'); // Ramp down box.
					await toggleRemoteControl(false); // Turn off remote control, if any
				}

				// Tear down any existing audio/video sharing connection
				if (STATE.mediaConnection) STATE.mediaConnection.close();
				STATE.mediaConnection = null;

			});
		}

		dataConnection.on('error', dataConnectionError);
	});

	// Dom has called us with audio/video to share;
	// Reply with our own video stream if available.
	P.on('call', (mediaConnection) => {

		// Close any existing connection; it will be replaced.
		if (STATE.mediaConnection) STATE.mediaConnection.close();

		mediaConnection.answer(STATE.videoShare);
		STATE.mediaConnection = mediaConnection;

		// This happens when remote audio/video arrives from the Dom
		STATE.mediaConnection.on('stream', (stream) => {

			// There's an issue with peerJS where the same stream may be
			// sent twice; https://github.com/peers/peerjs/issues/609
			if (UI.remoteVideo.srcObject && (UI.remoteVideo.srcObject.id == stream.id)) return;

			UI.remoteVideo.nextElementSibling.hidden = true; // Hide overlay
			UI.remoteVideo.srcObject = stream;
			UI.remoteVideo.play();
		});

		// This happens when the media connection is closed, e.g. by the
		// remote dom ending the call.  The connection does NOT close if
		// the Dom has simply stopped sharing audio/video but the sub
		// has not (i.e. still sending audio/video to the Dom).
		STATE.mediaConnection.on('close', () => {
			STATE.mediaConnection = null;
			UI.remoteVideo.pause();
			UI.remoteVideo.srcObject = null;
			UI.remoteVideo.nextElementSibling.hidden = false; // Show overlay
		});
	});

	return P;
}

// Create a link to the Dom mode page for this session and copy it to the clipboard
function copyLink(e) {
	e.preventDefault();
	let link = document.location.href.replace('/sub.', '/Dom.');
	link += `?id=${STATE.peer.id}`;
	if ('' != UI.inputPIN.value) link += `&pin=${UI.inputPIN.value}`;
	navigator.clipboard.writeText(link);
	UIkit.notification('A link to control this session has been copied to the clipboard.', { pos: 'bottom-right', status: 'primary' });
}

// Utility routine to display a connection error message;
// this can be triggered in multiple places...
function dataConnectionError() {
	UIkit.notification("Lost connection to the remote Dom.", { pos: 'bottom-right', status: 'danger' });
}


/*
	SHARE / UNSHARE AUDIO AND VIDEO
*/
async function clickShare() {

	const constraints = {
		audio: AudioUI.parseDeviceSelector(UI.microphoneInput.getValue()),
		video: AudioUI.parseDeviceSelector(UI.cameraInput.getValue())
	};

	if (!STATE.videoShare) {
		// Not sharing --> Sharing
		try {
			STATE.videoShare = await navigator.mediaDevices.getUserMedia(constraints);
			UI.localVideo.nextElementSibling.hidden = true;
			UI.localVideo.srcObject = STATE.videoShare;
			UI.localVideo.muted = true;
			UI.localVideo.play();
			UI.butShare.textContent = 'Stop Sharing';

			// Send video if remote peer exists.
			if (STATE.dataConn) {
				if (STATE.mediaConnection) {
					// Connection alrady in place; close it and tell
					// Dom that we have video available; Dom will call back.
					// It is hard to add a stream to a MediaConnection in PeerJS
					STATE.mediaConnection.close();
					STATE.dataConn.send({ videoShare: true });
				} else {
					// No connection yet; initiate call.
					STATE.mediaConnection = STATE.peer.call(
						STATE.dataConn.peer,
						STATE.videoShare
					);
				}
			}
		} catch (e) {
			if (
				((e instanceof DOMException) && (DOMException.NOT_FOUND_ERR == e.code)) ||
				((e instanceof OverconstrainedError) && ("OverconstrainedError" == e.name))
			) {
				EWUtility.showAlert('mediaMissing', e);
			} else if ((e instanceof DOMException) && ('NotAllowedError' == e.name)) {
				EWUtility.showAlert('GUMCoach', e);
			} else throw e;
		}
	} else {

		// Sharing -> not sharing
		UI.localVideo.pause();
		AudioUI.stop(STATE.videoShare);
		// STATE.videoShare.getTracks().forEach(track => { track.stop(); });
		STATE.videoShare = null;
		UI.localVideo.srcObject = null;
		UI.localVideo.nextElementSibling.hidden = false;
		UI.butShare.textContent = 'Share Audio / Video';

		// Close connection unless Dom is sharing
		if (STATE.mediaConnection && !STATE.mediaConnection.remoteStream) {
			STATE.mediaConnection.close();
			STATE.mediaConnection = null;
		}
	}
}

function getLimits() {
	return {
		changePowerLevel: UI.limitPowerLevel.checked,
		maxLevel: UI.limitMaxLevel.getValue()
	};
}
