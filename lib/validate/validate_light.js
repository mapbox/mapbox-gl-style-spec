'use strict';

var ValidationError = require('../error/validation_error');
var getType = require('../util/get_type');
var validate = require('./validate');

module.exports = function validateLight(options) {
    var light = options.value;
    var styleSpec = options.styleSpec;
    var lightSpec = styleSpec.light;
    var style = options.style;

    var errors = [];

    var rootType = getType(light);
    if (rootType !== 'object') {
        errors = errors.concat([new ValidationError('light', light, 'object expected, %s found', rootType)]);
        return errors;
    }

    var type;
    for (var key in light) {
        var transitionMatch = key.match(/^(.*)-transition$/);

        if (transitionMatch && lightSpec[transitionMatch[1]] && lightSpec[transitionMatch[1]].transition) {
            var baseKey = transitionMatch[1];

            type = lightSpec[baseKey].type;
            errors = errors.concat(validate({
                key: key,
                value: light[key],
                valueSpec: styleSpec.transition,
                style: style,
                styleSpec: styleSpec
            }));
        } else if (lightSpec[key]) {
            errors = errors.concat(validate({
                key: key,
                value: light[key],
                valueSpec: lightSpec[key],
                style: style,
                styleSpec: styleSpec
            }));
        } else {
            errors = errors.concat([new ValidationError(key, light[key], 'unknown property "%s"', key)]);
        }
    }

    return errors;
};
