'use strict';

var ValidationError = require('../error/validation_error');
var validate = require('./validate');
var validateTypes = {
    enum: require('./validate_enum'),
    color: require('./validate_color'),
    array: require('./validate_array'),
    number: require('./validate_number')
};

module.exports = function validateLight(options) {
    var light = options.value;
    var styleSpec = options.styleSpec;
    var lightSpec = styleSpec.$root.light;
    var style = options.style;

    var errors = [];

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
                style: options.style,
                styleSpec: styleSpec
            }));
        } else if (lightSpec[key]) {
            type = lightSpec[key].type;
            errors = errors.concat(validateTypes[type]({
                key: key,
                value: light[key],
                valueSpec: lightSpec[key],
                style: options.style,
                styleSpec: styleSpec
            }));
        } else {
            errors = errors.concat([new ValidationError(key, light[key], 'unknown property "%s"', key)]);
        }
    }

    return errors;
};
