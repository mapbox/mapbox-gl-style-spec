'use strict';

var test = require('tape');
var ref = require('./');

for (var k in ref) {
  if (k !== '$version') {
    testProperty(k);
  }
}

function testProperty(k) {
  test(k, function(t) {
    validSchema(k, t, ref[k]);
    t.end();
  });
}

function validSchema(k, t, obj) {
  var scalar = ['boolean','string','number'];
  var types = Object.keys(ref).concat(['boolean','string','number','array','enum','color','*']);
  var keys = [
    'default',
    'doc',
    'function',
    'length',
    'required',
    'transition',
    'type',
    'value',
    'units',
    'tokens',
    'values'
  ];

  // Schema object.
  if (Array.isArray(obj.type) || typeof obj.type === 'string') {
    // schema must have only known keys
    for (var attr in obj) {
      t.ok(keys.indexOf(attr) !== -1, k + '.' + attr, 'stray key');
    }

    // schema type must be js native, 'color', or present in ref root object.
    t.ok(types.indexOf(obj.type) !== -1, k + '.type (' + obj.type + ')');

    // schema type is an enum, it must have 'values' and they must be scalars.
    if (obj.type === 'enum') {
      t.ok(Array.isArray(obj.values) && obj.values.every(function(v) {
        return scalar.indexOf(typeof v) !== -1;
      }), k + '.values [' + obj.values +']');
    }

    // schema type is array, it must have 'value' and it must be a type.
    if (obj.value !== undefined)
      if (Array.isArray(obj.value)) {
        obj.value.forEach(function(i) {
          t.ok(types.indexOf(i) !== -1, k + '.value (' + i + ')');
        });
      } else {
        t.ok(types.indexOf(obj.value) !== -1, k + '.value (' + obj.value + ')');
      }

      // schema key type checks
      if (obj.doc !== undefined)
        t.equal('string', typeof obj.doc, k + '.doc (string)');
      if (obj.function !== undefined)
        t.equal('boolean', typeof obj.function, k + '.function (boolean)');
      if (obj.required !== undefined)
        t.equal('boolean', typeof obj.required, k + '.required (boolean)');
      if (obj.transition !== undefined)
        t.equal('boolean', typeof obj.transition, k + '.transition (boolean)');
      // Array of schema objects or references.
  } else if (Array.isArray(obj)) {
    obj.forEach(function(child, j) {
      if (typeof child === 'string' && scalar.indexOf(child) !== -1) return;
      validSchema(k + '[' + j + ']', t,  typeof child === 'string' ? ref[child] : child, ref);
    });
    // Container object.
  } else if (typeof obj === 'object') {
    for (var j in obj) validSchema(k + '.' + j, t, obj[j], ref);
    // Invalid ref object.
  } else {
    t.ok(false, 'Invalid: ' + k);
  }
}
