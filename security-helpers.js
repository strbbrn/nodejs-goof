var fs = require('fs');
var os = require('os');
var path = require('path');

function sanitizeRedirectPage(redirectPage) {
  if (typeof redirectPage !== 'string') {
    return '';
  }

  if (redirectPage.length === 0) {
    return '';
  }

  if (redirectPage.charAt(0) !== '/' || redirectPage.indexOf('//') === 0) {
    return '';
  }

  if (/[\x00-\x1F\x7F]/.test(redirectPage) || redirectPage.indexOf('\\') !== -1) {
    return '';
  }

  return redirectPage;
}

function normalizeAboutDevice(device) {
  if (device === 'Desktop' || device === 'Mobile') {
    return device;
  }

  return 'Mobile';
}

function buildAccountProfile(profile) {
  profile = profile || {};

  var safeProfile = Object.create(null);
  safeProfile.firstname = profile.firstname;
  safeProfile.lastname = profile.lastname;
  safeProfile.country = profile.country;
  safeProfile.phone = profile.phone;
  safeProfile.email = profile.email;

  return safeProfile;
}

function getZipEntryMode(entry) {
  var attr;

  if (entry && entry.header && typeof entry.header.attr === 'number') {
    attr = entry.header.attr;
  } else if (entry && typeof entry.attr === 'number') {
    attr = entry.attr;
  }

  if (typeof attr !== 'number') {
    return 0;
  }

  return (attr >>> 16) & 0xFFFF;
}

function isSafeZipEntryName(entryName) {
  if (typeof entryName !== 'string' || entryName.length === 0) {
    return false;
  }

  if (entryName.indexOf('\0') !== -1 || entryName.indexOf('\\') !== -1) {
    return false;
  }

  if (path.posix.isAbsolute(entryName) || /^[A-Za-z]:/.test(entryName)) {
    return false;
  }

  var parts = entryName.split('/');
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === '..' || /^[A-Za-z]:/.test(parts[i])) {
      return false;
    }
  }

  return true;
}

function isSupportedZipEntryType(entry) {
  var mode = getZipEntryMode(entry);
  var fileType = mode & 0o170000;

  if (fileType === 0) {
    return true;
  }

  return fileType === 0o040000 || fileType === 0o100000;
}

function removeDirectory(root) {
  if (fs.rmSync) {
    fs.rmSync(root, { recursive: true, force: true });
    return;
  }

  fs.rmdirSync(root, { recursive: true });
}

function validateZipEntries(entries) {
  entries.forEach(function (entry) {
    if (!isSafeZipEntryName(entry.entryName) || !isSupportedZipEntryType(entry)) {
      throw new Error('Invalid zip entry');
    }
  });
}

function readBackupFromZip(zip) {
  var entries = zip.getEntries();
  validateZipEntries(entries);

  var backupEntry = null;
  entries.forEach(function (entry) {
    if (entry.entryName === 'backup.txt' && !entry.isDirectory) {
      backupEntry = entry;
    }
  });

  if (!backupEntry) {
    return 'No backup.txt file found';
  }

  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'goof-import-'));
  try {
    var backupPath = path.resolve(root, 'backup.txt');
    if (backupPath.indexOf(root + path.sep) !== 0) {
      throw new Error('Invalid zip entry');
    }

    fs.writeFileSync(backupPath, backupEntry.getData());
    return fs.readFileSync(backupPath, 'ascii');
  } finally {
    removeDirectory(root);
  }
}

module.exports = {
  sanitizeRedirectPage: sanitizeRedirectPage,
  normalizeAboutDevice: normalizeAboutDevice,
  buildAccountProfile: buildAccountProfile,
  isSafeZipEntryName: isSafeZipEntryName,
  isSupportedZipEntryType: isSupportedZipEntryType,
  validateZipEntries: validateZipEntries,
  readBackupFromZip: readBackupFromZip
};
