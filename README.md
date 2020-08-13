# Remote Control of the ET-312 eStim Box

ErosWeb delivers software remote control of the [ErosTek ET-312 e-stim power unit](https://erostek.com/products/et312b-digital-power-unit) using modern, web-based technology.  There is no software to download or install; Mac, Windows PCs, and iPad are supported.  ErosWeb is BDSM-informed and aims to serve the large installed base of ET-312 owners by enabling safe, sane, and consensual 1:1 play over the internet.  Or, put more simply, why let the E2B people have all the fun?

* [sub page](/sub.html) – start a scene ([how-to](#subs))
* [Dom page](/Dom.html) – remote-control a sub

Features include:
* Full remote control of all ET-312 front-panel features.
* In-scene voice and video interaction between Dom and sub.
* Fail-safe protocols which attempt to account for internet connectivity issues and enable the sub to end the scene at any time.
* Support for audio/audioStim files when both Dom and sub are using Google Chrome on a Mac or PC.

## Getting Started
An ErosWeb scene is potentially very much like an in-person scene involving the ET-312.  ErosWeb does not change the dynamics of scene negotiaton or play partner selection and vetting.  The Dom has full control of the box and can change modes and output levels, as well as feed audio into the box.  However, the sub (who is physically connected to the box being controlled) is ultimately responsible for setting up the scene by connecting an ET-312 to their computer, applying/inserting electrodes, and finally "presenting" themselves for control by a remote Dom via a web page.

Once Dom and sub are ready to play, proceed as follows, or consult the [How-To Guide](/ErosWeb/documentation.html).

[chrome]: https://www.google.com/chrome/

### _subs_
wishing to present themselves for remote control over the internet. (Yes, the sub has to do more work.)

**Requirements:**
- ET-312 Box
- Mac or Windows PC (tablets/iPad are not supported for subs)
- Appropriate hardware to connect the ET-312 to the computer.  See the [Connectivity Tips](/ErosWeb/documentation.html#physically-connecting-the-et-312).
- Latest version of [Google Chrome][chrome].  Chrome does not need to be the default browser, but ErosWeb relies on the [Web Serial API](https://github.com/WICG/serial/blob/gh-pages/EXPLAINER.md) to control the ET-312.  As of July 2020, this feature is only available in Chrome.

*When ready, connect the ET-312 to the computer, yourself to the ET-312, then [start a scene](/sub.html).*

### _Doms_
wishing to remotely-control a sub.

**Requirements** – one of the following:
- Mac running [the latest version of Chrome][chrome] (recommended), Safari, or Firefox.
- Windows PC running [the latest version of Chrome][chrome] (recommended) or Firefox.
- iPad running Safari.  Only the Safari browser is supported on iPad.

Once scene negotiation is complete, the sub can provide a direct link to remote control the scene.  Or, go to the [Dom page](/Dom.html) and enter the Session ID and optional PIN provided by the sub.  Note that the Session ID is case-sensitive.

#### Notes
* Microsoft Edge should work, but testing is limited.
* Running ErosWeb on a phone is not recommended because there is not enough screen real-estate for a usable UI.

## Acknowledgments and Technical Details

Product and company names mentioned herein may be trademarks of their respective owners.

ErosWeb is free open source software provided under the [Apache License](http://www.apache.org/licenses/LICENSE-2.0). The software relies extensively on [Metafetish](https://stpihkal.docs.buttplug.io/hardware/erostek-et312b.html) for documentation of the ET-312 control protocol and the [buttshock project](https://github.com/buttshock) (most recent repo [here](https://github.com/nannook206/buttshock-py)) for practical code examples.  Connectivity is via [PeerJS](https://peerjs.com).

I credit [smealum](https://www.youtube.com/watch?v=CsQ2VWEfduM) and [JustTryingToPlease](https://www.recon.com/JustTryingToPlease) for inspiring me to dabble in teledildonics.  The ErosWeb feature set is modeled after eStim scenes performed by experienced players like [nnflyboy]( https://www.recon.com/nnflyboy) and [ncx180](https://www.recon.com/ncx180).

Copyright &#169; 2020 [boyInSEA](https://www.recon.com/boyinsea) (also on [fetlife](https://fetlife.com/users/763523))
