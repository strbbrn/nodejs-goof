const path = require('path');
const tap = require('tap');
const mongoose = require('mongoose');
const render = require('ejs-locals');

const Schema = mongoose.Schema;

try {
  mongoose.model('Todo', new Schema({ content: Buffer, updated_at: Date }));
} catch (err) {}

try {
  mongoose.model('User', new Schema({ username: String, password: String }));
} catch (err) {}

const routes = require('../routes');
const User = mongoose.model('User');

function renderAdmin(redirectPage) {
  return new Promise(function (resolve, reject) {
    render(path.join(__dirname, '../views/admin.ejs'), {
      locals: { title: 'Admin Access', granted: false, redirectPage: redirectPage },
      settings: { views: path.join(__dirname, '../views'), 'view engine': 'ejs' }
    }, function (err, html) {
      if (err) return reject(err);
      resolve(html);
    });
  });
}

tap.test('admin login form escapes redirectPage in hidden input', function (t) {
  const payload = '\"><script>alert(1)</script>';

  return renderAdmin(payload).then(function (html) {
    t.notMatch(html, /<script>alert\(1\)<\/script>/);
    t.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    t.end();
  });
});

tap.test('GET /login only reflects local redirectPage paths', function (t) {
  const renders = [];
  const res = {
    render: function (view, locals) {
      renders.push({ view: view, locals: locals });
    }
  };

  routes.login({ query: { redirectPage: '\"><script>alert(1)</script>' } }, res);
  t.equal(renders[0].view, 'admin');
  t.equal(renders[0].locals.redirectPage, '');

  routes.login({ query: { redirectPage: '/admin?tab=profile' } }, res);
  t.equal(renders[1].locals.redirectPage, '/admin?tab=profile');

  routes.login({ query: { redirectPage: 'https://example.com' } }, res);
  t.equal(renders[2].locals.redirectPage, '');

  t.end();
});

tap.test('POST /login redirects only to local redirectPage paths', function (t) {
  const originalFind = User.find;
  const redirects = [];
  const res = {
    redirect: function (location) {
      redirects.push(location);
    }
  };

  User.find = function (query, cb) {
    cb(null, [{ username: query.username }]);
  };

  t.teardown(function () {
    User.find = originalFind;
  });

  routes.loginHandler({
    body: {
      username: 'admin@snyk.io',
      password: 'SuperSecretPassword',
      redirectPage: '/admin?tab=profile'
    },
    session: {}
  }, res);
  t.equal(redirects[0], '/admin?tab=profile');

  routes.loginHandler({
    body: {
      username: 'admin@snyk.io',
      password: 'SuperSecretPassword',
      redirectPage: 'https://example.com'
    },
    session: {}
  }, res);
  t.equal(redirects[1], '/admin');

  routes.loginHandler({
    body: {
      username: 'admin@snyk.io',
      password: 'SuperSecretPassword',
      redirectPage: '//example.com'
    },
    session: {}
  }, res);
  t.equal(redirects[2], '/admin');

  t.end();
});
