const assert = require('assert');
const test = require('node:test');
const Module = require('module');

function installRouteStubs(execCalls) {
  const originalLoad = Module._load;

  function Todo(doc) {
    Object.assign(this, doc);
    if (typeof this.content === 'string') {
      this.content = Buffer.from(this.content);
    }
  }
  Todo.find = function () {
    return { sort: function () { return { exec: function (cb) { cb(null, []); } }; } };
  };
  Todo.findById = function (id, cb) {
    cb(null, { remove: function (done) { done(null, this); } });
  };
  Todo.prototype.save = function (cb) {
    cb(null, this, 1);
  };

  function User() {}
  User.find = function () {
    return { exec: function (cb) { cb(null, []); } };
  };

  Module._load = function (request, parent, isMain) {
    if (request === 'mongoose') {
      return { model: function (name) { return name === 'Todo' ? Todo : User; } };
    }
    if (request === 'humanize-ms') {
      return function () { return 300000; };
    }
    if (request === 'ms') {
      return function () { return '5m'; };
    }
    if (request === 'stream-buffers') {
      return {};
    }
    if (request === 'moment') {
      const moment = function () { return { format: function () { return ''; } }; };
      moment.locale = function () {};
      return moment;
    }
    if (request === 'validator') {
      return {
        isEmail: function () { return true; },
        isMobilePhone: function () { return true; },
        isAscii: function () { return true; },
        rtrim: function (value) { return value; },
      };
    }
    if (request === 'file-type') {
      return function () { return null; };
    }
    if (request === 'adm-zip') {
      return function () { this.extractAllTo = function () {}; };
    }
    if (request === 'lodash') {
      return { merge: Object.assign };
    }
    if (request === 'child_process') {
      const childProcess = originalLoad.apply(this, arguments);
      return Object.assign({}, childProcess, {
        exec: function (cmd, cb) {
          execCalls.push(cmd);
          if (cb) cb(null, '', '');
        },
      });
    }

    return originalLoad.apply(this, arguments);
  };

  return function restore() {
    Module._load = originalLoad;
  };
}

function createResponse() {
  return {
    headers: {},
    setHeader: function (key, value) {
      this.headers[key] = value;
    },
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    send: function (body) {
      this.body = body;
      return this;
    },
  };
}

function loadRoutesWithStubs(execCalls) {
  const restore = installRouteStubs(execCalls);
  const routePath = require.resolve('../routes');
  delete require.cache[routePath];
  const routes = require('../routes');

  return { routes: routes, restore: restore };
}

test('create saves markdown image todos without invoking a shell', function () {
  const execCalls = [];
  const loaded = loadRoutesWithStubs(execCalls);
  const res = createResponse();

  try {
    const content = '![alt text](https://example.com/a.png;touch ./public/p0wned "Image todo item")';

    loaded.routes.create({ body: { content: content } }, res, function (err) {
      throw err;
    });

    assert.deepStrictEqual(execCalls, []);
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.Location, '/');
    assert.strictEqual(Buffer.from(res.body, 'base64').toString(), content);
  } finally {
    loaded.restore();
  }
});

test('create keeps existing reminder parsing for non-image todos', function () {
  const execCalls = [];
  const loaded = loadRoutesWithStubs(execCalls);
  const res = createResponse();

  try {
    loaded.routes.create({ body: { content: 'call mom in 5 minutes' } }, res, function (err) {
      throw err;
    });

    assert.deepStrictEqual(execCalls, []);
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.Location, '/');
    assert.strictEqual(Buffer.from(res.body, 'base64').toString(), 'call mom [5m]');
  } finally {
    loaded.restore();
  }
});
