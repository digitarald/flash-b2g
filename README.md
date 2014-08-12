# Flash B2G

Shallow-flash Gecko and Gaia on Firefox OS devices from Mozilla's public build server with just one command.

[![NPM version](http://img.shields.io/npm/v/flash-b2g.svg?style=flat)](https://www.npmjs.org/package/flash-b2g)
[![Dependency Status](http://img.shields.io/gemnasium/digitarald/flash-b2g.svg?style=flat)](https://gemnasium.com/digitarald/flash-b2g)

## Dependencies

* [Node 10.x](http://nodejs.org/download/)
* [ADB](http://developer.android.com/tools/help/adb.html) from the [Android SDK](http://developer.android.com/sdk/index.html)

## What does it do?

1. Downloads matching (by `device`, `channel` and `date`) builds from http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/
2. Flashes gecko and gaia (a so called *[shallow flash](https://github.com/Mozilla-TWQA/B2G-flash-tool/blob/master/shallow_flash.sh)*).

Shallow flash only! If you want to stay up-to-date **you need to flash the *latest base image* for your device yourself.** See [Flame software updates](https://developer.mozilla.org/en-US/Firefox_OS/Developer_phone_guide/Flame#Updating_your_Flame%27s_software).

### What are the alternatives?

1. Download Gecko and Gaia from the [Mozilla B2G Nightly FTP](http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/) and use [shallow_flash.sh](https://github.com/Mozilla-TWQA/B2G-flash-tool/blob/master/shallow_flash.sh) to flash the packages on your phone.
2. Or [build Gecko and Gaia](https://developer.mozilla.org/en-US/Firefox_OS/Building) from source and [flash them](https://developer.mozilla.org/en-US/Firefox_OS/Installing_on_a_mobile_device) on your phone.

## Installation

Use the `flash-b2g` command as [global NPM](http://blog.nodejs.org/2011/03/23/npm-1-0-global-vs-local-installation) command:

```bash
> npm install -g flash-b2g
```

## Usage

```bash
> node index.js --help

Shallow-flash Gecko and Gaia on Firefox OS devices from Mozilla's public build server (http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/).
Usage: flash-b2g [device] [channel]

Examples:
  flash-b2g flame 1.4                    Flash a flame with 1.4 build.
  flash-b2g flame --folder ~/            Flash a flame with a nightly build (downloaded to ~/)
  flash-b2g flame --folder ~/ --local    Flash a Flame device with a previously downloaded build in ~/.
  flash-b2g hamachi aurora --eng         Flash an Hamachi device with an aurora engineering build.


Options:
  --device, -i    Device (flame, helix, hamachi, …)       [default: "flame"]
  --channel, -c   Channel (central, aurora, 1.4, …)       [default: "central"]
  --date, -t      Build date (regression window testing)  [default: "latest"]
  --eng, -e       Engineering build (marionette testing)
  --local, -l     Use local files, skipping FTP
  --profile, -p   Keep profile (no promises)
  --remotify, -r  Set device into development mode
  --help          Show this help
```

### Settings for `--remotify`

Making life easy for developers (read: not for consumers!). This does not enable remote debugging but also all the little hidden preferences that make development easier, like disabling lockscreen (which would prevent remote debugging) or the remote debugging prompt.

Preferences:

* `'devtools.console.logger.forbid-certified-apps': false` Enable debugging for certified apps
* `'devtools.console.logger.prompt-connection': false` Disable prompt for remote debugging
* `'b2g.adb.timeout': 0` Disable remote debugging timeout, ([bug 874484](https://bugzilla.mozilla.org/show_bug.cgi?id=874484))
* `// : This optimization :
* `'javascript.options.discardSystemSource': false` Allow debugger to fetch script sources for certified apps, [bug 1001348](https://bugzilla.mozilla.org/show_bug.cgi?id=1001348)
* `'layout.css.report_errors': false` Disable CSS errors in logcat

Settings:

* `'developer.menu.enabled': true`
* `'ftu.manifestURL': null` Disable First-Time-User experience
* `'debugger.remote-mode': 'adb-devtools'` Enable full remote debugging
* `'screen.timeout': 0` Disable screen timeout
* `'lockscreen.locked': false` Unlock screen on launch
* `'lockscreen.enabled': false` Disable lockscreen
