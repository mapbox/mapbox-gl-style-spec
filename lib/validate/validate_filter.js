'use strict';

var ValidationError = require('../error/validation_error');
var validateEnum = require('./validate_enum');
var getType = require('../util/get_type');
var unbundle = require('../util/unbundle_jsonlint');

module.exports = function validateFilter(options) {
    var value = options.value;
    var key = options.key;
    var styleSpec = options.styleSpec;

    var errors = [];

    if (getType(value) !== 'array') {
        return [new ValidationError(key, value, 'array expected, %s found', getType(value))];
    }

    if (value.length < 1) {
        return [new ValidationError(key, value, 'filter array must have at least 1 element')];
    }

    errors = errors.concat(validateEnum({
        key: key + '[0]',
        value: value[0],
        valueSpec: styleSpec.filter_operator,
        style: options.style,
        styleSpec: options.styleSpec
    }));

    switch (unbundle(value[0])) {
        case '<':
        case '<=':
        case '>':
        case '>=':
            if (value.length >= 2 && value[1] == '$type') {
                errors.push(new ValidationError(key, value, '"$type" cannot be use with operator "%s"', value[0]));
            }
            if (value.length != 3) {
                errors.push(new ValidationError(key, value, 'filter array for operator "%s" must have 3 elements', value[0]));
            }
            return errors.concat(validateSimpleFilter(options));

        case '==':
        case '!=':
            if (value.length != 3) {
                errors.push(new ValidationError(key, value, 'filter array for operator "%s" must have 3 elements', value[0]));
            }
            return errors.concat(validateSimpleFilter(options));

        case 'in':
        case '!in':
            return errors.concat(validateSimpleFilter(options));

        case 'has':
        case '!has':
            if (value.length != 2) {
                errors.push(new ValidationError(key, value, '"has" filter must have exactly 1 operand'));
            }
            return errors.concat(validateSimpleFilter(options));

        case 'any':
        case 'all':
        case 'none':
            for (var i = 1; i < value.length; i++) {
                errors = errors.concat(validateFilter({
                    key: key + '[' + i + ']',
                    value: value[i],
                    style: options.style,
                    styleSpec: options.styleSpec
                }));
            }
            return errors;
    }

    return errors;
};

function validateSimpleFilter(options) {
    var value = options.value;
    var key = options.key;
    var styleSpec = options.styleSpec;
    var errors = [];
    var type;

    if (value.length >= 2) {
        type = getType(value[1]);
        if (type !== 'string') {
            errors.push(new ValidationError(key + '[1]', value[1], 'string expected, %s found', type));
        } else if (value[1][0] === '@') {
            errors.push(new ValidationError(key + '[1]', value[1], 'filter key cannot be a constant'));
        }
    }

    for (var i = 2; i < value.length; i++) {
        type = getType(value[i]);
        if (value[1] == '$type') {
            errors = errors.concat(validateEnum({
                key: key + '[' + i + ']',
                value: value[i],
                valueSpec: styleSpec.geometry_type,
                style: options.style,
                styleSpec: options.styleSpec
            }));
        } else if (type === 'string' && value[i][0] === '@') {
            errors.push(new ValidationError(key + '[' + i + ']', value[i], 'filter value cannot be a constant'));
        } else if (type !== 'string' && type !== 'number' && type !== 'boolean' && value[i] !== null) {
            errors.push(new ValidationError(key + '[' + i + ']', value[i], 'string, number, boolean, or null expected, %s found', type));
        }
    }

    return errors;
}
