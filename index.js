'use strict';

var http = require('http');
var path = require('path');
var fs = require('fs');
var spawn = require('child_process').spawn;
var JSFtp = require('jsftp');
var minimist = require('minimist');
var q = require('q');
var temp = require('temp');
var mkdirp = require('mkdirp');
var moment = require('moment');

// Command-line arguments
var argv = minimist(process.argv.slice(2), {
	boolean: ['eng'],
	string: ['flame', 'version', 'folder', 'date'],
	defaults: {
		eng: false,
		local: false
	}
});
argv.device = (argv._[0] || argv.device || 'flame').toLowerCase();
argv.version = argv._[1] || argv.version || 'central';
if (argv.date && argv.date != 'latest') {
	argv.date = moment(argv.date);
	if (!argv.date.isValid()) {
		throw new Error('Invalid `date` argument');
	}
}

// Configuration
var FTP_HOST = 'ftp.mozilla.org';
var FTP_URL = 'http://' + FTP_HOST;
var FTP_PATH = '/pub/mozilla.org/b2g/nightly/';
var SCRIPT_PATH = path.join(__dirname, 'scripts');
var FLASH_SCRIPT_PATH = path.join(SCRIPT_PATH, 'shallow_flash.sh');
var TIMEOUT = 60 * 60 * 1000; // 1min

// Set up folders
temp.track();
var folder = argv.folder;
if (!folder) {
	folder = temp.mkdirSync('flash-b2g');
	console.log('Created temporary: %s', folder)
} else {
	folder = path.resolve(folder)
	if (!fs.existsSync(folder)) {
		mkdirp.sync(folder);
		console.log('Created: %s', folder)
	}
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
var versionBit = argv.version;
if (/\d/.test(versionBit)) {
	versionBit = 'v' + versionBit.replace(/\./, '_');
}
var pathBits = [dateBit, '.*', versionBit, argv.device];
var nameBits = [argv.device, versionBit];
if (argv.eng) {
	pathBits.push('eng');
	nameBits.push('eng');
}
nameBits.push(dateBit);
var pathMatch = new RegExp(pathBits.join('-') + '$', 'i');
var ftpPath = FTP_PATH;

var b2gFilePath = null;
var b2gFile = null;
var gaiaFile = null;

var localGaiaPath = path.join(folder, 'gaia-' + nameBits.join('-') + '.zip');
var localB2gPath = path.join(folder, 'b2g-' + nameBits.join('-') + '.tar.gz');



q.fcall(function() {
	if (argv.local) {
		if (!fs.existsSync(localGaiaPath) || !fs.existsSync(localB2gPath)) {
			throw new Error('Local files not found');
		}
		console.log('Gaia: %s\nGecko: %s', localGaiaPath, localB2gPath);
		return;
	}
	console.log('Connecting to %s', FTP_HOST);
	// List files in main folder
	return q.ninvoke(ftp, 'ls', ftpPath)
		// Find target folder
		.then(function findTargetFolder(files) {
			files = files.filter(function(file) {
				return pathMatch.test(file.name);
			});
			if (!files.length) {
				throw new Error('Could not find folder matching ' + pathMatch);
			}
			return files[0].name;
		})

	// List files in target folder
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
			throw new Error('Could not find b2g package in ');
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
		console.log('Downloading %s', FTP_URL + ftpPath);
		var deferGaia = q.defer();
		gaiaFile = fs.createWriteStream(localGaiaPath);
		gaiaFile.on('finish', function() {
			gaiaFile.close(deferGaia.resolve);
		});
		gaiaStream.pipe(gaiaFile);

		var deferB2g = q.defer();
		b2gFile = fs.createWriteStream(localB2gPath);
		b2gFile.on('finish', function() {
			b2gFile.close(deferB2g.resolve);
		});
		b2gStream.pipe(b2gFile);
		return [deferB2g.promise, deferGaia.promise];
	});
})

// Execute flash script
.then(function executeFlash() {
	var defer = q.defer();
	var args = ['-y', '--gaia', localGaiaPath, '--gecko', localB2gPath];
	var cmd = [FLASH_SCRIPT_PATH];
	var flash = spawn('sh', cmd.concat(args));
	flash.stdout.on('data', function(data) {
		console.log('shallow_flash.sh> ' + String(data).trim());
	});
	flash.stderr.on('data', function(data) {
		console.log('shallow_flash.sh> ' + String(data).trim());
	});
	flash.on('close', defer.resolve);
	return defer.promise;
})

// Listo!
.done(function() {
	console.log('shallow_flash.sh exited with %d', code);
}, function(err) {
	throw err;
});