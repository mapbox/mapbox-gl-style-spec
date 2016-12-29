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
            if (value.toObjC) {
                value = value.toObjC();
            }
            if (key.toObjC) {
                key = key.toObjC();
            }
            return `${key}: ${value}`;
        });
        return `@{${items.join(', ')}}`;
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

function FunctionCall(name, args) {
    if (!(this instanceof FunctionCall)) {
        return new FunctionCall(name, args);
    }
    this.type = 'function-call';
    this.name = name;
    this.args = args;
}

FunctionCall.prototype.toObjC = function () {
    return `${this.name}(${this.args.join(', ')})`;
};

function StructFactoryFunctionCall(struct, args) {
    if (!(this instanceof StructFactoryFunctionCall)) {
        return new StructFactoryFunctionCall(struct, args);
    }
    // Assume that _.map iterates over args in the order the keys were added.
    FunctionCall.call(this, struct + 'Make', _.values(args));
    this.type = 'struct-factory-function-call';
}

StructFactoryFunctionCall.prototype = Object.create(FunctionCall.prototype);
StructFactoryFunctionCall.prototype.constructor = StructFactoryFunctionCall;

function Message(receiver, args) {
    if (!(this instanceof Message)) {
        return new Message(receiver, args);
    }
    this.type = 'message';
    this.receiver = receiver;
    this.args = args;
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
            return _.endsWith(arg, ':') ? (arg + v) : `${arg}:${v}`;
        });
    }
    pieces.unshift(receiver);
    return `[${pieces.join(' ')}]`;
};

function NewObject(cls, args) {
    if (!(this instanceof NewObject)) {
        return new NewObject(cls, args);
    }
    Message.call(this, Message(cls, 'alloc'), args);
    this.type = 'new-object';
}

NewObject.prototype = Object.create(Message.prototype);
NewObject.prototype.constructor = NewObject;

function TypeCoercion(coercedType, val) {
    if (!(this instanceof TypeCoercion)) {
        return new TypeCoercion(coercedType, val);
    }
    this.type = 'type-coercion';
    this.coercedType = coercedType;
    this.val = val;
}

TypeCoercion.prototype.toObjC = function () {
    return `(${this.coercedType} *)${this.val.toObjC()}`;
};

function KeyPath(components) {
    if (!(this instanceof KeyPath)) {
        return new KeyPath(components);
    }
    this.type = 'key-path';
    this.components = components;
}

KeyPath.prototype.toObjC = function () {
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

function upperCamelCase(str) {
    return _.upperFirst(_.camelCase(str));
}

function getPropertyType(propName, prop, os) {
    switch (prop.type) {
        case 'boolean':
        case 'number':
            return 'NSNumber';
        case 'string':
            return 'NSString';
        case 'enum':
            return 'NSValue';
        case 'color':
            return os === 'ios' ? 'UIColor' : 'NSColor';
        case 'array':
            if (propName.match(/-(?:padding|offset|translate)$/)) {
                return 'NSValue';
            }
            return `NSArray<${getPropertyType(propName, {type: prop.value}, os)} *>`;
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
            let enumType = upperCamelCase(propName);
            let args = {};
            args['valueWithMGL' + enumType] = `MGL${enumType}${upperCamelCase(jsValue)}`;
            return Message(type, args);
        case 'color': {
            let color = colorParser.parseCSSColor(jsValue);
            let args = {};
            args[`colorWith${os === 'macos' ? 'Calibrated' : ''}Red`] = `${color[0]} / 255.0`;
            args.green = `${color[1]} / 255.0`;
            args.blue = `${color[2]} / 255.0`;
            args.alpha = color[3];
            return Message(type, args);
        }
        case 'array':
            if (propName.indexOf('padding') !== -1) {
                let makeInsetsCall = StructFactoryFunctionCall((os === 'ios' ? 'UI' : 'NS') + 'EdgeInsets', {
                    top: jsValue[0],
                    left: jsValue[3],
                    bottom: jsValue[2],
                    right: jsValue[1],
                });
                let args = {};
                args[`valueWith${os === 'ios' ? 'UI' : ''}EdgeInsets`] = makeInsetsCall;
                return Message(type, args);
            } else if (propName.indexOf('offset') !== -1 || propName.indexOf('translate') !== -1) {
                return Message(type, {
                    valueWithCGVector: StructFactoryFunctionCall('CGVector', {
                        dx: jsValue[0],
                        dy: jsValue[1],
                    }),
                });
            } else {
                return Collection(_.map(jsValue, function (jsValue) {
                    return valueToConstantValue(jsValue, propName, {type: prop.value}, os);
                }));
            }
        default:
            throw `Value of type ${propType} not implemented for property ${propName}.`;
    }
}

function valueToFunction(jsValue, propName, prop, os) {
    if ('property' in jsValue) {
        throw 'Property functions not supported.';
    }
    
    return {
        base: jsValue.base,
        stops: _.mapValues(_.fromPairs(jsValue.stops), function (jsValue) {
            return valueToConstantValue(jsValue, propName, prop, os);
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
        let type = getPropertyType(propName, prop, os);
        let fn = valueToFunction(jsValue, propName, prop, os);
        fn.stops = Collection(_.mapKeys(fn.stops, (v, k) => '@' + k));
        if (fn.base === undefined || fn.base === 1) {
            return Message(`MGLStyleValue<${type} *>`, {
                valueWithStops: fn.stops,
            });
        } else {
            return Message(`MGLStyleValue<${type} *>`, {
                valueWithInterpolationBase: fn.base,
                stops: fn.stops,
            });
        }
    } else {
        let type = getPropertyType(propName, prop, os);
        let value = valueToConstantValue(jsValue, propName, prop, os);
        return Message(`MGLStyleValue<${type} *>`, {
            valueWithRawValue: value,
        });
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
        let layerInitMsg = NewObject(layerClass, layerInitArgs);
        statements.unshift(VariableDeclaration(layerClass, layerVar, layerInitMsg));
        if (sourceId) {
            let getSourceMsg = Message(KeyPath(['mapView', 'style']), {
                sourceWithIdentifier: Literal(layer.source),
            });
            statements.unshift(VariableDeclaration('MGLSource', sourceVar, getSourceMsg));
        }
        if (refLayerId) {
            if (layerClass !== 'MGLBackgroundStyleLayer') {
                let layerSourceVar = refLayerVar + 'Source';
                let getSourceMsg = Message(KeyPath(['mapView', 'style']), {
                    sourceWithIdentifier: KeyPath([refLayerVar, 'sourceIdentifier']),
                });
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
            });
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
            });
            statements.push(VariableDeclaration('MGLStyleLayer', beforeLayerVar, getBeforeLayerMsg));
        }
        let insertLayerMsg = Message(KeyPath(['mapView', 'style']), {
            insertLayer: layerVar,
            belowLayer: beforeLayerVar,
        });
        statements.push(insertLayerMsg);
        return statements;
    },
    removeLayer: function (layerId) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = Message(KeyPath(['mapView', 'style']), {
            layerWithIdentifier: Literal(layerId),
        });
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
        });
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
        });
        let args = filterToPredicate(filter);
        args[0] = Literal(args[0]);
        let predicateMsg = Message('NSPredicate', {
            predicateWithFormat: args,
        });
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
            initSourceArgs.configurationURL = Message('NSURL', {
                URLWithString: Literal(source.url),
            });
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
                initSourceArgs.URL = Message('NSURL', {
                    URLWithString: Literal(source.url),
                });
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
        let initSourceMsg = NewObject(sourceClass, initSourceArgs);
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
        });
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
        });
        return [VariableDeclaration('MGLStyleLayer', layerVar, getLayerMsg),
                Assignment(KeyPath([layerVar, 'minimumZoomLevel']), minZoom || 0),
                Assignment(KeyPath([layerVar, 'maximumZoomLevel']), maxZoom || 22)];
    },
    setCenter: function (center) {
        let makeCoordinateCall = StructFactoryFunctionCall('CLLocationCoordinate2D', {
            latitude: center[1],
            longitude: center[0],
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
        default:
            return JSON.stringify(statements, null, 2);
    }
}

module.exports = diffStylesDarwin;
