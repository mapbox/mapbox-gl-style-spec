'use strict';

var ref = require('../reference/v9');

function getProperty(prop) {
    for (var i = 0; i < ref.layout.length; i++) {
        for (var key in ref[ref.layout[i]]) {
            if (key === prop) return ref[ref.layout[i]][key];
        }
    }
    for (i = 0; i < ref.paint.length; i++) {
        for (key in ref[ref.paint[i]]) {
            if (key === prop) return ref[ref.paint[i]][key];
        }
    }
}

function eachLayer(style, callback) {
    for (var k in style.layers) {
        callback(style.layers[k]);
        eachLayer(style.layers[k], callback);
    }
}

function eachLayout(layer, callback) {
    for (var k in layer) {
        if (k.indexOf('layout') === 0) {
            callback(layer[k], k);
        }
    }
}

function eachPaint(layer, callback) {
    for (var k in layer) {
        if (k.indexOf('paint') === 0) {
            callback(layer[k], k);
        }
    }
}

module.exports = function(style) {
    style.version = 9;

    function migrateFunction(key, value) {
        if (value && value.stops) {
            value.domain = [];
            value.range = [];

            for (var i = 0; i < value.stops.length; i++) {
                value.domain.push(value.stops[i][0]);
                value.range.push(value.stops[i][1]);
            }

            if (getProperty(key).function === 'discrete') {
                value.type = 'interval';
                value.domain.shift();
                delete value.base;
            } else {
                value.type = 'exponential';
            }

            delete value.stops;

        } else if (typeof value === 'string' && value[0] === '@') {
            migrateFunction(key, style.constants[value]);
        }
    }

    eachLayer(style, function(layer) {
        eachLayout(layer, function(layout) {
            for (var key in layout) {
                migrateFunction(key, layout[key]);
            }
        });
        eachPaint(layer, function(paint) {
            for (var key in paint) {
                migrateFunction(key, paint[key]);
            }
        });
    });

    return style;
};
