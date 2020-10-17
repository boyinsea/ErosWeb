'use strict';

/*
	UTILITIES
*/

class EWUtility {
	// Vertically resize an element to fill the viewport, net of any
	// sibling elements below it in the page.
	static resize(el) {
		const myStyles = window.getComputedStyle(el);
		const parentStyles = window.getComputedStyle(el.parentElement);

		const topOffset = el.getBoundingClientRect()
			.top + parseInt(myStyles.paddingTop.replace("px", ""));
		const bottomPadding = parseInt(myStyles.paddingBottom.replace("px", "")) +
			parseInt(parentStyles.paddingBottom.replace("px", ""));

		let height = window.innerHeight - topOffset - bottomPadding;
		let next = el.nextElementSibling;
		while (true) {
			if (!next) break;
			const nextStyles = window.getComputedStyle(next);
			const nextHeight = parseInt(nextStyles.height.replace("px", "")) +
				parseInt(nextStyles.marginBottom.replace("px", "")) +
				parseInt(nextStyles.marginTop.replace("px", ""));
			height -= nextHeight;
			next = next.nextElementSibling;
		}
		el.style.height = `${height}px`;
	}

	// Extract alert text from page HTML and display it as a modal dialog.
	static async showAlert(name, err) {
		const e = document.querySelector(`.alert .${name}`);
		if (!e) throw new Error(`Alert '${name}' not found in page HTML.`);
		let h = e.innerHTML;
		if (err) h += `<pre>${err}</pre>`;
		return UIkit.modal.alert(h);
	}

	// Configure the <range>, <span>/badge, and <button> elements within
	// a DIV to create an interactive slider control.
	// UPDATED VERSION - +/- buttons optional
	// Options:	{inverse: true}	Reverses direction; positive to the left
	//			{singleStep: true} Limits user changes to one unit at a time
	static configureSlider(sliderDiv, options) {

		const range = sliderDiv.querySelector('input[type="range"]');
		const badge = sliderDiv.getElementsByClassName("uk-badge")[0];
		const inverse = (options && options.inverse);

		range.singleStep = (options && options.singleStep);

		sliderDiv.setRange = (low, high) => {
			range.min = low;
			range.max = high;
		};

		sliderDiv.setValue = (newValue) => {
			range.value = (inverse) ? parseInt(range.max) - newValue + parseInt(range.min) : newValue;
			range.was = parseInt(range.value);
			range.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
		};

		sliderDiv.getValue = () => {
			const curValue = parseInt(range.value);
			return (inverse) ? parseInt(range.max) - curValue + parseInt(range.min) : curValue;
		};

		sliderDiv.setLimit = (limit) => {
			range.limit = limit;
			if (range.value > range.limit) sliderDiv.setValue(limit);
		};

		sliderDiv.setBadge = (value) => { if (badge) badge.innerText = value; };

		range.addEventListener("input", EWUtility._handleSliderInput);

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

	// Special handling for the 'input' event:
	//	-	Limit changes resulting from the user clicking on the slider track
	//		to one step at a time (to prevent large jumps in value).
	//	-	Enforce limits, if any, on the maximum value.
	//	-	Update "badge" UI if applicable.
	static _handleSliderInput(e) {

		const range = e.target;
		const div = range.parentElement;

		// "Debounce" events; FireFox fires an "input" event (with the same .value)
		// on both mouseDown and mouseUp.  Essentially, ignore every other event.
		if ("" == navigator.vendor) {	// Firefox
			if (range.value !== range.last) // different values; save current input and continue
				range.last = range.value;
			else {
				// repeated values; ignore this event and reset.
				range.value = range.was;
				range.last = 0;
				return;
			}
		}

		// Limit changes made by user input (e.g., clicking or dragging) to
		// at most one step at a time.  This should NOT apply to changes
		// made via setValue (e.g., to set the slider to a box-suppplied value).
		// |cancelable| is FALSE for events that arise from user interaction, but
		// defaults to TRUE for events dispatched in code ala setValue().
		if (range.singleStep && !e.cancelable) {
			const v = parseInt(range.value),
				was = parseInt(range.was);
			range.value = was + (v > was || -1);
		}

		// Enforce scene limit / maximum value
		if (range.limit && (range.value > range.limit)) {
			e.stopPropagation();
			e.preventDefault();
			range.value = range.limit;
			div.classList.toggle('atLimit', true);
			setTimeout(() => { div.classList.toggle('atLimit', false); }, 2250);
		} else
			div.setBadge(e.target.value);

		range.was = range.value;
	}

	// Generate a unique-enough Session ID based on current time
	// and scene name.
	static getSessionId(name) {
		let hash = Date.now(),
			i = 0;
		while (i < name.length) {
			hash = ((hash << 5) - hash) + name.charCodeAt(i++);
			hash |= 0;
		}
		return Math.abs(hash)
			.toString(36);
	}

	// Format an ID string into chunks
	static idFormat(idText) {
		const s = idText.replace('-', '');
		let buffer = [];
		let i = 0;
		for (const char of s) {
			buffer.push(char);
			if (0 == (++i % 3)) buffer.push('-');
		}
		return buffer.join('')
			.replace(/\-$/, '');
	}
}

export { EWUtility }
