# Flash B2G

Shallow-flash Gecko and Gaia on Firefox OS devices from Mozilla's public build server with just one command.

[![NPM version](http://img.shields.io/npm/v/flash-b2g.svg?style=flat)](https://www.npmjs.org/package/flash-b2g)
[![Dependency Status](http://img.shields.io/gemnasium/digitarald/flash-b2g.svg?style=flat)](https://gemnasium.com/digitarald/flash-b2g)

## What does it do?

1. **Downloads build**, matched by `device`, `channel` and `date`, from http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/
2. **Flash Gecko and Gaia**, a so called *[shallow flash](https://github.com/Mozilla-TWQA/B2G-flash-tool/blob/master/shallow_flash.sh)*)

### Shallow flash?

```
+-------=---+
|   Gaia    | ]                ]
|  -------  | ]- Shallow flash ]
|   Gecko   | ]                ]- Base image flash
|  -------  |                  ]
|   Gonk    |                  ]
|           |
|-----------|
|     ⊙     |
+-----------+
```

Firefox OS has [three layers](http://en.wikipedia.org/wiki/Firefox_OS#Core_technologies), where most development happens in the `Gecko` (browser engine) and `Gaia` (user interface) layers. `Gonk` and lower contain proprietary bits like hardware drivers and RIL and are therefor not build by Mozilla.

For a full `base image flash` check [Flame software updates](https://developer.mozilla.org/en-US/Firefox_OS/Developer_phone_guide/Flame/Updating_your_Flame) on MDN.

### What are the alternatives?

* **Download Gecko and Gaia from the [Mozilla B2G Nightly FTP](http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/)** and use [shallow_flash.sh](https://github.com/Mozilla-TWQA/B2G-flash-tool/blob/master/shallow_flash.sh) to flash the packages on your phone.
* **[Build Gecko and Gaia](https://developer.mozilla.org/en-US/Firefox_OS/Building) from source** and [flash them](https://developer.mozilla.org/en-US/Firefox_OS/Installing_on_a_mobile_device) on your phone.

## Dependencies

* [Node 10.x](http://nodejs.org/download/)
* [ADB](http://developer.android.com/tools/help/adb.html) from the [Android SDK](http://developer.android.com/sdk/index.html)

## Installation

Use the `flash-b2g` command as [global NPM](http://blog.nodejs.org/2011/03/23/npm-1-0-global-vs-local-installation) command:

```bash
> npm install -g flash-b2g
```

## Usage

```bash
> flash-b2g --help

Shallow-flash Gecko and Gaia on Firefox OS devices from Mozilla's public build server (http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/).
Usage: flash-b2g [device] [channel=central]

Examples:
  flash-b2g flame-kk 2.0                    Flash a flame with 2.0 build.
  flash-b2g flame-kk --folder ~/            Flash a flame with a nightly build (downloaded to ~/)
  flash-b2g flame-kk --folder ~/ --local    Flash a Flame device with a previously downloaded build in ~/.
  flash-b2g hamachi aurora --eng            Flash an Hamachi device with an aurora engineering build.


Options:
  --device, -i     Device (flame-kk [kitkat base image], flame, helix, hamachi, …)
  --channel, -c    Channel (central, aurora, 1.4, …)                                [default: "central"]
  --date, -t       Build date (for regression window testing)                       [default: "latest"]
  --eng, -e        Engineering build (for marionette testing)
  --dir, -d        Directory to keep downloads (defaults to temp)
  --local, -l      Use local files, skipping FTP (requires --dir)
  --profile, -p    Keep profile (no promises)
  --remotify, -r   Set device into development mode
  --only-remotify  Skip flashing, only set development mode
  --help, -h       Show this help
```

### Settings for `--remotify`

Making life easy for developers (read: not for consumers!). This does not enable remote debugging but also all the little hidden preferences that make development easier, like disabling lockscreen (which would prevent remote debugging) or the remote debugging prompt.

Preferences:

* `'devtools.debugger.forbid-certified-apps': false` Enable debugging for certified apps
* `'devtools.debugger.prompt-connection': false` Disable prompt for remote debugging
* `'b2g.adb.timeout': 0` Disable remote debugging timeout, ([bug 874484](https://bugzilla.mozilla.org/show_bug.cgi?id=874484))
* `'layout.css.report_errors': false` Disable CSS errors in logcat

Settings:

* `'developer.menu.enabled': true`
* `'ftu.manifestURL': null` Disable First-Time-User experience
* `'debugger.remote-mode': 'adb-devtools'` Enable full remote debugging
* `'screen.timeout': 600` 10min screen timeout
* `'lockscreen.locked': false` Unlock screen on launch
* `'lockscreen.enabled': false` Disable lockscreen
