'use strict';

/**
 * Returns a new style with the given 'paint classes' merged into each layer's
 * main `paint` definiton.
 *
 * @param {Object} style A style JSON object.
 * @param {Array<string>} classes An array of paint classes to apply, in order.
 */
module.exports = function declassStyle(style, classes) {
    return extend(style, {
        layers: style.layers.map(function (layer) {
            return classes.reduce(declassLayer, layer);
        })
    });
};

function declassLayer(layer, klass) {
    return extend(layer, {
        paint: extend(layer.paint, layer['paint.' + klass])
    });
}

function extend(dest, source) {
    var output = {};

    for (var k in dest) {
        output[k] = dest[k];
    }

    for (k in source) {
        output[k] = source[k];
    }

    return output;
}
