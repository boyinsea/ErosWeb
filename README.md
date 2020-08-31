# Remote Control the ET-312 eStim Power Box

ErosWeb is free, open-source software which provides remote control of the [ErosTek ET-312 e-stim power unit](https://erostek.com/products/et312b-digital-power-unit) using modern, web-based technology.  There is no software to download or install.  Mac, Windows PCs, and iPad are supported.  ErosWeb is BDSM-informed and aims to serve the large community of ET-312 owners by enabling safe, sane, and consensual 1:1 play over the internet.  Or, put more simply, why let the E2B people have all the fun?

## Quickstart
First, negotiate a scene via phone, chat, FaceTime, email, favorite app, etc.  Then...

|subs – [*Present yourself for remote control*](/sub.html)|Doms – [*Remote-control a sub's ET-312*](/Dom.html)|
|:--:|:--:|
|![ET-312](/assets/et312.jpg) + ![sub mode](/assets/sub-image.png)|![Dom mode](/assets/Dom-image.png)|
|[Connect][connect] your ET-312 to a Mac or Windows PC, then use [Google Chrome][chrome] or Microsoft Edge to open the [sub page](/sub.html) and start a scene.  Send the session link or Session ID and PIN to the Dom (or, for the adventurous, publish it online!)|Use a Mac, Windows PC, or iPad to control the scene via a link from the sub, or enter a Session ID and PIN on the [Dom page](/Dom.html). _Note that the Session ID is **cAsE-sEnSiTiVe**!_|

&#x1F4D8; Consult the [How-To Guide](/ErosWeb/documentation.html) for more information and detailed instructions.

Features include:
* Remote control of ET-312 mode, multi-adjust, and power levels.
* In-scene voice and video commuication between Dom and sub.
* Support for audio / audioStim input to the ET-312.
* Fail-safe protocols which attempt to account for internet connectivity issues and enable the sub to end the scene at any time.

## Background
An ErosWeb scene is potentially very much like an in-person scene involving the ET-312.  ErosWeb does not change the dynamics of scene negotiaton or play partner selection and vetting.

The Dom has full control of the box and can change modes and output levels, as well as feed audio into the box.  However, the sub (who is physically connected to the box being controlled) is ultimately responsible for initiating the scene by attaching the ET-312 to their computer, applying/inserting electrodes, and finally "presenting" themselves for control by a remote Dom.

## Requirements

### **sub** – _all_ of the following
1. ET-312 power unit
2. Mac or Windows PC (tablets/iPad are not supported for subs)
3. [Appropriate hardware][connect] to connect the ET-312 to the computer.
4. Latest version of [Google Chrome][chrome] or Microsoft Edge.

Chrome or Edge does not need to be the default browser.  However, ErosWeb sub mode relies on the [Web Serial API](https://github.com/WICG/serial/blob/gh-pages/EXPLAINER.md) to control the ET-312.  As of August 2020, this feature is only available in Chrome and Edge.

### **Dom** – _one_ of the following:
* Mac running [the latest version of Chrome][chrome] (recommended), Safari, or Firefox.
* Windows PC running [the latest version of Chrome][chrome] (recommended), Edge, or Firefox.
* iPad running Safari.  Only the Safari browser is supported on iPad.

Running ErosWeb on a small-screen device like a phone is not recommended.

## Acknowledgments and Technical Details

Product and company names mentioned herein may be trademarks of their respective owners.

ErosWeb is free open source software provided under the [Apache License](http://www.apache.org/licenses/LICENSE-2.0). The software relies extensively on [Metafetish](https://stpihkal.docs.buttplug.io/hardware/erostek-et312b.html) for documentation of the ET-312 control protocol and the [buttshock project](https://github.com/buttshock) (most recent repo [here](https://github.com/nannook206/buttshock-py)) for practical code examples.  Connectivity is via [PeerJS](https://peerjs.com).

I credit [smealum](https://www.youtube.com/watch?v=CsQ2VWEfduM) and [JustTryingToPlease](https://www.recon.com/JustTryingToPlease) for inspiring me to dabble in teledildonics.  The ErosWeb feature set is modeled after eStim scenes performed by experienced players like [nnflyboy]( https://www.recon.com/nnflyboy) and [ncx180](https://www.recon.com/ncx180).

Copyright &#169; 2020 [boyInSEA](mailto:boyinsea59@yahoo.com) (also on [fetlife](https://fetlife.com/users/763523) and [recon](https://www.recon.com/boyinsea))

[chrome]: https://www.google.com/chrome/
[connect]: /ErosWeb/documentation.html#physically-connecting-the-et-312
