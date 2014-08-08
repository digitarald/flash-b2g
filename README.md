# Flash B2G

Flash Firefox OS devices from public Mozilla builds.

* Downloads builds from http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/
* Flashes gecko and gaia (does currently no profile backup).

**You need to flash the *latest base image* for your device yourself.** `flash-b2g` will only flash gaia and gecko. [Flame software updates](https://developer.mozilla.org/en-US/Firefox_OS/Developer_phone_guide/Flame#Updating_your_Flame%27s_software).

## Dependencies

* [Node 10.x](http://nodejs.org/download/)
* *(optional, binaries included)* [ADB](http://developer.android.com/tools/help/adb.html) from the [Android SDK](http://developer.android.com/sdk/index.html)

## Installation

```bash
> npm install -g flash-b2g
```

## Usage

Install latest nightly on Flame:

```bash
> flash-b2g flame
```

Install 1.4 on Flame
```bash
> flash-b2g flame 1.4
```