var test = require('tap').test;
var fs = require('fs');
var http = require('http');
var path = require('path');
var express = require('express');
var cons = require('consolidate');
var mongoose = require('mongoose');
var dust = require('dustjs-linkedin');
var dustHelpers = require('dustjs-helpers');

try {
  mongoose.model('Todo');
} catch (err) {
  mongoose.model('Todo', new mongoose.Schema({}));
}

try {
  mongoose.model('User');
} catch (err) {
  mongoose.model('User', new mongoose.Schema({}));
}

var routes = require('../routes');

function createTestApp() {
  var app = express();

  app.engine('dust', cons.dust);
  cons.dust.helpers = dustHelpers;
  app.set('views', path.join(__dirname, '..', 'views'));
  app.get('/about_new', routes.about_new);

  return app;
}

function requestPath(app, requestPath, callback) {
  var server = app.listen(0, '127.0.0.1', function () {
    var options = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath
    };

    http.get(options, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        body += chunk;
      });
      res.on('end', function () {
        server.close(function () {
          callback(null, {
            statusCode: res.statusCode,
            body: body
          });
        });
      });
    }).on('error', function (err) {
      server.close(function () {
        callback(err);
      });
    });
  });
}

function renderAboutNew(query) {
  var result = {};
  var res = {
    statusCode: 200,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    send: function (body) {
      result.statusCode = this.statusCode;
      result.body = body;
      return result;
    },
    render: function (view, model) {
      result.statusCode = this.statusCode;
      result.view = view;
      result.model = model;
      return result;
    }
  };

  routes.about_new({ query: query }, res, function (err) {
    throw err;
  });

  return result;
}

test('about_new passes a server-owned desktop boolean to the template', function (t) {
  var result = renderAboutNew({ device: 'Desktop' });

  t.equal(result.statusCode, 200);
  t.equal(result.view, 'about_new.dust');
  t.equal(result.model.device, 'Desktop');
  t.equal(result.model.isDesktop, true);
  t.end();
});

test('about_new rejects attacker-controlled device expressions', function (t) {
  var result = renderAboutNew({
    device: ["Desktop'-console.log('DUST_EXECUTED')-'"]
  });

  t.equal(result.statusCode, 400);
  t.equal(result.body, 'Invalid device');
  t.notOk(result.view, 'does not render the Dust template');
  t.end();
});

test('GET /about_new keeps Desktop rendering behavior', function (t) {
  requestPath(createTestApp(), '/about_new?device=Desktop', function (err, res) {
    t.error(err);
    t.equal(res.statusCode, 200);
    t.match(res.body, 'font-size: medium');
    t.match(res.body, 'Device string (debug): Desktop');
    t.end();
  });
});

test('GET /about_new keeps Mobile rendering behavior', function (t) {
  requestPath(createTestApp(), '/about_new?device=Mobile', function (err, res) {
    t.error(err);
    t.equal(res.statusCode, 200);
    t.match(res.body, 'font-size: x-large');
    t.match(res.body, 'Device string (debug): Mobile');
    t.end();
  });
});

test('GET /about_new rejects the Dust condition exploit payload', function (t) {
  var originalLog = console.log;
  var executed = false;

  console.log = function (message) {
    if (message === 'DUST_EXECUTED') {
      executed = true;
    }
    originalLog.apply(console, arguments);
  };

  requestPath(
    createTestApp(),
    "/about_new?device%5B%5D=Desktop%27-console.log(%27DUST_EXECUTED%27)-%27",
    function (err, res) {
      console.log = originalLog;
      t.error(err);
      t.equal(res.statusCode, 400);
      t.equal(res.body, 'Invalid device');
      t.notOk(executed, 'malicious device input did not execute');
      t.end();
    }
  );
});

test('about_new template does not evaluate the device string as a condition', function (t) {
  var template = fs.readFileSync(path.join(__dirname, '..', 'views', 'about_new.dust'), 'utf8');
  var compiled = dust.compile(template, 'about_new_security');
  var originalLog = console.log;
  var executed = false;

  dust.helpers = dustHelpers.helpers || dustHelpers;
  dust.loadSource(compiled);
  console.log = function (message) {
    if (message === 'DUST_EXECUTED') {
      executed = true;
    }
  };

  dust.render('about_new_security', {
    title: 'Patch TODO List',
    subhead: 'Vulnerabilities at their best',
    device: "Desktop'-console.log('DUST_EXECUTED')-'",
    isDesktop: false
  }, function (err, out) {
    console.log = originalLog;
    t.error(err);
    t.notOk(executed, 'malicious device input did not execute');
    t.match(out, 'font-size: x-large');
    t.end();
  });
});
