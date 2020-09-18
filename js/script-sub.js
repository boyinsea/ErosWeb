/*
 * @license
 */
"use strict";

import { ET312Serial } from './ET312.js';
import { ET312Controller } from './ET312Controller.js';
import { audioUI } from './audio2.js';
import { webRTChelper } from './webRTC.js';

const STATE = {
	et312: null,
	ctl: null,
	heartbeat: null,
	peer: null,
	dataConn: null,
	mediaConnection: null,
	videoShare: null,
	debug: false
};

const UI = {
	audioUI: new audioUI()
};

document.addEventListener("DOMContentLoaded", () => {

	// Identify UI components.
	document.querySelectorAll('*[id]').forEach(el => { UI[el.id] = el; });

	// UI text substitutions, for dialogs
	document.querySelectorAll('*[textContent]').forEach(el => el.textContent = eval(el.getAttribute('textContent')));

	// Simply display an error message if we can't run.
	if (!("serial" in navigator)) {
		UI.notSupported.hidden = false;
		UI.appUi.hidden = true;
		return;
	}

	/*
		Install document- and window-level event handlers
	*/

	// Do final visual fixups when all elements are loaded and styled into final form.
	window.addEventListener("load", () => {
		if (UI.notSupported.hidden) {
			UI.appUi.hidden = false; // Show the UI once it is all configured.
			resize(UI.log);
		}
	});

	// Navigation warning if currently connected to ET312;
	// should disconnect first to reset key.  This only
	// seems to work with the "= function" syntax.
	window.onbeforeunload = function (e) {
		if (STATE.et312) {
			e.preventDefault();
			return '';
		}
	};

	window.addEventListener("resize", () => { resize(UI.log); });

	document.addEventListener('keydown', (k) => {
		const l = document.activeElement;
		if (("Enter" == k.code) && ((l == UI.inputName) || (l == UI.inputPIN)))
			UI.butPresent.dispatchEvent(new Event('click'));
	});

	// Capture "timeout" and similar errors when talking to ET-312
	window.addEventListener("unhandledrejection", async function (e) {
		console.dir(e);
		// debugger;

		if (("Error: timeout" == e.reason) ||
			(("NetworkError" == e.reason.name) && ("The device has been lost." == e.reason.message)) ||
			("BreakError" == e.reason.name)) {

			e.preventDefault();
			UI.log.textContent += 'Error: Connection to ET-312 reset.\n';
			showAlert('connectionLost', e.reason);

			// Error cleanup; normal cleanup and shutdown isn't possible
			// since the box has gone away.
			await STATE.et312.close(true);
			STATE.et312 = null;
			STATE.ctl = null;

			toggleState(STATE.dataConn, false);
		}
	});

	// No server to submit data to!  This keeps wayward click and
	// submit-type events from inadvertently resetting the form.
	UI.controls.addEventListener("submit", (e) => { e.preventDefault(); });

	/*
		Configure ET-312 Controls
	*/
	UI.powerLevel.highlightLevel = (level) => {

		const currentButton = UI.powerLevel.querySelector('span.uk-label[selected]');
		if (currentButton && (level != currentButton.value)) {
			currentButton.removeAttribute('selected');
		}
		const newButton = UI.powerLevel.querySelector(`span.uk-label[value="${level}"]`);
		if (newButton) newButton.setAttribute('selected', true);
	};

	UI.powerLevel.addEventListener("click", async function (e) {
		let newLevel = e.target.getAttribute("value");
		if (newLevel) {
			e.preventDefault();
			newLevel = parseInt(newLevel);

			// Dispatch set level command to box & update remote peer, if any
			doCommand(STATE.ctl.setPowerLevel, newLevel);
			UI.powerLevel.highlightLevel(newLevel);
		}
	});

	/*
		Configure settings/limits UI
	*/
	configureSlider(UI.limitMaxLevel);

	/*
		Connect buttons and other UI components
	*/
	UI.notSupported.hidden = true;
	UI.butConnect.addEventListener("click", clickConnect);
	UI.butStatus.addEventListener("click", clickStatus);
	// UI.butTest.addEventListener("click", clickTest);
	UI.butPresent.addEventListener("click", clickPresent);
	UI.butShare.addEventListener("click", clickShare);
	UI.butLinkCopy.addEventListener("click", copyLink);
	UI.estimAudioDest.nextElementSibling.addEventListener("click", testAudioOutput);
	UI.localAudioDest.nextElementSibling.addEventListener("click", testAudioOutput);
	UI.microphoneInput.nextElementSibling.addEventListener("click", testMicLevel);
	UI.pnlLimits.querySelector("BUTTON.uk-offcanvas-close").addEventListener("click", () => {
		localStorage.setItem('limitPowerLevel', UI.limitPowerLevel.checked);
		localStorage.setItem('limitMaxLevel', UI.limitMaxLevel.getValue());
		if (STATE.dataConn) STATE.dataConn.send({ limits: getLimits() });
	});

	// Restore page defaults
	const params = new URLSearchParams(window.location.search);
	STATE.debug = params.has('debug');

	UI.inputName.value = localStorage.getItem('sceneName');
	let limitMaxLevel = Number(localStorage.getItem('limitMaxLevel'));
	if (0 == limitMaxLevel) limitMaxLevel = 99;
	UI.limitMaxLevel.setValue(limitMaxLevel);
	UI.limitPowerLevel.checked = ("true" === localStorage.getItem('limitPowerLevel'));


	// Finalize audio component setup; initialize application state
	UI.estimAudio = new Audio(); // Renderer only; not present in UI.
	UI.estimAudio.addEventListener('canplaythrough', () => {
		if (STATE.dataConn) {
			STATE.dataConn.send({ estimAudio: true });
			UI.iconEstimAudio.classList.toggle("connected", true);
		}
	});

	UI.audioUI = new audioUI();
	toggleState(false, false)
		.then(() => UI.audioUI.init())
		.then(() => {
			UI.audioUI.configureSelector(UI.estimAudioDest, UI.estimAudio);
			UI.audioUI.configureSelector(UI.localAudioDest, UI.remoteVideo);
			UI.audioUI.configureSelector(UI.cameraInput, null, 'videoinput');
			UI.audioUI.configureSelector(UI.microphoneInput, null, 'audioinput');
		});
});

/*
	CONNECT / DISCONNECT FROM ET-312
*/

/**
 * @name clickConnect
 * Click handler for the connect/disconnect button.
 */
async function clickConnect() {

	// Simply toggle state of box, leaving data connection alone
	return toggleState(STATE.dataConn, !STATE.et312);
}

// Change state of application.
//	conn = true/object: remote connection exists
//			false: tear down remote connection if any
//	box = true connect to ET-312 box if necessary.
//		false: disconnect and restore local control
// This function also updates the UI as appropriate,
// and encapsulates logic that depends on the status
// of both the box and the remote connection.
async function toggleState(conn, box) {

	console.log(`toggleState: conn = ${conn}, box = ${box}`);

	// Heartbeat depends on both data and box connections
	if (!(box && conn)) {
		if (STATE.heartbeat) {
			clearInterval(STATE.heartbeat);
			STATE.heartbeat = null;
		}
	}

	// Box false => turn off connection to ET-312, if any
	if (!box) {

		if (conn && STATE.dataConn) STATE.dataConn.send({ info: false }); // Notify remote Dom that box is disconnecting

		if (STATE.ctl) {
			const { info, P } = await STATE.ctl.takeControl(false); // Relinquish remote control if we have it
			await P;
			STATE.ctl = null;
		}

		if (STATE.et312) {
			await STATE.et312.close(); // Reset key & close serial connection
			STATE.et312 = null;
			UI.log.textContent += 'ET-312 unlinked.\n';
		}

		UI.butConnect.textContent = "Link ET-312";

	} else {
		// Box true => Set up connection if needed
		if (!STATE.et312) {
			try {
				let port = await navigator.serial.requestPort();
				STATE.et312 = new ET312Serial(port);
				await STATE.et312.connect();
				UI.butConnect.textContent = "Unlink ET-312";
				UI.log.textContent += 'ET-312 linked and ready.\n';
			} catch (err) {
				if ('NotFoundError' == err.name) {
					UI.log.textContent += 'No port was selected.\n';
				} else {
					UI.log.textContent += `Error linking ET-312: ${err.message}\n`;
					await showAlert('noConnect', err);
					STATE.et312 = null;
				}
			}

			// Instantiate controller
			if (STATE.et312 && !STATE.ctl) {
				STATE.ctl = new ET312Controller(STATE.et312);

				// Get initial box status and update UI elements
				// const info = await STATE.ctl.getInfo();
				// UI.powerLevel.highlightLevel(info.POWERLEVEL);
				const powerLevel = await STATE.ctl.getValue(STATE.ctl.DEVICE.POWERLEVEL);
				UI.powerLevel.highlightLevel(powerLevel);
			}
		}
	}
	box = Boolean(STATE.et312);

	if (conn) {

		if (box) {
			const { info, _ } = await STATE.ctl.takeControl(true);
			UI.log.textContent += `${UI.domName.textContent} is controlling the ET-312.\n`;
			UIkit.notification(
				`<b>${UI.domName.textContent}</b> has taken control of the ET-312.`, { pos: 'top-left', status: 'warning' }
			);
			STATE.dataConn.send({ info: info });

			if (!STATE.heartbeat && !STATE.debug) {
				// Query current box status & update Dom every 5 seconds.
				// (Skip the update if less than 1 second has elapsed since status
				// information was last retrieved.)
				STATE.heartbeat = setInterval(() => {
					if (STATE.ctl) {
						STATE.ctl.getInfo(1000).then((info) => {
							if (info && STATE.dataConn) STATE.dataConn.send({ info: info });
						});
					}
				}, 5000);
			}
		}

	} else {

		// Relinquish control of box if we have it (ramp down first)
		if (box && STATE.ctl) {
			const control = await STATE.ctl.hasControl();
			if (control) {
				// Ramp down box.
				await STATE.ctl.setValue(STATE.ctl.DEVICE.ADC4, [0]);
				await STATE.ctl.setValue(STATE.ctl.DEVICE.ADC5, [0]);
				await STATE.ctl.stop();

				// Turn off remote control
				const { info, _ } = await STATE.ctl.takeControl(false);

				UI.log.textContent += `${UI.domName.textContent} has relinquished control of the ET-312.\n`;
				UIkit.notification(
					"ET-312 has ramped down and is under local control.", { pos: 'top-left', status: 'primary' }
				);
			}
		}

		// Stop playing estim audio, if any
		UI.estimAudio.pause();

		// Tear down any existing connections
		if (STATE.mediaConnection) {
			STATE.mediaConnection.close();
			STATE.mediaConnection = null;
		}

		if (STATE.dataConn) {
			// Notify remote peer that connection is ending.
			STATE.dataConn.send({ welcome: false });
			STATE.dataConn.close();
			STATE.dataConn = null;
		}
	}
	conn = Boolean(conn); //STATE.dataConn);

	// UI configuration net of any changes
	UI.controlsOnline.classList.toggle("disabled", !box);
	UI.pnlSession.classList.toggle("connected", conn);
	UI.iconBoxLink.classList.toggle("connected", box);
	UI.iconLink.classList.toggle("connected", box && conn);
}


// Utility function to display the status of the connected box.
async function clickStatus() {

	if (STATE.ctl) {
		UI.log.textContent = '>>> ET-312 Status >>>\n';
		const info = await STATE.ctl.getInfo();
		for (const property in info) {
			//console.log(property);
			const pd = STATE.ctl.DEVICE[property];
			if (pd) UI.log.textContent += `${pd.description}: ${info[property]}\n`;
		}
	} else {
		UI.log.textContent += 'Not connected to ET-312.\n';
	}
}

async function clickTest() {

	//for (let i = 0; i < 100; i++) {
	await STATE.et312.handshake();
	//const n = await STATE.ctl.getValue("MODENUM");
	// }
}

/*
	PRESENT CONTROL TO / WITHHOLD CONTROL FROM REMOTE USER
*/
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

		// Prevent multiple button presses
		UI.butPresent.disabled = true;

		// Create peer connectoid and get ready to receive a connection.
		// When the connectoid is ready, it will trigger a callback
		// which toggles application state to "connected" and updates
		// the button state/remaining UI components.
		STATE.peer = createPeerConnection(UI.inputName.value);

		// Configure audio outputs (in response to user interaction)
		await UI.estimAudio.setSinkId(UI.estimAudioDest.getValue());
		await UI.remoteVideo.setSinkId(UI.localAudioDest.getValue());

	} else {

		// Currently presenting -- end scene if any and go offline
		await toggleState(false, STATE.ctl);
		toggleUIPresent(false);

		// End "keepalive" requests
		if (STATE.keepalive) clearInterval(STATE.keepalive);

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
		UI.sessionId.textContent = idFormat(STATE.peer.id);
		UI.pnlSessionId.classList.replace('uk-invisible', 'uk-animation-scale-up');
	} else {
		UI.sessionId.textContent = '';
		UI.pnlSessionId.classList.replace('uk-animation-scale-up', 'uk-invisible');
		UI.log.textContent += `Remote connection disabled.\n`;

	}
	resize(UI.log);
}

function createPeerConnection(name) {

	// https://elements.heroku.com/buttons/peers/peerjs-server

	// Generate a Session ID based on a hash of the scene name & current time.
	let hash = Date.now(),
		i = 0;
	while (i < name.length) {
		hash = ((hash << 5) - hash) + name.charCodeAt(i++);
		hash |= 0;
	}
	let sessionId = Math.abs(hash).toString(36);

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

	P.on('error', (err) => {
		UI.log.textContent += `${err}\nConnection failed, try to Present again.\n`;
		STATE.peer.destroy();
		STATE.peer = null;
		toggleUIPresent(false);
		toggleState(false, STATE.ctl);
		showAlert('connectionFailed', err);
	});

	// This happens when a remote peer establishes a data connection.
	// Save connectoid and set up handlers for important events.
	P.on('connection', (dataConnection) => {

		// This event occurs once, the very first time the connection is ready to use.
		dataConnection.on('open', async function () {

			// Only one Dom at a time can connect
			if (STATE.dataConn) {
				dataConnection.send({
					welcome: { error: "Another Dom is already connected to this session." }
				});
				dataConnection.close();
				UI.log.textContent += `"${dataConnection.metadata.sceneName}" attempted to connect.\n`;
				return;
			}

			// Validate PIN, if any
			const PIN = UI.inputPIN.value;
			if (PIN && (PIN != dataConnection.metadata.PIN)) {
				dataConnection.send({
					welcome: { error: "PIN Mismatch" }
				});
				dataConnection.close();
				UI.log.textContent += `Connection attempted but PIN was incorrect.\n`;
				return;
			}

			// UI
			const sceneName = dataConnection.metadata.sceneName;
			UI.domName.textContent = sceneName;
			UI.log.textContent += `${sceneName} has connected.\n`;
			UIkit.notification(`<b>${sceneName}</b> has connected.`, { pos: 'top-left', status: 'success' });

			// If ET-312 box is connected, get current status information
			let info = false;
			if (STATE.ctl) info = await STATE.ctl.getInfo(true);

			// Send welcome message
			dataConnection.send({
				welcome: true,
				sceneName: UI.inputName.value,
				info: info,
				limits: getLimits()
			});

			toggleState(true, STATE.ctl); // Toggle app into "connected" mode
			STATE.dataConn = dataConnection; // Save data connection object
			// STATE.peer.disconnect();	// Eliminate dependency on the server staying alive
		});

		// This event occurs every time a data message is received
		dataConnection.on('data', (data) => {
			for (const prop in data) {
				let obj = data[prop];
				console.log(`${prop}: ${JSON.stringify(obj)}`);

				// Box command dispatch
				if ('setMode' == prop) doCommand(STATE.ctl.setMode, obj);
				if ('setLevel' == prop) doCommand(STATE.ctl.setPowerLevel, obj);
				if ('stop' == prop) doCommand(STATE.ctl.stop);
				if ('startRamp' == prop) doCommand(STATE.ctl.startRamp);
				if ('setValue' == prop) doCommand(STATE.ctl.setValue, obj.address, obj.value);

				// Video Sharing
				// Normally, the Dom will initiate a call to the sub when
				// ready to share video.  We only need to initiate when
				// the Dom reports that they are NOT sharing video in response
				// to our "welcome" message (instead of calling).
				// If we are NOT presently sharing video, the message is ignored.
				if (('videoShare' == prop) && !obj && STATE.videoShare) {
					// if (STATE.peer.disconnected) STATE.peer.reconnect();
					STATE.mediaConnection = P.call(
						STATE.dataConn.peer,
						STATE.videoShare, { sdpTransform: webRTChelper.sdpVoice });
				}

				// Estim Audio
				// if (('estimAudio' == prop) && !obj) {
				// 	if (STATE.estimAudioConnection) STATE.estimAudioConnection.close();
				// }
				if ('estimAudio' == prop) handleEstimAudio(obj);

				// Manual connection close initiated by Dom;
				// works around a PeerJS issue when Dom is running Firefox.
				if (('goodbye' == prop) && obj) dataConnection.close();
			}
		});

		dataConnection.on('close', () => {
			if (STATE.dataConn) {
				UI.log.textContent += `${UI.domName.textContent} disconnected.\n`;
				UIkit.notification(`<b>${UI.domName.textContent}</b> disconnected.`, { pos: 'top-left', status: 'primary' });
				STATE.dataConn = null;
			}
			toggleState(false, STATE.ctl);

			// Reconnect to the peer server so that another Dom could potentially connect.
			// if (STATE.peer.disconnected) STATE.peer.reconnect();

		});

		dataConnection.on('error', (err) => {
			console.log(`Data Connection ${err}`);
			console.dir(err);
		});

	});

	// This happens when Dom calls us with audio/video to share
	P.on('call', (mediaConnection) => {

		console.log('Call!  incoming mediaConnection:');
		console.dir(mediaConnection);

		// if (mediaConnection.metadata && mediaConnection.metadata.estimAudio) {
		//
		// 	console.log('Call is estimAudio.');
		//
		// 	if (STATE.estimAudioConnection) STATE.estimAudioConnection.close();
		//
		// 	mediaConnection.answer(null);
		// 	STATE.estimAudioConnection = mediaConnection;
		//
		// 	STATE.estimAudioConnection.on('stream', (stream) => {
		//
		// 		console.log(`estimAudio stream.  Current dest: ${UI.estimAudio.sinkId}; new: ${UI.estimAudioDest.getValue()}`);
		//
		// 		UI.estimAudio.srcObject = stream;
		// 		UI.estimAudio.play()
		// 			//.then(UI.estimAudio.setSinkId(UI.estimAudioDest.getValue()))
		// 			.then(UI.iconEstimAudio.classList.toggle("connected", true));
		// 	});
		//
		// 	STATE.estimAudioConnection.on('close', () => {
		// 		UI.estimAudio.pause();
		// 		UI.estimAudio.srcObject = null;
		// 		STATE.estimAudioConnection = null;
		// 		// UI.estimAudio.setSinkId('')
		// 		// 	.then(() => {
		// 		UI.iconEstimAudio.classList.toggle("connected", false);
		// 		console.log('estimAudio connection closed.');
		// 		//});
		// 	});
		//
		// } else {

		console.log('Call is shared audio/video.');

		if (STATE.mediaConnection) STATE.mediaConnection.close();

		mediaConnection.answer(STATE.videoShare, { sdpTransform: webRTChelper.sdpVoice });
		STATE.mediaConnection = mediaConnection;

		// This happens when remote audio/video arrives from the Dom
		// There's an issue with peerJS where the same stream may be
		// sent twice; https://github.com/peers/peerjs/issues/609
		STATE.mediaConnection.on('stream', (stream) => {

			if (UI.remoteVideo.srcObject && (UI.remoteVideo.srcObject.id == stream.id)) return;

			console.log(`a/v stream.  Current dest: ${UI.remoteVideo.sinkId}; new: ${UI.localAudioDest.getValue()}`);
			console.dir(stream);

			UI.remoteVideo.nextElementSibling.hidden = true; // Hide overlay
			UI.remoteVideo.srcObject = stream;
			// const n = stream.clone();
			// n.removeTrack(n.getAudioTracks()[1]);
			// UI.remoteVideo.srcObject = n;
			//
			// const e = new MediaStream([stream.getAudioTracks()[1]]);
			// UI.estimAudio.srcObject = e;
			// UI.estimAudio.play()
			// //.then(UI.estimAudio.setSinkId(UI.estimAudioDest.getValue()))
			// .then(UI.iconEstimAudio.classList.toggle("connected", true));

			//const i = UI.localAudioDest.getValue();

			// Setting setSinkId can be a little unstable, and has the tendency to change
			// the sinkId of other players as well so we reset those.
			// This assumes sinkId is always set to default (either by a
			// 'close' event or because no stream has been played yet.
			UI.remoteVideo.play();
			//.then(UI.remoteVideo.setSinkId(i))
		});

		// This happens when the media connection is closed, e.g. by the
		// remote dom ending the call.  The connection does NOT close if
		// the Dom has simply stopped sharing audio/video but the sub
		// has not (i.e. still sending audio/video to the Dom).
		STATE.mediaConnection.on('close', () => {
			STATE.mediaConnection = null;
			UI.remoteVideo.pause();
			UI.remoteVideo.srcObject = null;
			// UI.remoteVideo.setSinkId('')
			// .then(() => {
			UI.remoteVideo.nextElementSibling.hidden = false; // Show overlay
			console.log('mediaConnection closed.');
			// });
		});
		// }
	});

	return P;
}

// Process a box command received from the remote Dom;
// reply with an updated {info} object reflecting the result
// of the command and update the local UI as required.
// Some commands return an object; others
// return a scalar value or nothing; in that case, send
// a small heartbeat snapshot instead.
async function doCommand(f, ...params) {
	let info = await f(...params);
	if (!info || ('object' != typeof (info))) info = await STATE.ctl.getInfo(true);
	if (STATE.dataConn) STATE.dataConn.send({ info: info });

	for (const prop in info) {
		let v = info[prop];
		if ('POWERLEVEL' == prop) UI.powerLevel.highlightLevel(v);
	}
}

// Format an ID string into chunks
function idFormat(idText) {
	const s = idText.replace('-', '');
	let buffer = [];
	let i = 0;
	for (const char of s) {
		buffer.push(char);
		if (0 == (++i % 3)) buffer.push('-');
	}
	return buffer.join('').replace(/\-$/, '');
}

// Create a link to the Dom mode page for this session and copy it to the clipboard
function copyLink(e) {
	e.preventDefault();
	let link = document.location.href.replace('/sub.', '/Dom.');
	link += `?id=${STATE.peer.id}`;
	if ('' != UI.inputPIN.value) link += `&pin=${UI.inputPIN.value}`;
	navigator.clipboard.writeText(link);
	UIkit.notification('A link to control this session has been copied to the clipboard.', 'primary');
}

/*
	Handle estimAudio commands
*/
async function handleEstimAudio(obj) {
	console.log('Handling e-stim audio command(s)', obj);

	if ('file' in obj) UI.estimAudio.src = URL.createObjectURL(new Blob([obj.file], { type: obj.type }));
	if ('volume' in obj) UI.estimAudio.volume = obj.volume;
	if ('seek' in obj) UI.estimAudio.currentTime = obj.seek;
	if ('play' in obj) {
		if (obj.play) UI.estimAudio.play();
		//.then(UI.estimAudio.setSinkId(UI.estimAudioDest.getValue()))
		else UI.estimAudio.pause();
	}
}

/*
	SHARE / UNSHARE AUDIO AND VIDEO
*/
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
					// Dom that we have video available; Dom will
					// call back.
					// It is hard to add a stream to a MediaConnection in PeerJS
					STATE.mediaConnection.close();
					STATE.dataConn.send({ videoShare: true });
				} else {
					// No connection yet; initiate call.
					// if (STATE.peer.disconnected) STATE.peer.reconnect();
					STATE.mediaConnection = STATE.peer.call(
						STATE.dataConn.peer,
						STATE.videoShare, { sdpTransform: webRTChelper.sdpVoice }
					);
				}
			}
		} catch (e) {
			if (
				((e instanceof DOMException) && (DOMException.NOT_FOUND_ERR == e.code)) ||
				((e instanceof OverconstrainedError) && ("OverconstrainedError" == e.name))
			) {
				showAlert('mediaMissing', e);
			} else if ((e instanceof DOMException) && ('NotAllowedError' == e.name)) {
				showAlert('GUMCoach', e);
			} else throw e;
		}
	} else {

		// Sharing -> not sharing
		UI.localVideo.pause();
		STATE.videoShare.getTracks().forEach(track => { track.stop(); });
		UI.localVideo.srcObject = null;
		STATE.videoShare = null;
		UI.localVideo.nextElementSibling.hidden = false;
		UI.butShare.textContent = 'Share Audio / Video';

		// Close connection unless Dom is sharing
		if (STATE.mediaConnection && !STATE.mediaConnection.remoteStream) {
			STATE.mediaConnection.close();
			STATE.mediaConnection = null;
		}
	}
}

// Save scene limits in local storage.
// Transmit to remote Dom if connected.
function getLimits() {
	return {
		changePowerLevel: UI.limitPowerLevel.checked,
		maxLevel: UI.limitMaxLevel.getValue()
	};
}

/*
	AUDIO / VIDEO SETUP
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
function resize(el) {
	const myStyles = window.getComputedStyle(el);
	const parentStyles = window.getComputedStyle(el.parentElement);

	const topOffset = el.getBoundingClientRect().top + parseInt(myStyles.paddingTop.replace("px", ""));
	const bottomPadding = parseInt(myStyles.paddingBottom.replace("px", "")) +
		parseInt(parentStyles.paddingBottom.replace("px", ""));

	let height = window.innerHeight - topOffset - bottomPadding;

	const next = el.nextElementSibling;
	if (next) {
		const nextStyles = window.getComputedStyle(next);
		const nextHeight = parseInt(nextStyles.height.replace("px", "")) +
			parseInt(nextStyles.marginBottom.replace("px", "")) +
			parseInt(nextStyles.marginTop.replace("px", ""));
		height -= nextHeight;
	}

	el.style.height = `${height}px`;
}

// Extract alert text from page HTML and display it as a modal dialog.
function showAlert(name, err) {

	const e = document.querySelector(`.alert .${name}`);
	if (!e) throw new Error(`Alert '${name}' not found in page HTML.`);
	let h = e.innerHTML;
	if (err) h += `<pre>${err}</pre>`;
	return UIkit.modal.alert(h);
}

// Configure the <range>, <span>/badge, and <button> elements within
// a DIV to create an interactive slider control.
// UPDATED VERSION - +/- buttons optional
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

	const badge = sliderDiv.getElementsByClassName("uk-badge")[0];
	if (badge) {
		range.addEventListener("input", (e) => {
			badge.innerText = range.value;
		});
	}

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
