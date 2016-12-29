'use strict';

const diffStyles = require('./diff');
const latestStyleSpec = require('../reference/latest.min');

const _ = require('lodash');
const colorParser = require('csscolorparser');

function Collection(items) {
    if (!(this instanceof Collection)) {
        return new Collection(items);
    }
    this.items = items;
}

Collection.prototype.toString = function () {
    let items = this.items;
    if (Array.isArray(items)) {
        return `@[${items.join(', ')}]`;
    } else {
        items = _.map(items, (value, key) => `${key}: ${value}`);
        return `@{${items.join(', ')}}`;
    }
};

function Literal(jsValue, isObject) {
    if (!(this instanceof Literal)) {
        return new Literal(jsValue, isObject);
    }
    this.jsValue = jsValue;
    this.isObject = isObject;
}

Literal.prototype.toString = function () {
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
    this.name = name;
    this.args = args;
}

FunctionCall.prototype.toString = function () {
    return `${this.name}(${this.args.join(', ')})`;
};

function StructFactoryFunctionCall(type, args) {
    if (!(this instanceof StructFactoryFunctionCall)) {
        return new StructFactoryFunctionCall(type, args);
    }
    // Assume that _.map iterates over args in the order the keys were added.
    FunctionCall.call(this, type + 'Make', _.values(args));
}

StructFactoryFunctionCall.prototype = Object.create(FunctionCall.prototype);
StructFactoryFunctionCall.prototype.constructor = StructFactoryFunctionCall;

function Message(receiver, args) {
    if (!(this instanceof Message)) {
        return new Message(receiver, args);
    }
    this.receiver = receiver;
    this.args = args;
}

Message.prototype.toString = function () {
    let receiver = this.receiver;
    let args = this.args;
    // Assume that _.map iterates over args in the order the keys were added.
    let pieces;
    if (typeof args === 'string') {
        pieces = [args];
    } else {
        pieces = _.map(args, function (v, arg) {
            if (Array.isArray(v)) {
                v = v.join(', ');
            }
            return _.endsWith(arg, ':') ? (arg + v) : `${arg}:${v}`;
        });
    }
    pieces.unshift(receiver);
    return `[${pieces.join(' ')}]`;
};

function ObjectCreation(cls, args) {
    if (!(this instanceof ObjectCreation)) {
        return new ObjectCreation(cls, args);
    }
    Message.call(this, Message(cls, 'alloc'), args);
}

ObjectCreation.prototype = Object.create(Message.prototype);
ObjectCreation.prototype.constructor = ObjectCreation;

function TypeCoercion(type, val) {
    if (!(this instanceof TypeCoercion)) {
        return new TypeCoercion(type, val);
    }
    this.type = type;
    this.val = val;
}

TypeCoercion.prototype.toString = function () {
    return `(${this.type} *)${this.val}`;
};

function KeyPath(components) {
    if (!(this instanceof KeyPath)) {
        return new KeyPath(components);
    }
    this.components = components;
}

KeyPath.prototype.toString = function () {
    return this.components.join('.');
};

function Statement() {
    if (!(this instanceof Statement)) {
        return new Statement();
    }
}

function VariableDeclaration(type, name, val) {
    if (!(this instanceof VariableDeclaration)) {
        return new VariableDeclaration(type, name, val);
    }
    Statement.call(this);
    this.type = type;
    this.name = name;
    this.val = val;
}

VariableDeclaration.prototype = Object.create(Statement.prototype);
VariableDeclaration.prototype.constructor = VariableDeclaration;
VariableDeclaration.prototype.toString = function () {
    return `${this.type} *${this.name} = ${this.val}`;
};

function Assignment(variable, val) {
    if (!(this instanceof Assignment)) {
        return new Assignment(variable, val);
    }
    Statement.call(this);
    this.variable = variable;
    this.val = val;
};

Assignment.prototype = Object.create(Statement.prototype);
Assignment.prototype.constructor = Assignment;
Assignment.prototype.toString = function () {
    return this.variable ? `${this.variable} = ${this.val}` : this.val.toString();
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
            return `NSArray<${getPropertyType(propName, {type: prop.value}, os)}>`;
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
        let layerClass = 'MGL' + upperCamelCase(layer.type) + 'StyleLayer';
        let layerInitArgs = {
            initWithIdentifier: Literal(layer.id),
        };
        let beforeLayerVar = _.camelCase(beforeLayerId) + 'Layer';
        let sourceDecl;
        if ('source' in layer) {
            let sourceVar = _.camelCase(layer.source) + 'Source';
            let getSourceMsg = Message(KeyPath(['mapView', 'style']), {
                sourceWithIdentifier: Literal(layer.source),
            });
            sourceDecl = VariableDeclaration('MGLSource', sourceVar, getSourceMsg);
            layerInitArgs.source = sourceVar;
        }
        let layerInitMsg = ObjectCreation(layerClass, layerInitArgs);
        let getBeforeLayerMsg = Message(KeyPath(['mapView', 'style']), {
            layerWithIdentifier: Literal(beforeLayerId),
        });
        let insertLayerMsg = Message(KeyPath(['mapView', 'style']), {
            insertLayer: layerVar,
            belowLayer: beforeLayerVar,
        });
        let statements = [VariableDeclaration(layerClass, layerVar, layerInitMsg),
                          VariableDeclaration('MGLStyleLayer', beforeLayerVar, getBeforeLayerMsg)];
        _.forEach(layer.layout, function (jsValue, jsPropName) {
            let propName = getLayerPropertyName(jsPropName, os);
            let value = valueToStyleValue(jsValue, jsPropName, os);
            statements.push(Assignment(KeyPath([layerVar, propName]), value));
        });
        _.forEach(layer.paint, function (jsValue, jsPropName) {
            let propName = getLayerPropertyName(jsPropName, os);
            let value = valueToStyleValue(jsValue, jsPropName, os);
            statements.push(Assignment(KeyPath([layerVar, propName]), value));
        });
        statements.push(insertLayerMsg);
        if (sourceDecl) {
            statements.unshift(sourceDecl);
        }
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
        let initSourceMsg = ObjectCreation(sourceClass, initSourceArgs);
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
            statements.push('{');
            diff.args.push(os);
            _.forEach(operations[diff.command].apply(null, diff.args), function (stmt) {
                statements.push(' '.repeat(4) + stmt + ';');
            });
            statements.push('}');
        } else {
            console.warn(`${diff.command} not yet supported.`);
        }
    });
    // TODO: Avoid redeclaring a variable with the same name but a different type.
    //return _.uniq(statements);
    return statements.join('\n');
}

module.exports = diffStylesDarwin;
