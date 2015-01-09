#! /usr/bin/env node

'use strict';

var http = require('http');
var path = require('path');
var fs = require('fs');
var childProcess = require('child_process');
var JSFtp = require('jsftp');
var Promise = require('es6-promise').Promise;
var temp = require('temp');
var mkdirp = require('mkdirp');
var moment = require('moment');
var yargs = require('yargs');
var colors = require('colors');

// Helper
function promisify(fn) {
	var args = Array.prototype.slice.call(arguments, 1);
	return new Promise(function(resolve, reject) {
		args.push(function(err) {
			if (err != null) {
				reject(err);
			} else {
				resolve.apply(null, Array.prototype.slice.call(arguments, 1));
			}
		});
		if (Array.isArray(fn)) {
			var scope = fn[0];
			var method = fn[1];
			scope[method].apply(scope, args);
		} else {
			fn.apply(null, args);
		}
	});
}

// Command-line arguments
var yarg = yargs.usage('Shallow-flash Gecko and Gaia on Firefox OS devices from Mozilla\'s public build server (http://ftp.mozilla.org/pub/mozilla.org/b2g/nightly/).\nUsage: flash-b2g [device] [channel=central]')
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
		'remotify': 'r',
		'help': 'h'
	})
	.boolean(['eng', 'local', 'profile', 'help', 'remotify', 'help', 'only-remotify'])
	.default({
		channel: 'central',
		date: 'latest'
	})
	.describe({
		device: 'Device (flame, helix, hamachi, …)',
		channel: 'Channel (central, aurora, 1.4, …)',
		date: 'Build date (for regression window testing)',
		eng: 'Engineering build (for marionette testing)',
		dir: 'Directory to keep downloads (defaults to temp)',
		local: 'Use local files, skipping FTP (requires --dir)',
		profile: 'Keep profile (no promises)',
		remotify: 'Set device into development mode',
		'only-remotify': 'Skip flashing, only set development mode',
		help: 'Show this help'
	})
	.strict();
var argv = yarg.argv;
argv.device = (argv._[0] || argv.device || '').toLowerCase();
if (argv.help || (!argv.device && !argv['only-remotify'])) {
	console.log(yarg.help());
	if (!argv.device) {
		console.log('Please provide a [device] argument!');
	}
	process.exit();
}
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
var env = process.env;

// Constants
var FTP_HOST = 'ftp.mozilla.org';
var FTP_URL = 'http://' + FTP_HOST;
var FTP_PATH = '/pub/mozilla.org/b2g/nightly/';
var SCRIPT_PATH = path.join(__dirname, 'scripts');
var FLASH_SCRIPT_PATH = path.join(SCRIPT_PATH, 'shallow_flash.sh');
var BACKUP_SCRIPT_PATH = path.join(SCRIPT_PATH, 'backup_restore_profile.sh');
var TIMEOUT = 60 * 60 * 1000; // 1min
var ADB = process.env.ADB || 'adb';

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
var profileDir = path.join(dir, 'flash-b2g-profile');
// At least on linux bash, getopt defines that optional arguments need to be
// like "--opt=arg".  Only required arguments can do "--opt arg".
var argsSpace = (process.platform == 'linux') ? '=' : ' ';

if (argv['only-remotify']) {
	setDeveloperPrefs()
		.then(function() {
			console.log('✓ Done (only-remotify)');
		}, function(err) {
			console.error(err);
		})
		.then(function() {
			process.exit();
		});
	return;
}

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

// Strip the regex bits that are filesystem wildcards or otherwise weird out.
var safeNameBits = nameBits.join('-').replace(/[^\w_-]+/gi, '_');
var localGaiaPath = path.join(dir, 'gaia-' + safeNameBits + '.zip');
var localB2gPath = path.join(dir, 'b2g-' + safeNameBits + '.tar.gz');

function setDeveloperPrefs() {
	var prefs = {
		'devtools.debugger.forbid-certified-apps': false,
		'devtools.debugger.prompt-connection': false,
		'b2g.adb.timeout': 0,
		// Reduce noise in logs: http://kb.mozillazine.org/Layout.css.report_errors
		'layout.css.report_errors': false
	};
	var settings = {
		'developer.menu.enabled': true,
		'ftu.manifestURL': null,
		'debugger.remote-mode': 'adb-devtools',
		'devtools.debugger.remote-enabled': true,
		'screen.timeout': 600, // 10min
		'lockscreen.locked': false,
		'lockscreen.enabled': false
	};

	// Wait for device
	console.log('Waiting for device (is remote debugging on?) …'.yellow);
	return promisify(childProcess.exec, ADB + ' wait-for-device')

	// Stop B2G
	.then(function stopB2g() {
		console.log('Stopping system');
		return promisify(childProcess.exec, [
			ADB + ' remount', // really needed?
			ADB + ' shell stop b2g'
		].join(' && '));
	})

	// Fetch settings.json
	.then(function pullSettings() {
		return promisify(childProcess.exec, ADB + ' shell cat /system/b2g/defaults/settings.json', {
			maxBuffer: 524288
		});
	})

	.then(function pushSettings(stdout) {
		var content = JSON.parse(stdout);
		for (var key in settings) {
			content[key] = settings[key];
		}
		var settingsPath = path.join(tempDir, 'settings.json');
		fs.writeFileSync(settingsPath, JSON.stringify(content));
		console.log('Appending to settings.json:\n', settings);
		return promisify(childProcess.exec, [
			ADB + ' shell mount -o rw,remount /system',
			ADB + ' push ' + settingsPath + ' /system/b2g/defaults/settings.json',
			ADB + ' shell mount -o ro,remount /system'
		].join(' && '));
	})

	// Push preferences
	.then(function pushPreferences() {
		var cmds = ['cd /data/b2g/mozilla/*.default/']
			.concat(Object.keys(prefs).map(function(key) {
				return 'echo \'user_pref(' + JSON.stringify(key) + ', ' +
					JSON.stringify(prefs[key]) + ');\' >> prefs.js';
			})).join(' && ');
		console.log('Appending to prefs.js:\n', prefs);
		return promisify(childProcess.exec, ADB + ' shell "' +
			cmds.replace(/"/g, '\\"') + '"', {
				maxBuffer: 524288
			});
	})

	// Restart B2G
	.then(function restartB2g() {
		console.log('Restarting system');
		return promisify(childProcess.exec, ADB + ' shell sync && ' +
			ADB + ' shell start b2g')
	});
};

function download() {
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

	console.log('Connecting to %s', FTP_HOST.underline.white);
	// List files in main dir
	return promisify([ftp, 'ls'], ftpPath)

	// Find target dir
	.then(function findTargetFolder(files) {
		files = files.filter(function(file) {
			return pathMatch.test(file.name);
		});
		if (!files.length) {
			throw new Error('Could not find a directory matching ' + pathMatch + '.\nVerify your --device, --channel or --date argument and that a matching directory exists on the Mozilla FTP:\n' + FTP_URL + ftpPath);
		}
		return files[0].name;
	})

	// List files in target dir
	.then(function listTargetFiles(path) {
		ftpPath += path + '/';
		console.log('Listing files from %s', (FTP_HOST.underline + ftpPath).white);
		return promisify([ftp, 'ls'], ftpPath);
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
		return Promise.all([
			new Promise(function(resolve, reject) {
				http.get(FTP_URL + ftpPath + 'gaia.zip', resolve)
					.on('error', reject);
			}), new Promise(function(resolve, reject) {
				http.get(FTP_URL + ftpPath + file, resolve)
					.on('error', reject);
			})
		]);
	})

	// Stream socket data into files
	.then(function downloadStreams(streams) {
		console.log('Downloading from %s', (FTP_URL + ftpPath).underline.white);
		var fileFlags = {
			flags: 'w'
		};
		return Promise.all([
			new Promise(function(resolve, reject) {
				var file = fs.createWriteStream(localGaiaPath, fileFlags);
				file.on('finish', function() {
					file.close(resolve);
				});
				streams[0].pipe(file);
			}),
			new Promise(function(resolve, reject) {
				var file = fs.createWriteStream(localB2gPath, {
					flags: 'w'
				});
				file.on('finish', function() {
					file.close(resolve);
				});
				streams[1].pipe(file);
			})
		]);
	});
}

// Start process
Promise.resolve().then(function() {
	if (argv.local) {
		console.log('Skipping FTP');
		return;
	}
	return download();
})

.then(function() {
	if (!fs.existsSync(localGaiaPath) || !fs.existsSync(localB2gPath)) {
		throw new Error('Local files not found:\n' + localGaiaPath + '\n' + localB2gPath);
	}
})

.then(function() {
	console.log('Waiting for device (is remote debugging on?)  …'.yellow);
	return promisify(childProcess.exec, ADB + ' wait-for-device')
})

.then(function() {
	if (argv.profile) {
		console.log('Exec ' + 'backup_restore_profile.sh'.grey.italic + ' to back up');
		return promisify(childProcess.exec, [
			BACKUP_SCRIPT_PATH,
			'-p' + argsSpace + profileDir,
			'-b'
		].join(' '), {
			cwd: SCRIPT_PATH
		})

		.then(function(stdout, stderr) {
			if (stdout) {
				console.log('[backup_restore_profile] '.grey + String(stdout).trim());
			}
			if (stderr) {
				console.log('[backup_restore_profile] '.red + String(stderr).trim());
			}
		});
	}
})

// Execute flash script
.then(function executeFlash(stdout) {
	var args = [
		'--gaia' + argsSpace + localGaiaPath,
		'--gecko' + argsSpace + localB2gPath,
		'-y'
	].join(' ');
	console.log('Exec ' + ('shallow_flash.sh ' + args).grey.italic);
	console.log('This can take a bit, finishing with the device restarting …'.yellow);
	return promisify(childProcess.exec, FLASH_SCRIPT_PATH + ' ' + args, {
		cwd: SCRIPT_PATH
	})

	.then(function(stdout, stderr) {
		if (stdout) {
			console.log('[shallow_flash] '.grey + String(stdout).trim());
		}
		if (stderr) {
			console.log('[shallow_flash] '.red + String(stderr).trim());
		}
	});
})

.then(function() {
	if (argv.profile) {
		console.log('Exec ' + 'backup_restore_profile.sh'.grey.italic + ' to restore');
		return promisify(childProcess.exec, [
			BACKUP_SCRIPT_PATH,
			'-p' + argsSpace + profileDir,
			'--no-reboot',
			'-r'
		].join(' '), {
			cwd: SCRIPT_PATH
		})

		.then(function(stdout, stderr) {
			if (stdout) {
				console.log('[backup_restore_profile] '.grey + String(stdout).trim());
			}
			if (stderr) {
				console.log('[backup_restore_profile] '.red + String(stderr).trim());
			}
		});
	}
})

// Set developer prefs
.then(function() {
	if (argv.remotify) {
		return setDeveloperPrefs();
	}
})

// Listo!
.then(function() {
	console.log('✓ %s flashed to %s!'.bold.green, argv.device, argv.channel);
	process.exit();
}, function(err) {
	console.error(String(err).bold.red, err);
	process.exit(1);
});