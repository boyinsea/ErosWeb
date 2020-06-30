/*
 * @license
 */
"use strict";

import { ET312Serial } from './ET312.js';
import { ET312Controller } from './ET312Controller.js';
import { audioUI } from './js/audio2.js';

let et312;
let ctl;
let heartbeat;

const log = document.getElementById("log");

window.addEventListener("resize", logResize);

function logResize() {
	const log = document.getElementById("log");
	const myStyles = window.getComputedStyle(log);
	const parentStyles = window.getComputedStyle(log.parentElement);

	const topOffset = log.getBoundingClientRect().top + parseInt(myStyles.paddingTop.replace("px", ""));
	const bottomPadding = parseInt(myStyles.paddingBottom.replace("px", "")) +
		parseInt(parentStyles.paddingBottom.replace("px", ""));

	const height = window.innerHeight - topOffset - bottomPadding;

	log.style.height = `${height}px`;
}

document.addEventListener("DOMContentLoaded", () => {

	const appUi = document.getElementById("appUi");
	const notSupported = document.getElementById("notSupported");

	// Simply display an error message if we can't run.
	// if (!("serial" in navigator)) {
	// 	notSupported.hidden = false;
	// 	appUi.hidden = true;
	// 	return;
	// }

	notSupported.hidden = true;

	const butConnect = document.getElementById("butConnect");
	const butStatus = document.getElementById("butStatus");
	const butControl = document.getElementById("butControl");
	butConnect.addEventListener("click", clickConnect);
	butStatus.addEventListener("click", clickStatus);
	butControl.addEventListener("click", clickControl);

	// Navigation warning if currently connected to ET312;
	// should disconnect first to reset key.
	window.onbeforeunload = function (e) {
		if (et312) {
			e.preventDefault();
			return '';
		}
	};

	// No server to submit data to!  This keeps wayward click and
	// submit-type events from inadvertently resetting the form.
	const controls = document.getElementById("controls");
	controls.addEventListener("submit", (e) => { e.preventDefault(); });

	// Capture "timeout"
	window.addEventListener("unhandledrejection", (e) => {
		console.warn(e.reason);
		if ("Error: timeout" == e.reason) {


			UIkit.modal.dialog(
				`<div class="uk-modal-body">
				<b>Connection Lost</b>
				<p>The connection to the ET-312 has been interrupted.</p>
				<p>Reset the ET-312 by turning it off and then on again, then
				try to reconnect.</p>
				</div>`
			);
			e.preventDefault();
			toggleUIConnected(false); // Cancel heartbeat & Reset page to "not connected" state

			ctl = null;
			et312._key = null; // Reset key & close serial connection
			et312.close().then(() => {
				et312 = null;
				log.textContent += 'Error: Connection to ET-312 reset.\n';
			});
		}
	});

	const modeArray = document.getElementById("modeArray");
	modeArray.highlightMode = (newMode) => {
		let currentModeButton = modeArray.querySelector('button.uk-button-primary');
		if (currentModeButton) {
			//"de-select" current mode in the UI
			currentModeButton.classList.add('uk-button-secondary');
			currentModeButton.classList.remove('uk-button-primary');
		}
		if (0 == newMode) return; // Styling on "stop" mode is never changed

		// highlight new mode, if any
		let newModeButton = modeArray.querySelector(`button[value="${newMode}"]`);
		if (newModeButton) {
			newModeButton.classList.add('uk-button-primary');
			newModeButton.classList.remove('uk-button-secondary');
		}
	};

	modeArray.addEventListener("click", (e) => {
		let newMode = e.target.value;
		if (newMode && ('BUTTON' == e.target.tagName)) {
			e.preventDefault();
			newMode = parseInt(newMode);

			// Dispatch new mode to box and get back updated
			// status: mode, MA setting and range.
			let modeChange;
			if (0 == newMode) {
				modeChange = ctl.stop();
			} else {
				modeChange = ctl.setMode(newMode);
			}
			modeChange.then((info) => {
				refreshUI(info); // Highlight new mode (if any) in UI
			});
		}
	});

	let level = document.getElementById("levelMultiAdjust");
	configureSlider(level, true); // Invert range values
	level.addEventListener("change", (e) => {
		ctl.setValue(
			ctl.DEVICE.MAVALUE,
			[e.currentTarget.getValue()]);
	});

	level = document.getElementById("levelA");
	configureSlider(level);
	level.addEventListener("change", (e) => {
		ctl.setValue(
			ctl.DEVICE.ADC4,
			[Math.round((e.currentTarget.getValue() / 99) * 255)]);
	});

	level = document.getElementById("levelB");
	configureSlider(level);
	level.addEventListener("change", (e) => {
		ctl.setValue(
			ctl.DEVICE.ADC5,
			[Math.round((e.currentTarget.getValue() / 99) * 255)]);
	});

	let selSplit = document.getElementById("selSplitA");
	selSplit.addEventListener("change", (e) => {
		ctl.setValue(ctl.DEVICE.SPLITA, [parseInt(e.currentTarget.value)]);
	});

	selSplit = document.getElementById("selSplitB");
	selSplit.addEventListener("change", (e) => {
		ctl.setValue(ctl.DEVICE.SPLITB, [parseInt(e.currentTarget.value)]);
	});

	// Set up audio components
	const A = new audioUI();
	const localAudio = document.getElementById("localAudio");
	const dropTarget = document.getElementById("dropTarget");
	localAudio.volume = 0.1;

	// Adjust UI when a new audio file is loaded.
	localAudio.addEventListener('loadedmetadata', () => {
		dropTarget.querySelector("#fileName").innerText = localAudio.title;
		dropTarget.classList.add('uk-text-right');
		dropTarget.classList.remove('uk-text-center');
		dropTarget.querySelectorAll('.gotFile').forEach(ele => ele.classList.add('gotFileActive'));
	});

	localAudio.addEventListener('play', async function () {
		let OK = false;
		if (ctl) {
			const m = await ctl.getMode();
			if (m && m.startsWith("Audio")) OK = true;
		}
		if (!OK) UIkit.notification(
			//`<p class="uk-text-small">Cannot play file of ${msg}.  (${file.name})</p>`,
			'Remember to select an Audio mode!', { pos: 'top-right', status: 'primary' }
		);

	});

	audioUI.configureDropTarget(dropTarget, localAudio);

	// Finalize UI setup
	toggleUIConnected(false)
		.then(() => A.init())
		.then(() => {
			A.configureOutputSelector(document.getElementById("localAudioDest"), localAudio);
			logResize();
			appUi.hidden = false; // Show the UI once it is all configured.
		});

});

/*
Configure a <select> element for each channel of the "split"
mode, based on the current box configuration.
*/
function configureSplitSelect(selControl, currentMode, info) {
	while (selControl.firstChild) {
		selControl.removeChild(selControl.firstChild);
	}
	for (const boxMode in ctl.MODES) {
		if ((boxMode <= info.TOPMODE) && ctl.SPLITMODES.includes(parseInt(boxMode))) {
			const option = document.createElement("option");
			option.value = boxMode;
			option.text = ctl.MODES[boxMode];
			if (currentMode == boxMode) option.selected = true;
			selControl.appendChild(option);
		}
	}
}

async function toggleUIConnected(connected) {

	butConnect.textContent = (connected) ? "Disconnect" : "Connect to ET-312";

	if (connected) {
		ctl = new ET312Controller(et312);
		const info = await ctl.getInfo();

		const modeArray = document.getElementById("modeArray");
		modeArray.highlightMode(info.MODENUM);

		// Configure drop-downs for "Split" mode with list
		// of available modes and current mode for each channel
		let selSplit = document.getElementById("selSplitA");
		configureSplitSelect(selSplit, info.SPLITA, info);
		selSplit = document.getElementById("selSplitB");
		configureSplitSelect(selSplit, info.SPLITB, info);
		ctl.getInfo(false).then(refreshUI);

		// Update UI with current values (including multi-adjust range)
		refreshUI(info);

		//Visibly enable UI for interaction
		const controls = document.getElementById("controlsOnline");
		controls.querySelectorAll('#modeArray button, #modeArray select').forEach((i) => i.disabled = false);
		controls.classList.remove("disabled");

		toggleUIControl(info.SYSTEMFLAGS & 0x01);

		// Update the UI with current box status every 5 seconds.
		// Skip the update if less than 1 second has elapsed since status
		// information was last retrieved.
		heartbeat = setInterval(() => {
			ctl.getInfo(1000).then((info) => { if (info) refreshUI(info); });
		}, 5000);

		// // DEBUG:
		window.et312 = ctl;
		//\// DEBUG:
	} else {
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = null;
		}

		//Visibly disable online-only UI for interaction until connected
		const controls = document.getElementById("controlsOnline");
		controls.querySelectorAll('button, select, input').forEach((i) => i.disabled = true);
		controls.classList.add("disabled");

		// This is only important on the very first run through upon loading the page.
		// The default "visibility: hidden" style allows layout to proceed, but keeps
		// the user from seeing any flashing/updates.
		appUi.style = null; // Remove default "visibility: hidden"
	}
}

// Configure the <range>, <span>/badge, and <button> elements within
// a DIV to create an interactive slider control.
function configureSlider(sliderDiv, inverse) {
	let range = sliderDiv.querySelector('input[type="range"]');

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

	let badge = sliderDiv.getElementsByClassName("uk-badge")[0];
	if (badge) {
		range.addEventListener("input", (e) => {
			badge.innerText = range.value;
		});
	}

	let upDown = sliderDiv.getElementsByTagName('button');
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

/**
 * @name clickConnect
 * Click handler for the connect/disconnect button.
 */
async function clickConnect() {

	// Disconnect if already connected.
	if (et312) {
		await ctl.takeControl(false); // Relenquish remote control if we have it
		await toggleUIConnected(false);
		ctl = null;
		await et312.close(); // Reset key & close serial connection
		et312 = null;
		log.textContent += 'Disconnected.\n';
		return;
	}

	try {
		let port = await navigator.serial.requestPort();
		log.textContent += 'Connecting...\n';
		et312 = new ET312Serial(port);
		await et312.connect();
		toggleUIConnected(true);
		log.textContent += 'Connected!\n';
	} catch (err) {
		if ('NotFoundError' == err.name) {
			log.textContent += 'No port was selected.\n';
		} else {
			console.dir(err);
			log.textContent += `Error connecting to ET-312: ${err.message}\n`;
			await UIkit.modal.alert(
				`<b>Could not connect to ET-312</b>
				<ul>
				<li>Make sure that you selected the correct serial port.</li>
				<li>Make sure the ET-312 is turned on.</li>
				<li>Reset the ET-312 by turning it off and on again.</li>
				</ul>
				<pre>${err}</pre>`
			);
			et312 = null;
		}
	}
}

function clickStatus() {
	if (et312) {
		log.textContent = 'Retrieving status...\n';
		console.log("Begin status fetch.");
		ctl.getInfo()
			.then((info) => {
				console.dir(info);
				for (const property in ctl.DEVICE) {
					log.textContent += `${ctl.DEVICE[property].description}: ${info[property]}\n`;
				}
				refreshUI(info);
			});
	}
}

// Update the UI with the latest values from the box
function refreshUI(info) {
	document.getElementById("modeArray").highlightMode(info.MODENUM);
	const MA = document.getElementById("levelMultiAdjust");
	if (('MALOW' in info) && ('MAHIGH' in info)) MA.setRange(info.MALOW, info.MAHIGH);
	MA.setValue(info.MAVALUE);
	document.getElementById("levelA").setValue(Math.round((info.ADC4 / 255) * 99));
	document.getElementById("levelB").setValue(Math.round((info.ADC5 / 255) * 99));
	// TODO: Audio levels?
}

async function clickControl() {

	// Get current control status
	let control = await ctl.getValue(ctl.DEVICE.SYSTEMFLAGS) & 0x01;
	console.log(`Remote control? ${control}`);

	control = !control;
	await ctl.takeControl(control);
	toggleUIControl(control);
}

// Toggle the UI between remote control of the analog controls via this page (true)
// or local/box control (false)
async function toggleUIControl(control) {

	const butControl = document.getElementById("butControl");
	butControl.textContent = (control) ? "Relenquish Control" : "Take Control";

	const controls = document.getElementById("controlsADC");
	controls.querySelectorAll('button, input').forEach((i) => i.disabled = !control);

	if (control) {
		controls.classList.remove("disabled");
	} else {
		controls.classList.add("disabled");
	}
}
