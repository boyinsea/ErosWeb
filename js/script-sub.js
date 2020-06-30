/*
 * @license
 */
"use strict";

import { ET312Serial } from './ET312.js';
import { ET312Controller } from './ET312Controller.js';
import { audioUI } from './js/audio2.js';

const STATE = {
	et312: null,
	ctl: null,
	heartbeat: null,
	peer: null,
	dataConn: null,
	mediaConnection: null,
	videoShare: null
};

const UI = {
	audioUI: new audioUI()
};

document.addEventListener("DOMContentLoaded", () => {

	// Identify UI components.
	document.querySelectorAll('*[id]').forEach(el => { UI[el.id] = el; });

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
			resize(UI.log);
			UI.appUi.hidden = false; // Show the UI once it is all configured.
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

	window.addEventListener("resize", () => {resize(UI.log);});

	// Capture "timeout" and similar errors when talking to ET-312
	window.addEventListener("unhandledrejection", async function (e) {
		console.warn(e.reason);

		if (("Error: timeout" == e.reason) ||
			(("NetworkError" == e.reason.name) && ("The device has been lost." == e.reason.message))) {

			e.preventDefault();
			log.textContent += 'Error: Connection to ET-312 reset.\n';
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

	// Restore page defaults
	try {
		UI.inputName.value = document.cookie
			.split('; ')
			.find(row => row.startsWith('sceneName'))
			.split('=')[1];
	} catch {}

	/*
		Connect buttons and other UI components
	*/
	UI.notSupported.hidden = true;
	UI.butConnect.addEventListener("click", clickConnect);
	UI.butStatus.addEventListener("click", clickStatus);
	UI.butPresent.addEventListener("click", clickPresent);
	UI.butShare.addEventListener("click", clickShare);
	UI.butLinkCopy.addEventListener("click", copyLink);
	UI.estimAudioDest.nextElementSibling.addEventListener("click", testAudioOutput);
	UI.localAudioDest.nextElementSibling.addEventListener("click", testAudioOutput);
	UI.microphoneInput.nextElementSibling.addEventListener("click", testMicLevel);

	// Finalize audio component setup
	UI.estimAudio = new Audio(); // Renderer only; not present in UI.
	UI.audioUI = new audioUI();

	// Initialize application state and audio components
	toggleState(false, false)
		.then(() => UI.audioUI.init())
		.then(() => {
			UI.audioUI.configureSelector(UI.estimAudioDest, UI.estimAudio);
			UI.audioUI.configureSelector(UI.localAudioDest, UI.localVideo);
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
			UI.log.textContent += 'ET-312 disconnected.\n';
		}

		UI.butConnect.textContent = "Connect to ET-312";

	} else {
		// Box true => Set up connection if needed
		if (!STATE.et312) {
			try {
				let port = await navigator.serial.requestPort();
				STATE.et312 = new ET312Serial(port);
				await STATE.et312.connect();
				UI.butConnect.textContent = "Disconnect";
				log.textContent += 'ET-312 connected and ready.\n';
			} catch (err) {
				if ('NotFoundError' == err.name) {
					log.textContent += 'No port was selected.\n';
				} else {
					log.textContent += `Error connecting to ET-312: ${err.message}\n`;
					await showAlert('noConnect', err);
					STATE.et312 = null;
				}
			}
			if (STATE.et312 && !STATE.ctl) STATE.ctl = new ET312Controller(STATE.et312);
		}
	}

	if (conn) {

		if (box) {
			const { info, _ } = await STATE.ctl.takeControl(true);
			UI.log.textContent += `${UI.domName.textContent} is controlling the ET-312.\n`;
			UIkit.notification(
				`<b>${UI.domName.textContent}</b> has taken control of the ET-312.`, { pos: 'top-left', status: 'warning' }
			);

			STATE.dataConn.send({ info: info });
			if (!STATE.heartbeat) {
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

		if (box) {
			// Relinquish control of box if we have it (ramp down first)
			const control = await STATE.ctl.hasControl();
			if (control) {
				UI.log.textContent += `${UI.domName.textContent} has relinquished control of the ET-312.\n`;

				// Ramp down box.
				await STATE.ctl.setValue(STATE.ctl.DEVICE.ADC4, [0]);
				await STATE.ctl.setValue(STATE.ctl.DEVICE.ADC5, [0]);
				await STATE.ctl.stop();

				const { info, _ } = await STATE.ctl.takeControl(false);
				UIkit.notification(
					"ET-312 has ramped down and is under local control.", { pos: 'top-left', status: 'primary' }
				);
			}
		}

		// Tear down any existing connections
		if (STATE.dataConn) {
			STATE.dataConn.close();
			STATE.dataConn = null;
		}
		if (STATE.mediaConnection) {
			STATE.mediaConnection.close();
			STATE.mediaConnection = null;
		}
	}

	// UI
	UI.pnlSession.classList.toggle("connected", Boolean(conn));
	UI.iconLink.classList.toggle("connected", Boolean(box) & Boolean(conn));
}


// Utility function to display the status of the connected box.
function clickStatus() {
	if (STATE.ctl) {
		UI.log.textContent = '>>> ET-312 Status >>>\n';
		STATE.ctl.getInfo()
			.then((info) => {
				for (const property in STATE.ctl.DEVICE) {
					UI.log.textContent += `${STATE.ctl.DEVICE[property].description}: ${info[property]}\n`;
				}
			});
	} else {
		UI.log.textContent += 'Not connected to ET-312.\n';
	}
}


/*
	PRESENT CONTROL TO / WITHHOLD CONTROL FROM REMOTE USER
*/
async function clickPresent() {

	if (!STATE.peer) {

		// Make sure we have a scene name so the remote user knows who they're connecting to
		if ("" == UI.inputName.value) {
			UI.inputName.classList.add('uk-form-danger');
			UIkit.notification('Enter a Name to identify yourself to the remote user.', 'danger');
			return;
		}

		// Save last-used scene Name
		document.cookie = `sceneName=${UI.inputName.value};path=/`;

		// Prevent multiple button presses
		UI.butPresent.disabled = true;

		// Create peer connectoid and get ready to receive a connection.
		// When the connectoid is ready, it will trigger a callback
		// which toggles application state to "connected" and updates
		// the button state/remaining UI components.
		STATE.peer = createPeerConnection(UI.inputName.value);

	} else {

		// Currently presenting -- end scene if any and go offline
		await toggleState(false, STATE.ctl);
		toggleUIPresent(false);
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
		UI.sessionId.textContent = STATE.peer.id;
		UI.pnlSessionId.classList.replace('uk-invisible', 'uk-animation-scale-up');
	} else {
		UI.sessionId.textContent = '';
		UI.pnlSessionId.classList.replace('uk-animation-scale-up', 'uk-invisible');
	}
	resize(UI.log);
}

function createPeerConnection(name) {

	// https://elements.heroku.com/buttons/peers/peerjs-server

	// Generate a Session ID based on a hash of the scene name & current time.
	let hash = 0;
	for (const char of name) {
		hash = ((hash << 5) - hash) + char.charCodeAt(0);
		hash |= 0;
	}
	const sessionId = idFormat(Date.now().toString(36) + hash.toString(36));

	const P = new Peer(sessionId, {
		host: document.location.host,
		port: 9000,
		path: '/peerjs',
		secure: true
	});

	P.on('open', () => {
		toggleUIPresent(true);
	});

	P.on('error', (err) => {
		UI.log.textContent += `${err}\nConnection failed, try to Present again.\n`;
		UI.butPresent.disabled = false;
		toggleUIPresent(false);
		toggleState(false, STATE.ctl);
	});

	// This happens when a remote peer establishes a data connection.
	// Save connectoid and set up handlers for important events.
	P.on('connection', (dataConnection) => {

		// This event occurs once, the very first time the connection is ready to use.
		dataConnection.on('open', () => {

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

			toggleState(true, STATE.ctl); // Toggle app into "connected" mode
			STATE.dataConn = dataConnection;

			// Send welcome message
			dataConnection.send({
				welcome: true,
				sceneName: UI.inputName.value,
				videoShare: Boolean(STATE.videoShare)
			});
		});

		// This event occurs every time a data message is received
		dataConnection.on('data', (data) => {
			for (const prop in data) {
				let obj = data[prop];
				console.log(`${prop}: ${JSON.stringify(obj)}`);

				// UI
				if ('sceneName' == prop) {
					UI.domName.textContent = obj;
					UI.log.textContent += `${obj} has connected.\n`;
					UIkit.notification(`<b>${obj}</b> has connected.`, { pos: 'top-left', status: 'success' });
				}

				// Box command dispatch
				if ('setMode' == prop) doCommand(STATE.ctl.setMode, obj);
				if ('stop' == prop) doCommand(STATE.ctl.stop);
				if ('setValue' == prop) doCommand(STATE.ctl.setValue, obj.address, obj.value);

				// Video Sharing
				// Normally, the Dom will initiate a call to the sub when
				// ready to share video.  We only need to make a call when
				// the Dom reports that they are NOT sharing video.
				if (('videoShare' == prop) && !obj && STATE.videoShare) {
					STATE.mediaConnection = P.call(STATE.dataConn.peer, STATE.videoShare);
				}
			}
		});

		dataConnection.on('close', () => {
			if (STATE.dataConn) {
				UI.log.textContent += `${UI.domName.textContent} has disconnected.\n`;
				UIkit.notification(`<b>${UI.domName.textContent}</b> has disconnected.`, { pos: 'top-left', status: 'primary' });
				STATE.dataConn = null;
			}
			toggleState(false, STATE.ctl);
		});

		dataConnection.on('error', (err) => {
			console.log(`Data Connection ${err}`);
			console.dir(err);
		});

	});

	// This happens when Dom calls us with either audio/video to share or eStim audio
	P.on('call', (mediaConnection) => {

		if (mediaConnection.metadata && (true == mediaConnection.metadata.estimAudio)) {
			mediaConnection.answer(null);

			mediaConnection.on('stream', (stream) => {
				UI.estimAudio.autoplay = true;
				UI.estimAudio.srcObject = stream;
				UI.iconEstimAudio.classList.toggle("connected", true);
			});

			mediaConnection.on('close', () => {
				UI.estimAudio.pause();
				UI.estimAudio.srcObject = null;
				UI.iconEstimAudio.classList.toggle("connected", false);
			});

		} else {

			if (STATE.mediaConnection) STATE.mediaConnection.close();

			mediaConnection.answer(STATE.videoShare);
			STATE.mediaConnection = mediaConnection;

			// This happens when remote audio/video arrives from the Dom
			STATE.mediaConnection.on('stream', (stream) => {
				UI.remoteVideo.nextElementSibling.hidden = true; // Hide overlay
				UI.remoteVideo.srcObject = stream;
				UI.remoteVideo.autoplay = true;
			});

			// This happens when the media connection is closed, e.g. by the
			// remote dom ending the call.
			STATE.mediaConnection.on('close', () => {
				UI.remoteVideo.nextElementSibling.hidden = false; // Show overlay
				UI.remoteVideo.srcObject = null;
				STATE.mediaConnection = null;
			});
		}
	});

	return P;
}

// Process a box command received from the remote Dom;
// reply with an updated {info} object reflecting the result
// of the command.  Some commands return an object; others
// return a scalar value or nothing; in that case, send
// a small heartbeat snapshot instead.
async function doCommand(f, ...params) {
	let info = await f(...params);
	if (!info || ('object' != typeof (info))) info = STATE.ctl.getInfo(true);
	STATE.dataConn.send({ info: info });
}


// Format an ID string into chunks of 4 characters
function idFormat(idText) {
	const s = idText.replace('-', '');
	let buffer = [];
	let i = 0;
	for (const char of s) {
		buffer.push(char);
		if (0 == (++i % 4)) buffer.push('-');
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
		try {
			STATE.videoShare = await navigator.mediaDevices.getUserMedia(constraints);
			UI.localVideo.nextElementSibling.hidden = true;
			UI.localVideo.srcObject = STATE.videoShare;
			UI.localVideo.muted = true;
			UI.localVideo.play();
			UI.butShare.textContent = 'Stop Sharing';

			// If remote peer exists but no media connection yet, call
			if (STATE.dataConn) {
				if (STATE.mediaConnection) {
					// Tell remote that we have video available; remote will
					// close connection and call back.
					if (STATE.dataConn) STATE.dataConn.send({ videoShare: true });
				} else {
					STATE.mediaConnection = STATE.peer.call(STATE.dataConn.peer, STATE.videoShare);
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
		UI.localVideo.pause();
		STATE.videoShare.getTracks().forEach(track => { track.stop(); });
		UI.localVideo.srcObject = null;
		STATE.videoShare = null;
		UI.localVideo.nextElementSibling.hidden = false;
		UI.butShare.textContent = 'Share Audio / Video';

		if (STATE.mediaConnection) {
			STATE.mediaConnection.close();
			STATE.mediaConnection = null;
		}
	}
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
