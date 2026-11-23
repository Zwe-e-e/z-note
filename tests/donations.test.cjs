'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/js/util.js'), 'utf8');
const configLines = source.match(/^  const donation = \{ paypalMe: [^\r\n]+, currency: [^\r\n]+ \};$/gm);
assert.equal(configLines?.length, 1, 'The fixture must replace only the public donation settings.');

function support(settings) {
  const context = {
    window: {},
    document: {
      createElement(tag) {
        assert.equal(tag, 'textarea', 'Loading donation URL helpers should not create payment UI.');
        return {};
      }
    },
    fetch() { throw new Error('Donation configuration must not contact the internet.'); }
  };
  // Test public settings in memory; never change the real recipient or currency.
  const configured = source.replace(configLines[0], '  const donation = ' + JSON.stringify(settings) + ';');
  vm.runInNewContext(configured, context, { filename: 'app/js/util.js' });
  return context.window.ZN.support;
}

test('each fixed amount links to the exact recipient, amount and requested currency', () => {
  for (const currency of ['USD', 'SGD']) {
    const donations = support({ paypalMe: 'https://paypal.me/ZNoteTest123', currency });
    assert.equal(donations.currency, currency);
    for (const amount of [1, 3, 5]) {
      assert.equal(donations.paypalUrl(amount), 'https://paypal.me/ZNoteTest123/' + amount + currency);
    }
  }
});

test('the optional www prefix and trailing slash normalize to the same PayPal recipient', () => {
  const donations = support({ paypalMe: 'https://www.paypal.me/ZNoteTest123/', currency: 'USD' });
  assert.equal(donations.paypalUrl(3), 'https://paypal.me/ZNoteTest123/3USD');
});

test('missing or malformed recipients produce no payment link', () => {
  const recipients = [
    undefined, null, '', 'ZNoteTest123',
    'http://paypal.me/ZNoteTest123',
    'javascript:alert(1)',
    'https://paypal.me/',
    'https://paypal.me/abcdefghijklmnopqrstu',
    'https://paypal.me/handle-with-dashes',
    'https://paypal.me/ZNoteTest123/3USD',
    'https://paypal.me/ZNoteTest123?amount=100',
    'https://paypal.me/ZNoteTest123#different-recipient',
    ' https://paypal.me/ZNoteTest123',
    'https://paypal.me/ZNoteTest123 ',
    'https://paypal.me/ZNoteTest123\n'
  ];
  for (const paypalMe of recipients) {
    assert.equal(support({ paypalMe, currency: 'USD' }).paypalUrl(3), '', JSON.stringify(paypalMe));
  }
});

test('lookalike domains, embedded credentials and alternate ports cannot become payment links', () => {
  const recipients = [
    'https://paypal.me.example.com/ZNoteTest123',
    'https://notpaypal.me/ZNoteTest123',
    'https://paypa1.me/ZNoteTest123',
    'https://paypal.me@evil.example/ZNoteTest123',
    'https://evil.example@paypal.me/ZNoteTest123',
    'https://user:password@paypal.me/ZNoteTest123',
    'https://paypal.me:443/ZNoteTest123',
    'https://paypal.me\\@evil.example/ZNoteTest123',
    '//paypal.me/ZNoteTest123'
  ];
  for (const paypalMe of recipients) {
    assert.equal(support({ paypalMe, currency: 'USD' }).paypalUrl(3), '', paypalMe);
  }
});

test('unsupported or missing currencies produce no payment link', () => {
  for (const currency of [undefined, null, '', 'EUR', 'usd', 'sgd', 'USD ', 'USD?amount=100']) {
    const donations = support({ paypalMe: 'https://paypal.me/ZNoteTest123', currency });
    assert.equal(donations.paypalUrl(3), '', JSON.stringify(currency));
  }
});

test('amounts outside the three explicit numeric choices produce no payment link', () => {
  const donations = support({ paypalMe: 'https://paypal.me/ZNoteTest123', currency: 'SGD' });
  for (const amount of [undefined, null, '', '1', '3', '5', 0, -1, 2, 4, 6, 1.5, NaN, Infinity, {}, []]) {
    assert.equal(donations.paypalUrl(amount), '', String(amount));
  }
});
