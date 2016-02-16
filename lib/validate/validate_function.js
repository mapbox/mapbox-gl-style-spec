'use strict';

var ValidationError = require('../error/validation_error');
var validateObject = require('./validate_object');
var validateArray = require('./validate_array');
var unbundle = require('../util/unbundle_jsonlint');
var extend = require('../util/extend');

module.exports = function validateFunction(options) {
    var errors = [];
    var value = options.value;
    var key = options.key;
    var valueSpec = options.valueSpec;
    var styleSpec = options.styleSpec;

    var functionType = value.type ? unbundle(value.type) : 'exponential';

    // Check that the function type used is valid for the style property
    if (valueSpec['function-output'] === 'discrete' && functionType === 'exponential') {
        errors.push(new ValidationError(key + '.type', functionType, 'function type must be "categorical" or "interval" for this style property'));
    }

    var functionSpec = extend({}, styleSpec['function'], styleSpec['function_' + functionType]);

    // Run basic validations
    var validateObjectErrors = validateObject({
        key: key,
        value: value,
        valueSpec:
        functionSpec,
        style: options.style,
        styleSpec: options.styleSpec
    });
    errors = errors.concat(validateObjectErrors);
    if (validateObjectErrors.length) return errors;

    // Check that domain and range have a compatible number of elements
    if (functionType !== 'interval' && value.range.length !== value.domain.length) {
        errors.push(new ValidationError(key, value, 'domain and range must have equal number of elements'));
    } else if (functionType === 'interval' && value.range.length !== value.domain.length + 1) {
        errors.push(new ValidationError(key, value, 'range must have one more element than domain'));
    }

    // Check that domain is in ascending order
    if (functionType === 'exponential' || functionType === 'interval') {
        for (var i = 1; i < value.domain.length; i++) {
            if (value.domain[i] < value.domain[i - 1]) {
                errors.push(new ValidationError(key + '.domain', value.domain, 'domain elements must be in ascending order'));
            }
        }
    }

    // Ensure all range values are of the correct type
    errors = errors.concat(validateArray({
        key: key + '.range',
        value: value.range,
        valueSpec: {type: "array", value: valueSpec},
        style: options.style,
        styleSpec: options.styleSpec
    }));

    return errors;
};
