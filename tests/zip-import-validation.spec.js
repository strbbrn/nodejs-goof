const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const AdmZip = require('adm-zip');
const utils = require('../utils');

function loadImportRoute() {
  const Module = require('module');
  const originalLoad = Module._load;
  const savedTodos = [];

  function FakeTodo(todo) {
    this.content = todo.content;
    this.updated_at = todo.updated_at;
  }

  FakeTodo.prototype.save = function (callback) {
    savedTodos.push(this.content);
    callback(null, this);
  };

  const fakeMongoose = {
    model: function (name) {
      if (name === 'Todo') {
        return FakeTodo;
      }

      return {};
    }
  };

  Module._load = function (request, parent, isMain) {
    if (request === 'mongoose') {
      return fakeMongoose;
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[require.resolve('../routes/index')];
    return {
      importRoute: require('../routes/index').import,
      savedTodos: savedTodos
    };
  } finally {
    Module._load = originalLoad;
  }
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    redirectTo: null,
    status: function (statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send: function (body) {
      this.body = body;
      return this;
    },
    redirect: function (location) {
      this.redirectTo = location;
    }
  };
}

function cleanup(extractRoot) {
  if (extractRoot) {
    fs.rmSync(extractRoot, { recursive: true, force: true });
  }
}

test('safeExtractZip extracts a legitimate backup file into a private temp directory', function () {
  var zip = new AdmZip(path.join(__dirname, '..', 'exploits', 'zip-slip', 'my_backup.zip'));
  var extractRoot;

  try {
    extractRoot = utils.safeExtractZip(zip);
    var backupPath = path.join(extractRoot, 'backup.txt');

    assert.strictEqual(fs.readFileSync(backupPath, 'ascii'), fs.readFileSync(path.join(__dirname, '..', 'exploits', 'zip-slip', 'backup.txt'), 'ascii'));
    assert.strictEqual(path.dirname(backupPath), extractRoot);
  } finally {
    cleanup(extractRoot);
  }
});

test('safeExtractZip rejects traversal paths before extraction', function () {
  var zip = new AdmZip(path.join(__dirname, '..', 'exploits', 'zip-slip', 'malicious_backup.zip'));

  assert.throws(function () {
    utils.safeExtractZip(zip);
  }, /Unsafe zip entry path/);
});

test('safeExtractZip rejects absolute paths, drive prefixes, and symlink entries', function () {
  function entry(entryName, attr) {
    return {
      entryName: entryName,
      isDirectory: false,
      header: { attr: attr || 0 },
      getData: function () {
        return Buffer.from('content');
      }
    };
  }

  [
    '/tmp/escape.txt',
    'C:/temp/escape.txt',
    'C:temp/escape.txt',
    '..\\escape.txt'
  ].forEach(function (entryName) {
    assert.throws(function () {
      utils.safeExtractZip({ getEntries: function () { return [entry(entryName)]; } });
    }, /Unsafe zip entry path/);
  });

  assert.throws(function () {
    utils.safeExtractZip({ getEntries: function () { return [entry('backup.txt', 0120000 << 16)]; } });
  }, /Unsafe zip symlink entry/);
});

test('import route rejects a malicious zip and leaves the overwrite target unchanged', function () {
  var routes = loadImportRoute();
  var res = createResponse();
  var aboutPath = path.join(__dirname, '..', 'public', 'about.html');
  var before = fs.readFileSync(aboutPath, 'utf8');

  routes.importRoute({
    files: {
      importFile: {
        data: fs.readFileSync(path.join(__dirname, '..', 'exploits', 'zip-slip', 'malicious_backup.zip'))
      }
    }
  }, res, function (err) {
    throw err;
  });

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body, 'Invalid zip archive.');
  assert.strictEqual(res.redirectTo, null);
  assert.deepStrictEqual(routes.savedTodos, []);
  assert.strictEqual(fs.readFileSync(aboutPath, 'utf8'), before);
});

test('import route accepts a legitimate zip backup', function () {
  var routes = loadImportRoute();
  var res = createResponse();

  routes.importRoute({
    files: {
      importFile: {
        data: fs.readFileSync(path.join(__dirname, '..', 'exploits', 'zip-slip', 'my_backup.zip'))
      }
    }
  }, res, function (err) {
    throw err;
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.redirectTo, '/');
  assert.ok(routes.savedTodos.indexOf('Buy some food') !== -1);
});

test('import route still accepts a plain text import file', function () {
  var routes = loadImportRoute();
  var res = createResponse();

  routes.importRoute({
    files: {
      importFile: {
        data: fs.readFileSync(path.join(__dirname, '..', 'exploits', 'moment-todo-good.csv'))
      }
    }
  }, res, function (err) {
    throw err;
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.redirectTo, '/');
  assert.ok(routes.savedTodos.indexOf('Bake a cake') !== -1);
});
