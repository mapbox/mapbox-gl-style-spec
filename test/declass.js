'use strict';

var t = require('tape'),
    declass = require('../lib/declass');

t('declass a style, one class', function (t) {
    var style = {
        layers: [{
            id: 'a',
            paint: {
                'fill-color': { base: 2, stops: [[0, 'red'], [22, 'yellow']] },
                'fill-outline-color': 'green'
            },
            'paint.one': {
                'fill-color': { base: 1 },
                'fill-opacity': 0.5
            }
        }]
    };

    t.deepEqual(declass(style, ['one']), {
        layers: [{
            id: 'a',
            paint: {
                'fill-color': { base: 1 },
                'fill-outline-color': 'green',
                'fill-opacity': 0.5
            },
            'paint.one': style.layers[0]['paint.one']
        }]
    });

    t.end();
});

t('declass a style, missing class ==> noop', function (t) {
    var style = {
        layers: [{
            id: 'a',
            paint: {
                'fill-color': 'red',
                'fill-outline-color': 'green'
            }
        }]
    };

    t.deepEqual(declass(style, ['one']), {
        layers: [{
            id: 'a',
            paint: {
                'fill-color': 'red',
                'fill-outline-color': 'green'
            }
        }]
    });

    t.end();
});

t('declass a style, multiple classes', function (t) {
    var style = {
        layers: [{
            id: 'a',
            paint: {
                'fill-color': 'red',
                'fill-outline-color': 'green'
            },
            'paint.one': {
                'fill-color': 'blue',
                'fill-opacity': 0.5
            },
            'paint.two': {
                'fill-opacity': 0.75,
                'fill-something-else': true
            }
        }]
    };

    t.deepEqual(declass(style, ['one', 'two']), {
        layers: [{
            id: 'a',
            paint: {
                'fill-color': 'blue',
                'fill-outline-color': 'green',
                'fill-opacity': 0.75,
                'fill-something-else': true
            },
            'paint.one': style.layers[0]['paint.one'],
            'paint.two': style.layers[0]['paint.two']
        }]
    });

    t.end();
});
