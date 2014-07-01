// GL style reference generator

var fs = require('fs'),
    path = require('path'),
    ref = require('../reference/v3.json'),
    _ = require('underscore');

function tmpl(x) {
  return _.template(fs.readFileSync(path.join(__dirname, x), 'utf-8'));
}

var index = tmpl('index._');
var toc = tmpl('toc._');
var table = tmpl('symbolizers._');

fs.writeFileSync(path.join(__dirname, '../_posts/3400-01-01-reference.html'), index({
  symbolizers: ref,
  table: table,
  toc: toc,
  _: _
}));
