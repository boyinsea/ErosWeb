'use strict';

/***
	from https://stackoverflow.com/a/21404549

	Helper functions to set webRTC codecs/audio quality
*/
class webRTChelper {

	static sdpVoice(sdp) {
		// firefox: a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1
		// chrome: a=fmtp:111 minptime=10;useinbandfec=1
		// safari: a=fmtp:111 minptime=10;useinbandfec=1

		//sdp = sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; maxaveragebitrate=510000');
		//return webRTChelper.preferOpus(sdp, 'voice');
		return sdp;
	}

	static sdpAudio(sdp) {
		return webRTChelper.preferOpus(sdp, 'audio');
	}

	static preferOpus(sdp, mode) {
		let sdpLines = sdp.split('\r\n');
		let mLineIndex;
		for (let i = 0; i < sdpLines.length; i++) {
			if (sdpLines[i].search('m=audio') !== -1) {
				mLineIndex = i;
				break;
			}
		}

		if (mLineIndex === null) return sdp;

		for (let i = 0; i < sdpLines.length; i++) {
			if (sdpLines[i].search('opus/48000') !== -1) {
				const opusPayload = this.extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
				if (opusPayload)
					sdpLines[mLineIndex] = this.setDefaultCodec(sdpLines[mLineIndex], opusPayload);
				break;
			}
		}

		sdpLines = this.removeCN(sdpLines, mLineIndex);

		if (mode) {
			let result;
			for (let i = 0; i < sdpLines.length; i++) {
				result = sdpLines[i].match(/^(a=fmtp:\d+ )/);
				if (result) {
					if ('voice' == mode) {
						sdpLines[i] = result[0] + 'maxplaybackrate=16000; sprop-maxcapturerate=16000; maxaveragebitrate=20000; stereo=0; useinbandfec=1; usedtx=0';
					} else if ('audio' == mode) {
						sdpLines[i] = result[0] + 'maxaveragebitrate=510000; stereo=1; useinbandfec=1; minptime=10';
					}
					break;
				}
			}
		}

		sdp = sdpLines.join('\r\n');
		return sdp;
	};

	static extractSdp(sdpLine, pattern) {
		const result = sdpLine.match(pattern);
		return (result && result.length == 2) ? result[1] : null;
	};

	static setDefaultCodec(mLine, payload) {
		const elements = mLine.split(' ');
		let newLine = new Array();
		let index = 0;
		for (let i = 0; i < elements.length; i++) {
			if (index === 3) newLine[index++] = payload;
			if (elements[i] !== payload) newLine[index++] = elements[i];
		}
		return newLine.join(' ');
	};

	static removeCN(sdpLines, mLineIndex) {
		let mLineElements = sdpLines[mLineIndex].split(' ');
		for (let i = sdpLines.length - 1; i >= 0; i--) {
			const payload = this.extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
			if (payload) {
				const cnPos = mLineElements.indexOf(payload);
				if (cnPos !== -1) mLineElements.splice(cnPos, 1);
				sdpLines.splice(i, 1);
			}
		}
		sdpLines[mLineIndex] = mLineElements.join(' ');
		return sdpLines;
	};
}

export { webRTChelper };
