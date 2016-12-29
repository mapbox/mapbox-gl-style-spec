'use strict';

const diffStyles = require('./diff');
const latestStyleSpec = require('../reference/latest.min');

const _ = require('lodash');
const colorParser = require('csscolorparser');

const tabWidth = 4;

function Collection(items) {
    if (!(this instanceof Collection)) {
        return new Collection(items);
    }
    this.type = 'collection';
    this.items = items;
}

Collection.prototype.toObjC = function () {
    let items = this.items;
    if (Array.isArray(items)) {
        items = _.invokeMap(items, 'toObjC');
        return `@[${items.join(', ')}]`;
    } else {
        items = _.map(items, function (value, key) {
            value = value.toObjC();
            if (key.toObjC) {
                key = key.toObjC();
            } else {
                if (!Number.isNaN(parseFloat(key))) {
                    key = parseFloat(key);
                }
                key = Literal(key, true).toObjC();
            }
            return `${key}: ${value}`;
        });
        return `@{${items.join(', ')}}`;
    }
};

Collection.prototype.toSwift = function () {
    let items = this.items;
    if (Array.isArray(items)) {
        items = _.invokeMap(items, 'toSwift');
        return `[${items.join(', ')}]`;
    } else {
        items = _.map(items, function (value, key) {
            value = value.toSwift();
            if (key.toSwift) {
                key = key.toSwift();
            } else {
                if (!Number.isNaN(parseFloat(key))) {
                    key = parseFloat(key);
                }
                key = Literal(key, true).toSwift();
            }
            return `${key}: ${value}`;
        });
        if (items.length === 0) {
            return '[:]';
        } else {
            return `[${items.join(', ')}]`;
        }
    }
};

function Literal(jsValue, isObject) {
    if (!(this instanceof Literal)) {
        return new Literal(jsValue, isObject);
    }
    this.type = 'literal';
    this.jsValue = jsValue;
    this.isObject = isObject;
}

Literal.prototype.toObjC = function () {
    let jsValue = this.jsValue;
    let isObject = this.isObject;
    if (jsValue == null || jsValue === undefined) {
        return isObject ? '[NSNull null]' : 'nil';
    }
    if (Array.isArray(jsValue)) {
        return Collection(_.map(jsValue, value => Literal(value, true)));
    }
    switch (typeof jsValue) {
        case 'boolean':
            return (isObject ? '@' : '') + (jsValue ? 'YES' : 'NO');
        case 'number':
            return isObject ? ('@' + jsValue) : jsValue;
        case 'string':
            jsValue = jsValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return `@"${jsValue}"`;
        case 'object':
            return Collection(_.mapValues(_.mapKeys(jsValue, key => Literal(key, true)),
                                          value => Literal(value, true)));
        default:
            throw `Cannot convert value ${jsValue} to Objective-C literal.`;
    }
};

Literal.prototype.toSwift = function () {
    let jsValue = this.jsValue;
    let isObject = this.isObject;
    if (jsValue == null || jsValue === undefined) {
        return 'nil';
    }
    if (Array.isArray(jsValue)) {
        return Collection(_.map(jsValue, value => Literal(value, true)));
    }
    switch (typeof jsValue) {
        case 'boolean':
        case 'number':
            return jsValue;
        case 'string':
            jsValue = jsValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return `"${jsValue}"`;
        case 'object':
            return Collection(_.mapValues(_.mapKeys(jsValue, key => Literal(key, true)),
                                          value => Literal(value, true)));
        default:
            throw `Cannot convert value ${jsValue} to Swift literal.`;
    }
};

function ClassReference(name, objType, keyType, isNullable) {
    if (!(this instanceof ClassReference)) {
        return new ClassReference(name, objType, keyType, isNullable);
    }
    this.type = 'class-reference';
    this.name = name;
    this.objType = objType;
    this.keyType = keyType;
    this.isNullable = isNullable;
}

ClassReference.prototype.toObjC = function () {
    let name = this.name;
    if (name.toObjC) {
        name = name.toObjC();
    }
    let params = [];
    if (this.objType) {
        params.push(this.objType.toObjC());
    }
    if (this.keyType) {
        params.push(this.keyType.toObjC());
    }
    if (params.length) {
        return `${name}<${params.join(', ')} *>`;
    } else {
        return name;
    }
};

ClassReference.prototype.toSwift = function () {
    let name = this.name;
    if (name.toSwift) {
        name = name.toSwift();
    }
    let params = [];
    if (this.objType) {
        params.push(this.objType.toSwift());
    }
    if (this.keyType) {
        params.push(this.keyType.toSwift());
    }
    // MGLStyleValue<NSArray<…> *> bridges to Swift as MGLStyleValue<NSArray>,
    // because NSArray is non-generic.
    if (params.length && !_.startsWith(name, 'NS')) {
        return `${name}<${params.join(', ')}>`;
    } else {
        return name;
    }
};

function EnumReference(enumType, value) {
    if (!(this instanceof EnumReference)) {
        return new EnumReference(enumType, value);
    }
    this.type = 'enum-reference';
    this.enumType = enumType;
    this.value = value;
}

EnumReference.prototype.toObjC = function () {
    return `${this.enumType}${this.value}`;
};

EnumReference.prototype.toSwift = function () {
    return `${this.enumType}.${_.camelCase(this.value)}`;
};

function FunctionCall(name, args) {
    if (!(this instanceof FunctionCall)) {
        return new FunctionCall(name, args);
    }
    this.type = 'function-call';
    this.name = name;
    this.args = args;
}

FunctionCall.prototype.toObjC = function () {
    let args = _.invokeMap(this.args, 'toObjC');
    return `${this.name}(${args.join(', ')})`;
};

FunctionCall.prototype.toSwift = function () {
    let args = _.invokeMap(this.args, 'toSwift');
    return `${this.name}(${args.join(', ')})`;
};

function StructFactoryFunctionCall(struct, args) {
    if (!(this instanceof StructFactoryFunctionCall)) {
        return new StructFactoryFunctionCall(struct, args);
    }
    // Assume that _.map iterates over args in the order the keys were added.
    FunctionCall.call(this, struct + 'Make', _.values(args));
    this.type = 'struct-factory-function-call';
    this.struct = struct;
    this.labeledArgs = args;
}

StructFactoryFunctionCall.prototype = Object.create(FunctionCall.prototype);
StructFactoryFunctionCall.prototype.constructor = StructFactoryFunctionCall;

StructFactoryFunctionCall.prototype.toSwift = function () {
    let args = _.map(this.labeledArgs, (v, k) => `${k}: ${v.toObjC()}`);
    return `${this.struct}(${args.join(', ')})`;
};

function Message(receiver, args, returnType) {
    if (!(this instanceof Message)) {
        return new Message(receiver, args, returnType);
    }
    this.type = 'message';
    this.receiver = receiver;
    this.args = args;
    this.returnType = returnType;
}

Message.prototype.toObjC = function () {
    let receiver = this.receiver;
    if (receiver.toObjC) {
        receiver = receiver.toObjC();
    }
    let args = this.args;
    // Assume that _.map iterates over args in the order the keys were added.
    let pieces;
    if (typeof args === 'string') {
        pieces = [args];
    } else {
        pieces = _.map(args, function (v, arg) {
            if (Array.isArray(v)) {
                v = _.invokeMap(v, 'toObjC').join(', ');
            } else if (v.toObjC) {
                v = v.toObjC();
            }
            return `${arg}:${v}`;
        });
    }
    pieces.unshift(receiver);
    return `[${pieces.join(' ')}]`;
};

/**
 * Some common prepositions used in iOS/macOS SDK method names.
 *
 * Swift tends to drop nouns from prepositional phrases in selector pieces. The
 * full list of prepositions recognized by the compiler is located at
 * <https://github.com/apple/swift/blob/swift-DEVELOPMENT-SNAPSHOT-2016-12-15-a/lib/Basic/PartsOfSpeech.def>.
 */
const prepositions = /^(above|after|at|before|below|for|from|in|of|to|with).*/;

Message.prototype.toSwift = function () {
    let receiver = this.receiver;
    let args = this.args;
    // Assume that _.map iterates over args in the order the keys were added.
    let firstLabel;
    let pieces;
    if (typeof args === 'string') {
        firstLabel = args;
    } else {
        let isInitializing = false;
        pieces = _.map(args, function (v, arg) {
            if (Array.isArray(v)) {
                v = _.invokeMap(v, 'toSwift').join(', ');
            } else if (v.dataType && v.dataType.isNullable) {
                v = TypeCoercion(null, v).toSwift();
            } else if (v.toSwift) {
                v = v.toSwift();
            }
            if (firstLabel || isInitializing) {
                let match = arg.match(prepositions);
                if (match) {
                    // Drop the noun in a prepositional phrase.
                    arg = match[1];
                }
                return `${arg}: ${v}`;
            } else if (arg.indexOf('With') > 0) {
                let parts = arg.split('With');
                // Omit the first noun when initializing.
                if (receiver instanceof ClassReference) {
                    isInitializing = true;
                    arg = _.camelCase(parts[1]);
                } else {
                    firstLabel = parts[0];
                    arg = 'with' + parts[1];
                }
                return `${arg}: ${v}`;
            } else {
                firstLabel = arg;
                return v;
            }
        });
    }
    if (receiver.toSwift) {
        receiver = receiver.toSwift();
    }
    let msg = receiver;
    if (firstLabel) {
        msg += '.' + firstLabel;
    }
    msg += `(${pieces.join(', ')})`;
    return msg;
};

function NewObject(cls, args) {
    if (!(this instanceof NewObject)) {
        return new NewObject(cls, args);
    }
    Message.call(this, Message(cls, 'alloc', cls), args, cls);
    this.type = 'new-object';
    this.cls = cls;
}

NewObject.prototype = Object.create(Message.prototype);
NewObject.prototype.constructor = NewObject;

NewObject.prototype.toSwift = function () {
    let args = this.args;
    return Message(this.cls, args, this.cls).toSwift();
};

function TypeCoercion(coercedType, val) {
    if (!(this instanceof TypeCoercion)) {
        return new TypeCoercion(coercedType, val);
    }
    this.type = 'type-coercion';
    this.coercedType = coercedType;
    this.val = val;
}

TypeCoercion.prototype.toObjC = function () {
    return this.coercedType ? `(${this.coercedType} *)${this.val.toObjC()}` : this.val.toObjC();
};

TypeCoercion.prototype.toSwift = function () {
    return this.coercedType ? `${this.val.toSwift()} as! ${this.coercedType}` : `${this.val.toSwift()}!`;
};

function KeyPath(components, dataType) {
    if (!(this instanceof KeyPath)) {
        return new KeyPath(components, dataType);
    }
    this.type = 'key-path';
    this.components = components;
    this.dataType = dataType;
}

KeyPath.prototype.toObjC = KeyPath.prototype.toSwift = function () {
    return this.components.join('.');
};

function Statement() {
    if (!(this instanceof Statement)) {
        return new Statement();
    }
    this.type = 'statement';
    this.indentation = 0;
}

function VariableDeclaration(dataType, name, value) {
    if (!(this instanceof VariableDeclaration)) {
        return new VariableDeclaration(dataType, name, value);
    }
    Statement.call(this);
    this.type = 'variable-declaration';
    this.dataType = dataType;
    this.name = name;
    this.value = value;
}

VariableDeclaration.prototype = Object.create(Statement.prototype);
VariableDeclaration.prototype.constructor = VariableDeclaration;

VariableDeclaration.prototype.toObjC = function () {
    let value = this.value;
    if (value.toObjC) {
        value = value.toObjC();
    }
    return ' '.repeat(this.indentation * tabWidth) + `${this.dataType} *${this.name} = ${value};`;
};

VariableDeclaration.prototype.toSwift = function () {
    let value = this.value;
    if (value.returnType && value.returnType.isNullable) {
        value = value.toSwift() + '!';
    } else if (value.toSwift) {
        value = value.toSwift();
    }
    return ' '.repeat(this.indentation * tabWidth) + `let ${this.name} = ${value}`;
};

function Assignment(variable, value) {
    if (!(this instanceof Assignment)) {
        return new Assignment(variable, value);
    }
    Statement.call(this);
    this.type = 'assignment';
    this.variable = variable;
    this.value = value;
};

Assignment.prototype = Object.create(Statement.prototype);
Assignment.prototype.constructor = Assignment;

Assignment.prototype.toObjC = function () {
    let variable = this.variable;
    if (variable && variable.toObjC) {
        variable = variable.toObjC();
    }
    let value = this.value;
    if (value && value.toObjC) {
        value = value.toObjC();
    }
    return ' '.repeat(this.indentation * tabWidth) + (variable ? `${variable} = ${value}` : value) + ';';
};

Assignment.prototype.toSwift = function () {
    let variable = this.variable;
    if (variable && variable.toSwift) {
        variable = variable.toSwift();
    }
    let value = this.value;
    if (value && value.toSwift) {
        value = value.toSwift();
    }
    return ' '.repeat(this.indentation * tabWidth) + (variable ? `${variable} = ${value}` : value);
};

function ControlStatement() {
    if (!(this instanceof ControlStatement)) {
        return new ControlStatement();
    }
    Statement.call(this);
    this.type = 'control-statement';
}

ControlStatement.prototype = Object.create(Statement.prototype);
ControlStatement.prototype.constructor = ControlStatement;

function BlockStatement(substatements) {
    if (!(this instanceof BlockStatement)) {
        return new BlockStatement(substatements);
    }
    ControlStatement.call(this);
    this.type = 'block-statement';
    _.forEach(substatements, stmt => stmt.indentation++);
    this.substatements = substatements;
}

BlockStatement.prototype = Object.create(ControlStatement.prototype);
BlockStatement.prototype.constructor = BlockStatement;

BlockStatement.prototype.toObjC = function () {
    let substatements = _.invokeMap(this.substatements, 'toObjC');
    return ' '.repeat(this.indentation * tabWidth) + `{\n${substatements.join('\n')}\n}`;
};

BlockStatement.prototype.toSwift = function () {
    let substatements = _.invokeMap(this.substatements, 'toSwift');
    return ' '.repeat(this.indentation * tabWidth) + `_ = {\n${substatements.join('\n')}\n}()`;
};

function upperCamelCase(str) {
    return _.upperFirst(_.camelCase(str));
}

function getPropertyType(propName, prop, os) {
    switch (prop.type) {
        case 'boolean':
        case 'number':
            return ClassReference('NSNumber');
        case 'string':
            return ClassReference('NSString');
        case 'enum':
            return ClassReference('NSValue');
        case 'color':
            return ClassReference(os === 'ios' ? 'UIColor' : 'NSColor');
        case 'array':
            if (propName.match(/-(?:padding|offset|translate)$/)) {
                return ClassReference('NSValue');
            }
            return ClassReference('NSArray',
                                  ClassReference(getPropertyType(propName, {type: prop.value}, os)));
        default:
            throw `Value of type ${prop.type} not implemented for property ${propName}.`;
    }
}

function valueToConstantValue(jsValue, propName, prop, os) {
    let type = getPropertyType(propName, prop, os);
    switch (prop.type) {
        case 'boolean':
        case 'number':
        case 'string':
            return Literal(jsValue, true);
        case 'enum':
            let enumType = 'MGL' + upperCamelCase(propName);
            let args = {};
            args['valueWith' + enumType] = EnumReference(enumType, upperCamelCase(jsValue));
            return Message(type, args, enumType);
        case 'color': {
            let color = colorParser.parseCSSColor(jsValue);
            let args = {};
            args[`colorWith${os === 'macos' ? 'Calibrated' : ''}Red`] = `${color[0]} / 255.0`;
            args.green = `${color[1]} / 255.0`;
            args.blue = `${color[2]} / 255.0`;
            args.alpha = color[3];
            return Message(type, args, type);
        }
        case 'array':
            if (propName.indexOf('padding') !== -1) {
                let makeInsetsCall = StructFactoryFunctionCall((os === 'ios' ? 'UI' : 'NS') + 'EdgeInsets', {
                    top: Literal(jsValue[0]),
                    left: Literal(jsValue[3]),
                    bottom: Literal(jsValue[2]),
                    right: Literal(jsValue[1]),
                });
                let args = {};
                args[`valueWith${os === 'ios' ? 'UI' : ''}EdgeInsets`] = makeInsetsCall;
                return Message(type, args, type);
            } else if (propName.indexOf('offset') !== -1 || propName.indexOf('translate') !== -1) {
                return Message(type, {
                    valueWithCGVector: StructFactoryFunctionCall('CGVector', {
                        dx: Literal(jsValue[0]),
                        dy: Literal(jsValue[1]),
                    }),
                }, type);
            } else {
                return Collection(_.map(jsValue, function (jsValue) {
                    return valueToConstantValue(jsValue, propName, {type: prop.value}, os);
                }));
            }
        default:
            throw `Value of type ${propType} not implemented for property ${propName}.`;
    }
}

function valueToFunction(jsValue, propName, os) {
    if ('property' in jsValue) {
        throw 'Property functions not supported.';
    }
    
    return {
        base: jsValue.base,
        stops: _.mapValues(_.fromPairs(jsValue.stops), function (jsValue) {
            return valueToStyleValue(jsValue, propName, os);
        }),
    };
}

function getLayerPropertyName(jsName, os) {
    let prop = latestStyleSpec[_.findKey(latestStyleSpec, jsName)][jsName];
    let name = jsName;
    if ('sdk-name' in prop && os in prop['sdk-name']) {
        // In Objective-C, the is- prefix is only for getter methods, not property names.
        name = prop['sdk-name'][os].replace(/^is-/, '');
    }
    return _.camelCase(name);
}

function valueToStyleValue(jsValue, propName, os) {
    let prop = latestStyleSpec[_.findKey(latestStyleSpec, propName)][propName];
    if (jsValue == null) {
        return 'nil';
    } else if (typeof jsValue === 'object') {
        let type = ClassReference('MGLStyleValue', getPropertyType(propName, prop, os));
        let fn = valueToFunction(jsValue, propName, os);
        fn.stops = Collection(fn.stops);
        if (fn.base === undefined || fn.base === 1) {
            return Message(type, {
                valueWithStops: fn.stops,
            }, type);
        } else {
            return Message(type, {
                valueWithInterpolationBase: fn.base,
                stops: fn.stops,
            }, type);
        }
    } else {
        let type = ClassReference('MGLStyleValue', getPropertyType(propName, prop, os));
        let value = valueToConstantValue(jsValue, propName, prop, os);
        return Message(type, {
            valueWithRawValue: value,
        }, type);
    }
}

function getLayerClassByProperty(propName) {
    let type = _.findKey(latestStyleSpec, propName).replace(/^(?:paint|layout)_/, '');
    return `MGL${upperCamelCase(type)}StyleLayer`;
}

function getSourceClass(source) {
    switch (source.type) {
        case 'geojson':
            return 'MGLShapeSource';
        case 'raster':
            return 'MGLRasterSource';
        case 'vector':
            return 'MGLVectorSource';
        default:
            throw `${source.type} sources not implemented.`;
    }
}

function filterValueToExpression(jsValue) {
    switch (typeof jsValue) {
        case 'boolean':
            return jsValue ? 'TRUE' : 'FALSE';
        case 'number':
            return jsValue;
        case 'string':
            jsValue = jsValue.replace(/\\/g, '\\\\').replace(/'/g, `\\\'`).replace(/"/g, '\\"');
            return `'${jsValue}'`;
        default:
            throw `Filter value ${jsValue} cannot be converted to an expression.`;
    }
}

function filterToPredicate(filter) {
    let left = filter[1];
    let leftArg;
    if (typeof left !== 'object' && !left.match(/^\w*$/)) {
        leftArg = Literal(left);
        left = '%K';
    }
    let op = filter[0];
    switch (op) {
        case 'has':
            return [`${left} != nil`, leftArg];
        case '!has':
            return [`${left} = nil`, leftArg];
        case '==':
            return [`${left} = ${filterValueToExpression(filter[2])}`, leftArg];
        case '!=':
        case '>':
        case '>=':
        case '<':
        case '<=':
            return [`${left} ${op} ${filterValueToExpression(filter[2])}`, leftArg];
        case 'in': {
            let right = _.map(filter.slice(2), filterValueToExpression).join(', ');
            return [`${left} IN {${right}}`, leftArg];
        }
        case '!in': {
            let right = _.map(filter.slice(2), filterValueToExpression).join(', ');
            return [`NOT ${left} IN {${right}}`, leftArg];
        }
        case 'all': {
            let args = [];
            let subfilters = _.map(filter.slice(1), function (filter) {
                let subargs = filterToPredicate(filter);
                let predicate = subargs[0];
                if (['all', 'any', 'none'].indexOf(filter[0]) !== -1) {
                    predicate = '(' + predicate + ')';
                }
                subargs = subargs.slice(1);
                if (subargs[0]) {
                    Array.prototype.push.apply(args, subargs);
                }
                return predicate;
            });
            args.unshift(subfilters.join(' AND '));
            return args;
        }
        case 'any': {
            let args = [];
            let subfilters = _.map(filter.slice(1), function (filter) {
                let subargs = filterToPredicate(filter);
                let predicate = subargs[0];
                if (['all', 'any', 'none'].indexOf(filter[0]) !== -1) {
                    predicate = '(' + predicate + ')';
                }
                subargs = subargs.slice(1);
                if (subargs[0]) {
                    Array.prototype.push.apply(args, subargs);
                }
                return predicate;
            });
            args.unshift(subfilters.join(' OR '));
            return args;
        }
        case 'not': {
            let args = [];
            let subfilters = _.map(filter.slice(1), function (filter) {
                let subargs = filterToPredicate(filter);
                let predicate = subargs[0];
                if (['all', 'any', 'none'].indexOf(filter[0]) !== -1) {
                    predicate = '(' + predicate + ')';
                }
                subargs = subargs.slice(1);
                if (subargs[0]) {
                    Array.prototype.push.apply(args, subargs);
                }
                return predicate;
            });
            if (subfilters.length > 1) {
                args.unshift(`NOT (${subfilters.join(' OR ')})`);
            } else {
                args.unshift(`NOT ${subfilters}`);
            }
            return args;
        }
        default:
            throw `Filter operator ${op} not implemented.`;
    }
}

let operations = {
    addLayer: function (layer, beforeLayerId, os) {
        let layerVar = _.camelCase(layer.id) + 'Layer';
        let layerInitArgs = {
            initWithIdentifier: Literal(layer.id),
        };
        let beforeLayerVar = _.camelCase(beforeLayerId) + 'Layer';
        let statements = [];
        let layerClass;
        _.forEach(layer.layout, function (jsValue, jsPropName) {
            if (!layerClass) {
                layerClass = getLayerClassByProperty(jsPropName);
            }
            let propName = getLayerPropertyName(jsPropName, os);
            let value = valueToStyleValue(jsValue, jsPropName, os);
            statements.push(Assignment(KeyPath([layerVar, propName]), value));
        });
        _.forEach(layer.paint, function (jsValue, jsPropName) {
            if (!layerClass) {
                layerClass = getLayerClassByProperty(jsPropName);
            }
            let propName = getLayerPropertyName(jsPropName, os);
            let value = valueToStyleValue(jsValue, jsPropName, os);
            statements.push(Assignment(KeyPath([layerVar, propName]), value));
        });
        if (!layerClass) {
            layerClass = `MGL${upperCamelCase(layer.type)}StyleLayer`;
        }
        let sourceId;
        let sourceVar;
        if ('source' in layer) {
            sourceId = layer.source;
            sourceVar = _.camelCase(layer.source) + 'Source';
            layerInitArgs.source = sourceVar;
        }
        let refLayerId;
        let refLayerVar;
        if ('ref' in layer) {
            refLayerId = layer.ref;
            refLayerVar = _.camelCase(refLayerId) + 'Layer';
            if (layerClass !== 'MGLBackgroundStyleLayer') {
                layerInitArgs.source = refLayerVar + 'Source';
            }
        }
        let layerInitMsg = NewObject(ClassReference(layerClass), layerInitArgs);
        statements.unshift(VariableDeclaration(layerClass, layerVar, layerInitMsg));
        if (sourceId) {
            let getSourceMsg = Message(KeyPath(['mapView', 'style']), {
                sourceWithIdentifier: Literal(layer.source),
            }, ClassReference('MGLSource', null, null, true));
            statements.unshift(VariableDeclaration('MGLSource', sourceVar, getSourceMsg));
        }
        if (refLayerId) {
            if (layerClass !== 'MGLBackgroundStyleLayer') {
                let layerSourceVar = refLayerVar + 'Source';
                let getSourceMsg = Message(KeyPath(['mapView', 'style']), {
                    sourceWithIdentifier: KeyPath([refLayerVar, 'sourceIdentifier'],
                                                  ClassReference('NSString', null, null, true)),
                }, ClassReference('MGLSource', null, null, true));
                statements.unshift(VariableDeclaration('MGLSource', layerSourceVar, getSourceMsg));
                if (layerClass !== 'MGLRasterStyleLayer') {
                    statements.push(Assignment(KeyPath([layerVar, 'sourceLayerIdentifier']),
                                               KeyPath([refLayerVar, 'sourceLayerIdentifier'])));
                    statements.push(Assignment(KeyPath([layerVar, 'predicate']),
                                               KeyPath([refLayerVar, 'predicate'])));
                }
            }
            let getRefLayerMsg = Message(KeyPath(['mapView', 'style']), {
                layerWithIdentifier: Literal(refLayerId),
            }, ClassReference('MGLStyleLayer', null, null, true));
            statements.unshift(VariableDeclaration(layerClass, refLayerVar,
                                                   TypeCoercion(layerClass, getRefLayerMsg)));
            statements.push(Assignment(KeyPath([layerVar, 'minimumZoomLevel']),
                                       KeyPath([refLayerVar, 'minimumZoomLevel'])));
            statements.push(Assignment(KeyPath([layerVar, 'maximumZoomLevel']),
                                       KeyPath([refLayerVar, 'maximumZoomLevel'])));
        }
        if (beforeLayerId !== refLayerId) {
            let getBeforeLayerMsg = Message(KeyPath(['mapView', 'style']), {
                layerWithIdentifier: Literal(beforeLayerId),
            }, ClassReference('MGLStyleLayer', null, null, true));
            statements.push(VariableDeclaration('MGLStyleLayer', beforeLayerVar, getBeforeLayerMsg));
        }
        let insertLayerMsg = Message(KeyPath(['mapView', 'style']), {
            insertLayer: layerVar,
            belowLayer: beforeLayerVar,
        });
        statements.push(Assignment(null, insertLayerMsg));
        return statements;
    },
    removeLayer: function (layerId) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = Message(KeyPath(['mapView', 'style']), {
            layerWithIdentifier: Literal(layerId),
        }, ClassReference('MGLStyleLayer', null, null, true));
        let removeLayerMsg = Message(KeyPath(['mapView', 'style']), {
            removeLayer: layerVar,
        });
        return [VariableDeclaration('MGLStyleLayer', layerVar, getLayerMsg),
                Assignment(null, removeLayerMsg)];
    },
    setLayerOrPaintProperty: function (layerId, jsPropName, jsValue, cls, os) {
        let layerClass = getLayerClassByProperty(jsPropName);
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = Message(KeyPath(['mapView', 'style']), {
            layerWithIdentifier: Literal(layerId),
        }, ClassReference('MGLStyleLayer', null, null, true));
        let propName = getLayerPropertyName(jsPropName, os);
        let value = valueToStyleValue(jsValue, jsPropName, os);
        return [VariableDeclaration(layerClass, layerVar, TypeCoercion(layerClass, getLayerMsg)),
                Assignment(KeyPath([layerVar, propName]), value)];
    },
    setPaintProperty: function (layerId, jsPropName, jsValue, cls, os) {
        return operations.setLayerOrPaintProperty(layerId, jsPropName, jsValue, cls, os);
    },
    setLayoutProperty: function (layerId, jsPropName, jsValue, cls, os) {
        return operations.setLayerOrPaintProperty(layerId, jsPropName, jsValue, cls, os);
    },
    setFilter: function (layerId, filter) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = Message(KeyPath(['mapView', 'style']), {
            layerWithIdentifier: Literal(layerId),
        }, ClassReference('MGLStyleLayer', null, null, true));
        let args = filterToPredicate(filter);
        args[0] = Literal(args[0]);
        let predicateMsg = Message(ClassReference('NSPredicate'), {
            predicateWithFormat: args,
        }, ClassReference('NSPredicate'));
        return [VariableDeclaration('MGLVectorStyleLayer', layerVar,
                                    TypeCoercion('MGLVectorStyleLayer', getLayerMsg)),
                Assignment(KeyPath([layerVar, 'predicate']), predicateMsg)];
    },
    addSource: function (sourceId, source) {
        let sourceVar = _.camelCase(source.id) + 'Source';
        let sourceClass = getSourceClass(source);
        let initSourceArgs = {
            initWithIdentifier: Literal(sourceId),
        };
        if ('url' in source) {
            initSourceArgs.configurationURL = Message(ClassReference('NSURL'), {
                URLWithString: Literal(source.url),
            }, ClassReference('NSURL', null, null, true));
            if ('tileSize' in source) {
                initSourceArgs.tileSize = Literal(source.tileSize);
            }
        } else if ('tiles' in source) {
            initSourceArgs.tileURLTemplates = Literal(source.tiles);
            let sourceOptionKeys = {
                minzoom: 'MGLTileSourceOptionMinimumZoomLevel',
                maxzoom: 'MGLTileSourceOptionMaximumZoomLevel',
                tileSize: 'MGLTileSourceOptionTileSize',
                attribution: 'MGLTileSourceOptionAttributionHTMLString',
            };
            let options = _.mapKeys(source, (v, k) => sourceOptionKeys[k]);
            initSourceArgs.options = Literal(_.isEmpty(options) ? options : null);
        } else if ('data' in source) {
            if (typeof source.data === 'string') {
                initSourceArgs.URL = Message(ClassReference('NSURL'), {
                    URLWithString: Literal(source.url),
                }, ClassReference('NSURL', null, null, true));
            } else {
                throw 'Inline GeoJSON not implemented.';
            }
            let sourceOptionKeys = {
                maxzoom: 'MGLShapeSourceOptionMaximumZoomLevel',
                buffer: 'MGLShapeSourceOptionBuffer',
                tolerance: 'MGLShapeSourceOptionSimplificationTolerance',
                cluster: 'MGLShapeSourceOptionClustered',
                clusterRadius: 'MGLShapeSourceOptionClusterRadius',
                clusterMaxZoom: 'MGLShapeSourceOptionMaximumZoomLevelForClustering',
            };
            let options = _.mapKeys(source, (v, k) => sourceOptionKeys[k]);
            initSourceArgs.options = Literal(_.isEmpty(options) ? options : null);
        }
        let initSourceMsg = NewObject(ClassReference(sourceClass), initSourceArgs);
        let statements = [VariableDeclaration(sourceClass, sourceVar, initSourceMsg)];
        if ('source-layer' in source) {
            statements.push(Assignment(KeyPath([sourceVar, 'sourceLayerIdentifier']),
                                       Literal(source['source-layer'])));
        }
        statements.push(Assignment(null, Message(KeyPath(['mapView', 'style']), {
            addSource: sourceVar,
        })));
        return statements;
    },
    removeSource: function (sourceId) {
        let sourceVar = _.camelCase(sourceId) + 'Source';
        let getSourceMsg = Message(KeyPath(['mapView', 'style']), {
            sourceWithIdentifier: Literal(sourceId),
        }, ClassReference('MGLSource', null, null, true));
        let removeSourceMsg = Message(KeyPath(['mapView', 'style']), {
            removeSource: sourceVar,
        });
        return [VariableDeclaration('MGLSource', sourceVar, getSourceMsg),
                Assignment(null, removeSourceMsg)];
    },
    setLayerZoomRange: function (layerId, minZoom, maxZoom) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = Message(KeyPath(['mapView', 'style']), {
            layerWithIdentifier: Literal(layerId),
        }, ClassReference('MGLStyleLayer', null, null, true));
        return [VariableDeclaration('MGLStyleLayer', layerVar, getLayerMsg),
                Assignment(KeyPath([layerVar, 'minimumZoomLevel']), minZoom || 0),
                Assignment(KeyPath([layerVar, 'maximumZoomLevel']), maxZoom || 22)];
    },
    setCenter: function (center) {
        let makeCoordinateCall = StructFactoryFunctionCall('CLLocationCoordinate2D', {
            latitude: Literal(center[1]),
            longitude: Literal(center[0]),
        });
        return [Assignment(KeyPath(['mapView', 'centerCoordinate']), makeCoordinateCall)];
    },
    setZoom: zoom => [Assignment(KeyPath(['mapView', 'zoomLevel']), zoom)],
    setBearing: bearing => [Assignment(KeyPath(['mapView', 'direction']), bearing)],
    setPitch: function (pitch) {
        return [VariableDeclaration('MGLMapCamera', 'camera', KeyPath(['mapView', 'camera'])),
                Assignment(KeyPath(['camera', 'pitch']), pitch),
                Assignment(KeyPath(['mapView', 'camera']), camera)];
    },
};

function diffStylesDarwin(before, after, language, os) {
    let diffs = diffStyles(before, after);
    let statements = [];
    diffs.forEach(function (diff) {
        if (diff.command in operations) {
            diff.args.push(os);
            let substatements = operations[diff.command].apply(null, diff.args);
            statements.push(BlockStatement(substatements));
        } else {
            console.warn(`${diff.command} not yet supported.`);
        }
    });
    // TODO: Avoid redeclaring a variable with the same name but a different type.
    //return _.uniq(statements);
    switch (language) {
        case 'objc':
            return _.invokeMap(statements, 'toObjC').join('\n');
        case 'swift':
            return _.invokeMap(statements, 'toSwift').join('\n');
        default:
            return JSON.stringify(statements, null, 2);
    }
}

module.exports = diffStylesDarwin;
