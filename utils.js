var fs = require('fs');
var os = require('os');
var path = require('path');

function isWindowsDrivePath(entryName) {
  return /^[a-zA-Z]:/.test(entryName);
}

function isZipSymlink(entry) {
  var attr = entry && entry.header && typeof entry.header.attr === 'number' ? entry.header.attr : 0;
  var unixFileType = (attr >>> 16) & 0170000;

  return unixFileType === 0120000;
}

function validateZipEntryPath(entry, extractRoot) {
  var entryName = entry && entry.entryName;

  if (typeof entryName !== 'string' || !entryName || entryName.indexOf('\0') !== -1) {
    throw new Error('Invalid zip entry path');
  }

  if (entryName.indexOf('\\') !== -1 ||
    path.posix.isAbsolute(entryName) ||
    path.win32.isAbsolute(entryName) ||
    isWindowsDrivePath(entryName)) {
    throw new Error('Unsafe zip entry path');
  }

  var normalizedName = path.posix.normalize(entryName);
  if (normalizedName === '.' ||
    normalizedName === '..' ||
    normalizedName.indexOf('../') === 0) {
    throw new Error('Unsafe zip entry path');
  }

  var destination = path.resolve(extractRoot, normalizedName);
  var relativeDestination = path.relative(extractRoot, destination);
  if (!relativeDestination ||
    relativeDestination === '..' ||
    relativeDestination.indexOf('..' + path.sep) === 0 ||
    path.isAbsolute(relativeDestination)) {
    throw new Error('Unsafe zip entry path');
  }

  if (isZipSymlink(entry)) {
    throw new Error('Unsafe zip symlink entry');
  }

  return destination;
}

function safeExtractZip(zip) {
  var extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'goof-import-'));

  try {
    var entries = zip.getEntries();

    entries.forEach(function (entry) {
      var destination = validateZipEntryPath(entry, extractRoot);

      if (entry.isDirectory) {
        fs.mkdirSync(destination, { recursive: true });
        return;
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, entry.getData(), { flag: 'wx' });
    });

    return extractRoot;
  } catch (err) {
    if (fs.rmSync) {
      fs.rmSync(extractRoot, { recursive: true, force: true });
    }
    throw err;
  }
}

module.exports = {

  ran_no : function ( min, max ){
    return Math.floor( Math.random() * ( max - min + 1 )) + min;
  },

  uid : function ( len ){
    var str     = '';
    var src     = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var src_len = src.length;
    var i       = len;

    for( ; i-- ; ){
      str += src.charAt( this.ran_no( 0, src_len - 1 ));
    }

    return str;
  },

  forbidden : function ( res ){
    var body       = 'Forbidden';
    res.statusCode = 403;

    res.setHeader( 'Content-Type', 'text/plain' );
    res.setHeader( 'Content-Length', body.length );
    res.end( body );
  },

  safeExtractZip : safeExtractZip,
  validateZipEntryPath : validateZipEntryPath
};
