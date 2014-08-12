#! /usr/bin/env node

'use strict';

var http = require('http');
var path = require('path');
var fs = require('fs');
var childProcess = require('child_process');
var JSFtp = require('jsftp');
var minimist = require('minimist');
var q = require('q');
var temp = require('temp');
var mkdirp = require('mkdirp');
var moment = require('moment');
var yargs = require('yargs');
var colors = require('colors');

// Command-line arguments
var yarg = yargs.usage('Shallow-flash Gecko and Gaia on Firefox OS devices from Mozilla\'s public build server (http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/).\nUsage: flash-b2g [device] [channel]')
	.example('$0 flame 1.4', 'Flash a flame with 1.4 build.')
	.example('$0 flame --folder ~/', 'Flash a flame with a nightly build (downloaded to ~/)')
	.example('$0 flame --folder ~/ --local', 'Flash a Flame device with a previously downloaded build in ~/.')
	.example('$0 hamachi aurora --eng', 'Flash an Hamachi device with an aurora engineering build.')
	.string([1, 'device', 'channel', 'date'])
	.alias({
		'dir': 'd',
		'channel': 'c',
		'device': 'i',
		'date': 't',
		'local': 'l',
		'eng': 'e',
		'profile': 'p',
		'remotify': 'r'
	})
	.boolean(['eng', 'local', 'profile', 'help', 'remotify', 'help'])
	.default({
		device: 'flame',
		channel: 'central',
		date: 'latest'
	})
	.describe({
		device: 'Device (flame, helix, hamachi, …)',
		channel: 'Channel (central, aurora, 1.4, …)',
		date: 'Build date (regression window testing)',
		eng: 'Engineering build (marionette testing)',
		local: 'Use local files, skipping FTP',
		profile: 'Keep profile (no promises)',
		remotify: 'Set device into development mode',
		help: 'Show this help'
	});
var argv = yarg.argv;
if (argv.help) {
	console.log(yarg.help());
	process.exit();
}
argv.device = (argv._[0] || argv.device).toLowerCase();
argv.channel = String(argv._[1] || argv.channel);
if (/^\d+$/.test(argv.channel)) {
	argv.channel += '.0';
}
if (argv.date && argv.date != 'latest') {
	argv.date = moment(argv.date);
	if (!argv.date.isValid()) {
		throw new Error('Invalid `date` argument');
	}
} else {
	argv.date = null;
}

// Configuration
var FTP_HOST = 'ftp.mozilla.org';
var FTP_URL = 'http://' + FTP_HOST;
var FTP_PATH = '/pub/mozilla.org/b2g/nightly/';
var SCRIPT_PATH = path.join(__dirname, 'scripts');
var FLASH_SCRIPT_PATH = path.join(SCRIPT_PATH, 'shallow_flash.sh');
var TIMEOUT = 60 * 60 * 1000; // 1min

// Set up dirs
temp.track();
var tempDir = temp.mkdirSync('flash-b2g');
var dir = argv.dir;
if (!dir) {
	dir = tempDir;
} else {
	dir = path.resolve(dir)
	if (!fs.existsSync(dir)) {
		mkdirp.sync(dir);
		console.log('Created directory: %s', dir)
	}
}

if (argv['only-remotify']) {
	setDeveloperPrefs().done(function() {
		process.exit();
	});
	return;
}

// FTP connection
// TODO: Allow login
var ftp = new JSFtp({
	host: FTP_HOST
});
ftp.useList = true;
ftp.socket.setTimeout(TIMEOUT);
ftp.socket.once('timeout', function(data) {
	ftp.socket.destroy(); // should call the "ls" callback "err"
});

var dateBit = (argv.date) ? argv.date.format('YYYY-MM-DD') : 'latest';
var channelBit = argv.channel;
if (/\d/.test(channelBit)) {
	channelBit = '.*v' + channelBit.replace(/\./, '_');
}
var pathBits = [dateBit, '.*', channelBit, argv.device];
var nameBits = [argv.device, channelBit];
if (argv.eng) {
	pathBits.push('eng');
	nameBits.push('eng');
}
nameBits.push(dateBit);
var pathMatch = new RegExp('^' + pathBits.join('-') + '$', 'i');
var ftpPath = FTP_PATH;

var b2gFilePath = null;
var b2gFile = null;
var gaiaFile = null;

var localGaiaPath = path.join(dir, 'gaia-' + nameBits.join('-') + '.zip');
var localB2gPath = path.join(dir, 'b2g-' + nameBits.join('-') + '.tar.gz');

function setDeveloperPrefs() {
	var prefs = {
		'devtools.console.logger.forbid-certified-apps': false,
		'devtools.console.logger.prompt-connection': false,
		'b2g.adb.timeout': 0,
		// Bug 1001348: This optimization prevents debugger to fetch script sources
		// of certified apps as well as chrome code:
		'javascript.options.discardSystemSource': false,
		// Reduce noise in logs: http://kb.mozillazine.org/Layout.css.report_errors
		'layout.css.report_errors': false
	};
	var settings = {
		'developer.menu.enabled': true,
		'ftu.manifestURL': null,
		'debugger.remote-mode': 'adb-devtools',
		'devtools.debugger.remote-enabled': true,
		'screen.timeout': 0,
		'lockscreen.locked': false,
		'lockscreen.enabled': false,
	};

	// Wait for device
	console.log('Waiting for device (is remote debugging on?)');
	return q.nfcall(childProcess.exec, 'adb wait-for-device')

	// Stop B2G
	.then(function() {
		console.log('Stopping system');
		return q.nfcall(childProcess.exec, [
			'adb remount', // really needed?
			'adb shell stop b2g'
		].join(' && '));
	})

	// Push preferences
	.then(function() {
		var cmds = ['cd /data/b2g/mozilla/*.default/']
			.concat(Object.keys(prefs).map(function(key) {
				return 'echo \'user_pref(' + JSON.stringify(key) + ', ' +
					JSON.stringify(prefs[key]) + ');\' >> prefs.js';
			})).join(' && ');
		console.log('Appending to prefs.js:\n', prefs);
		return q.nfcall(childProcess.exec, 'adb shell "' +
			cmds.replace(/"/g, '\\"') + '"');
	})

	// Fetch settings.json
	.then(function() {
		return q.nfcall(childProcess.exec, 'adb shell cat /system/b2g/defaults/settings.json');
	})

	.spread(function(stdout) {
		var content = JSON.parse(stdout);
		for (var key in settings) {
			content[key] = settings[key];
		}
		var settingsPath = path.join(tempDir, 'settings.json');
		fs.writeFileSync(settingsPath, JSON.stringify(content));
		console.log('Appending to settings.json:\n', settings);
		return q.nfcall(childProcess.exec, [
			'adb shell mount -o rw,remount /system',
			'adb push ' + settingsPath + ' /system/b2g/defaults/settings.json',
			'adb shell mount -o ro,remount /system'
		].join(' && '));
	})

	// Restart B2G
	.then(function() {
		console.log('Restarting system');
		return q.nfcall(childProcess.exec, 'adb shell sync && adb shell start b2g')
	});
};

// Start process
q.fcall(function() {
	if (argv.local) {
		console.log('Skipping FTP');
		return [];
	}
	console.log('Connecting to %s', FTP_HOST.underline.white);

	// List files in main dir
	return q.ninvoke(ftp, 'ls', ftpPath)
		// Find target dir
		.then(function findTargetFolder(files) {
			files = files.filter(function(file) {
				return pathMatch.test(file.name);
			});
			if (!files.length) {
				throw new Error('Could not find dir matching ' + pathMatch);
			}
			return files[0].name;
		})

	// List files in target dir
	.then(function listTargetFiles(path) {
		ftpPath += path + '/';
		return q.ninvoke(ftp, 'ls', ftpPath);
	})

	// Find b2g package
	.then(function findB2gFile(files) {
		files = files.filter(function(file) {
			return /android-arm\.tar\.gz$/.test(file.name);
		});
		if (!files.length) {
			throw new Error('Could not find b2g package!');
		}
		return files[0].name;
	})

	// Open sockets for b2g and gaia packages
	.then(function openStreams(file) {
		gaiaFile = file;
		var deferGaia = q.defer();
		http.get(FTP_URL + ftpPath + 'gaia.zip', deferGaia.resolve)
			.on('error', deferGaia.reject);
		var deferB2g = q.defer();
		http.get(FTP_URL + ftpPath + gaiaFile, deferB2g.resolve)
			.on('error', deferB2g.reject);
		return [deferGaia.promise, deferB2g.promise];
	})

	// Stream socket data into files
	.spread(function downloadStreams(gaiaStream, b2gStream) {
		console.log('Downloading from %s', (FTP_URL + ftpPath).underline.white);
		var fileFlags = {
			flags: 'w'
		};
		var deferGaia = q.defer();
		gaiaFile = fs.createWriteStream(localGaiaPath, fileFlags);
		gaiaFile.on('finish', function() {
			gaiaFile.close(deferGaia.resolve);
		});
		gaiaStream.pipe(gaiaFile);

		var deferB2g = q.defer();
		b2gFile = fs.createWriteStream(localB2gPath, {
			flags: 'w'
		});
		b2gFile.on('finish', function() {
			b2gFile.close(deferB2g.resolve);
		});
		b2gStream.pipe(b2gFile);
		return [deferB2g.promise, deferGaia.promise];
	});
})

// Execute flash script
.spread(function executeFlash() {
	if (!fs.existsSync(localGaiaPath) || !fs.existsSync(localB2gPath)) {
		throw new Error('Local files not found:\n' + localGaiaPath + '\n' + localB2gPath);
	}

	var defer = q.defer();
	var args = ['-y', '--gaia', localGaiaPath, '--gecko', localB2gPath];
	if (argv.profile) {
		console.log('Attempting to keep profile')
		args.push('--keep_profile')
	}
	console.log('Executing ' + ('shallow_flash.sh ' + args.join(' ')).grey.italic);
	var flash = childProcess.spawn(FLASH_SCRIPT_PATH, args, {
		cwd: tempDir,
		env: {
			PROFILE_HOME: path.join(dir, 'b2g-profile-' + argv.device)
		}
	});
	flash.stdout.on('data', function(data) {
		console.log('[shallow_flash] '.grey + String(data).trim());
	});
	flash.stderr.on('data', function(data) {
		console.log('[shallow_flash] '.red + String(data).trim());
	});
	flash.on('close', function(code) {
		if (code) {
			defer.reject('shallow_flash.sh failed!');
		} else {
			defer.resolve();
		}
	});
	return defer.promise;
})

// Set developer prefs
.then(function() {
	if (argv.remotify) {
		return setDeveloperPrefs();
	}
})

// Listo!
.done(function() {
	console.log('✓ Done');
}, function(err) {
	console.error(String(err).red.bold);
	process.exit();
});