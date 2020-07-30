# ErosWeb – Remote Control of the ET-312 eStim Box

This application delivers software remote control of the [ErosTek ET-312 e-stim power unit](https://erostek.com/products/et312b-digital-power-unit) using modern, web-based technology.  There is nothing to download or install aside from the standard components needed to physically connect the ET-312 to a computer.  ErosWeb is BDSM-informed and aims to facilitate safe, sane, and consensual 1:1 play over the internet.

* [sub page](/sub.html) – start a scene ([how-to](#subs-wishing-to-present-themselves-for-remote-control-over-the-internet))
* [Dom page](/Dom.html) – remote-control a sub

Features include:
* Full remote control of all ET-312 front-panel features.
* Support for audio/audioStim files.
* In-scene voice and video interaction between Dom and sub.
* Fail-safe protocols which attempt to account for internet connectivity issues and enable the sub to end the scene at any time.


## Getting Started

ErosWeb does not change the dynamics of scene negotiaton or play partner selection and vetting.  The goal is simply to serve the large installed base of ET-312 owners.  Or, put more simply, why let the E2B people have all the fun?  Once Dom and sub are ready to play, proceed as follows, or consult the [detailed documentation](/documentation.md).

[chrome]: https://www.google.com/chrome/

### _subs_
wishing to present themselves for remote control over the internet. (Yes, the sub has to do more work.)

**Requirements:**
- ET-312 Box
- Mac or Windows PC
- Appropriate hardware to connect the ET-312 to the computer.  See the [Connectivity Tips](/documentation.html#physically-connecting-the-et-312).
- Latest version of [Google Chrome][chrome].  Chrome does not need to be the default browser, but ErosWeb relies on the [Web Serial API](https://github.com/WICG/serial/blob/gh-pages/EXPLAINER.md) which, as of July 2020, is only available in Chrome.

*When ready, [start a scene](/sub.html).*

### _Doms_
wishing to remotely-control a sub.

**Requirements** – one of the following:
- Mac running [the latest version of Chrome][chrome] (recommended), Safari, or Firefox.
- Windows PC running [the latest version of Chrome][chrome] (recommended) or Firefox.
- iPad running Safari.  Only the Safari browser is supported on iPad.

Once scene negotiation is complete, the sub can provide a direct link to remote control the scene.  Or, go to the [Dom page](/Dom.html) and enter the Session ID and optional PIN provided by the sub.

#### Notes
* Microsoft Edge should work, but testing is limited.
* Running ErosWeb on a phone is not recommended because there is not enough room for the UI.

## Acknowledgments and Technical Details

Product and company names mentioned herein may be trademarks of their respective owners.

ErosWeb is free open source software provided under the [Apache License](http://www.apache.org/licenses/). The software relies extensively on [Metafetish](https://stpihkal.docs.buttplug.io/hardware/erostek-et312b.html) for documentation of the ET-312 control protocol and the [buttshock project](https://github.com/buttshock) (most recent repo [here](https://github.com/nannook206/buttshock-py)) for practical code examples.

I credit [smealum](https://www.youtube.com/watch?v=CsQ2VWEfduM) and [JustTryingToPlease](https://www.recon.com/JustTryingToPlease) for the inspiration to dabble in teledildonics.  The design is modeled after eStim scenes performed by experienced players like [nnflyboy]( https://www.recon.com/nnflyboy) and [ncx180](https://www.recon.com/ncx180).
