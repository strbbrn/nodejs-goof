var assert = require('assert');
var fs = require('fs');
var Module = require('module');
var securityHelpers = require('../security-helpers');

function makeEntry(entryName, data, attr, isDirectory) {
  return {
    entryName: entryName,
    isDirectory: !!isDirectory,
    header: typeof attr === 'number' ? { attr: attr } : {},
    getData: function () {
      return Buffer.from(data || '');
    }
  };
}

function loadRoutes(dependencies) {
  var originalLoad = Module._load;
  var todoSaves = [];

  function Todo(doc) {
    this.content = doc.content;
    this.updated_at = doc.updated_at;
    this.save = function (callback) {
      todoSaves.push(doc);
      callback(null, this, 1);
    };
  }

  var validator = {
    isEmail: function () { return true; },
    isMobilePhone: function () { return true; },
    isAscii: function () { return true; },
    rtrim: function (value) { return String(value).replace(/\s+$/, ''); }
  };

  var stubs = {
    mongoose: {
      model: function (name) {
        if (name === 'Todo') {
          return Todo;
        }

        return {
          find: function (query, callback) {
            callback(null, dependencies.users || []);
          }
        };
      }
    },
    'humanize-ms': function () { return undefined; },
    ms: function (value) { return value; },
    'stream-buffers': {},
    readline: {},
    moment: function (value) {
      return {
        format: function () {
          return value;
        }
      };
    },
    validator: validator,
    'file-type': dependencies.fileType || function () { return null; },
    'adm-zip': dependencies.AdmZip || function () { return { getEntries: function () { return []; } }; },
    lodash: { merge: function () {} },
    child_process: {
      exec: function () {
        throw new Error('exec should not be called');
      }
    }
  };

  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }

    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../routes/index.js')];
  var routes = require('../routes/index.js');
  Module._load = originalLoad;

  return {
    routes: routes,
    todoSaves: todoSaves
  };
}

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    rendered: null,
    redirected: null,
    body: null,
    setHeader: function (key, value) {
      this.headers[key] = value;
    },
    status: function (statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send: function (body) {
      this.body = body;
      return this;
    },
    redirect: function (target) {
      this.redirected = target;
      return this;
    },
    render: function (view, model) {
      this.rendered = { view: view, model: model };
      return this;
    }
  };
}

assert.strictEqual(securityHelpers.sanitizeRedirectPage('/admin'), '/admin');
assert.strictEqual(securityHelpers.sanitizeRedirectPage('/admin?next=https://example.com'), '/admin?next=https://example.com');
assert.strictEqual(securityHelpers.sanitizeRedirectPage('https://example.com'), '');
assert.strictEqual(securityHelpers.sanitizeRedirectPage('//example.com'), '');
assert.strictEqual(securityHelpers.sanitizeRedirectPage('/\\example.com'), '');
assert.strictEqual(securityHelpers.sanitizeRedirectPage('/admin\nLocation: https://example.com'), '');

assert.strictEqual(securityHelpers.normalizeAboutDevice('Desktop'), 'Desktop');
assert.strictEqual(securityHelpers.normalizeAboutDevice('Mobile'), 'Mobile');
assert.strictEqual(securityHelpers.normalizeAboutDevice("Desktop'-console.log(1)-'"), 'Mobile');
assert.strictEqual(securityHelpers.normalizeAboutDevice(['Desktop']), 'Mobile');

assert.deepStrictEqual(
  Object.assign({}, securityHelpers.buildAccountProfile({
    firstname: 'A',
    lastname: 'B',
    country: 'IL',
    phone: '+972551234123',
    email: 'a@example.com',
    layout: './../package.json'
  })),
  {
    firstname: 'A',
    lastname: 'B',
    country: 'IL',
    phone: '+972551234123',
    email: 'a@example.com'
  }
);
assert.strictEqual(Object.getPrototypeOf(securityHelpers.buildAccountProfile({})), null);

assert.strictEqual(securityHelpers.isSafeZipEntryName('backup.txt'), true);
assert.strictEqual(securityHelpers.isSafeZipEntryName('../backup.txt'), false);
assert.strictEqual(securityHelpers.isSafeZipEntryName('/tmp/backup.txt'), false);
assert.strictEqual(securityHelpers.isSafeZipEntryName('C:/backup.txt'), false);
assert.strictEqual(securityHelpers.isSafeZipEntryName('dir/C:/backup.txt'), false);
assert.strictEqual(securityHelpers.isSafeZipEntryName('dir\\backup.txt'), false);
assert.strictEqual(securityHelpers.isSafeZipEntryName('backup.txt\0evil'), false);
assert.throws(function () {
  securityHelpers.validateZipEntries([makeEntry('link', '', 0o120000 << 16)]);
}, /Invalid zip entry/);
assert.strictEqual(
  securityHelpers.readBackupFromZip({
    getEntries: function () {
      return [
        makeEntry('notes.txt', 'ignored'),
        makeEntry('backup.txt', 'todo,2026-09-25,en,YYYY-MM-DD')
      ];
    }
  }),
  'todo,2026-09-25,en,YYYY-MM-DD'
);

var loaded = loadRoutes({});
var createRes = makeResponse();
loaded.routes.create({
  body: {
    content: '![alt text](http://example.invalid/a.png;touch /tmp/goof-identify-marker "Image todo item")'
  }
}, createRes, function (err) { throw err; });
assert.strictEqual(createRes.statusCode, 302);
assert.strictEqual(loaded.todoSaves.length, 1);

loaded = loadRoutes({ users: [{ username: 'admin@example.com' }] });
var loginRes = makeResponse();
loaded.routes.loginHandler({
  body: {
    username: 'admin@example.com',
    password: 'password',
    redirectPage: 'https://example.com'
  },
  session: {}
}, loginRes, function (err) { throw err; });
assert.strictEqual(loginRes.redirected, '/admin');

loginRes = makeResponse();
loaded.routes.loginHandler({
  body: {
    username: 'admin@example.com',
    password: 'password',
    redirectPage: '/account_details'
  },
  session: {}
}, loginRes, function (err) { throw err; });
assert.strictEqual(loginRes.redirected, '/account_details');

var getLoginRes = makeResponse();
loaded.routes.login({
  query: {
    redirectPage: '"><script>alert(1)</script>'
  }
}, getLoginRes);
assert.strictEqual(getLoginRes.rendered.model.redirectPage, '');
assert(fs.readFileSync('views/admin.ejs', 'utf8').indexOf('<%- redirectPage %>') === -1);

var accountRes = makeResponse();
loaded.routes.save_account_details({
  body: {
    firstname: 'Jane   ',
    lastname: 'Doe   ',
    country: 'IL',
    phone: '+972551234123',
    email: 'jane@example.com',
    layout: './../package.json',
    helpers: {}
  }
}, accountRes);
assert.strictEqual(accountRes.rendered.view, 'account.hbs');
assert.deepStrictEqual(Object.keys(accountRes.rendered.model).sort(), ['country', 'email', 'firstname', 'lastname', 'phone']);
assert.strictEqual(accountRes.rendered.model.firstname, 'Jane');

var aboutRes = makeResponse();
loaded.routes.about_new({ query: { device: "Desktop'-console.log(1)-'" } }, aboutRes);
assert.strictEqual(aboutRes.rendered.model.device, 'Mobile');
assert.strictEqual(aboutRes.rendered.model.isDesktop, false);

aboutRes = makeResponse();
loaded.routes.about_new({ query: { device: 'Desktop' } }, aboutRes);
assert.strictEqual(aboutRes.rendered.model.device, 'Desktop');
assert.strictEqual(aboutRes.rendered.model.isDesktop, true);

loaded = loadRoutes({
  fileType: function () {
    return { ext: 'zip', mime: 'application/zip' };
  },
  AdmZip: function () {
    return {
      getEntries: function () {
        return [
          makeEntry('backup.txt', 'todo,2026-09-25,en,YYYY-MM-DD'),
          makeEntry('../outside.txt', 'bad')
        ];
      }
    };
  }
});
var importRes = makeResponse();
loaded.routes.import({
  files: {
    importFile: {
      data: Buffer.from('zip')
    }
  }
}, importRes);
assert.strictEqual(importRes.statusCode, 400);
assert.strictEqual(importRes.body, 'Invalid zip file');

console.log('security regression tests passed');
