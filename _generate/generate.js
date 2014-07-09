#!/usr/bin/env node

// GL style reference generator

var fs = require('fs'),
    path = require('path'),
    ref = require('../reference/v4.json'),
    _ = require('underscore');

function tmpl(x) {
  return _.template(fs.readFileSync(path.join(__dirname, x), 'utf-8'));
}

var index = tmpl('index.html');
var toc = tmpl('toc.html');
var table = tmpl('symbolizers.html');
var item = tmpl('item.html');

fs.writeFileSync(path.join(__dirname, '../index.html'), index({
  ref: ref,
  table: table,
  item: item,
  toc: toc,
  _: _
}));
