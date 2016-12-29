'use strict';

const diffStyles = require('./diff');
const latestStyleSpec = require('../reference/latest.min');

const _ = require('lodash');
const colorParser = require('csscolorparser');

function collection(items) {
    if (Array.isArray(items)) {
        return `@[${items.join(', ')}]`;
    } else {
        items = _.map(items, (value, key) => `${key}: ${value}`);
        return `@{${items.join(', ')}}`;
    }
}

function valueToLiteral(jsValue, isObject) {
    if (jsValue == null || jsValue === undefined) {
        return isObject ? '[NSNull null]' : 'nil';
    }
    if (Array.isArray(jsValue)) {
        return collection(_.map(jsValue, value => valueToLiteral(value, true)));
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
            return collection(_.mapValues(_.mapKeys(jsValue, key => valueToLiteral(key, true)),
                                          value => valueToLiteral(value, true)));
        default:
            throw `Cannot convert value ${jsValue} to Objective-C literal.`;
    }
}

function fnCall(fn, args) {
    return `${fn}(${args.join(', ')})`;
}

function makeStructCall(type, args) {
    // Assume that _.map iterates over args in the order the keys were added.
    return fnCall(type + 'Make', _.values(args));
}

function msgSend(receiver, args) {
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
}

function objInit(cls, args) {
    return msgSend(msgSend(cls, 'alloc'), args);
}

function varDecl(type, name, val) {
    return `${type} *${name} = ${val}`;
}

function varAssignment(variable, val) {
    return `${variable} = ${val}`;
};

function typeCast(type, val) {
    return `(${type} *)${val}`;
}

function keyPath(components) {
    return components.join('.');
}

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
            return valueToLiteral(jsValue, true);
        case 'enum':
            let enumType = upperCamelCase(propName);
            let args = {};
            args['valueWithMGL' + enumType] = `MGL${enumType}${upperCamelCase(jsValue)}`;
            return msgSend(type, args);
        case 'color': {
            let color = colorParser.parseCSSColor(jsValue);
            let args = {};
            args[`colorWith${os === 'macos' ? 'Calibrated' : ''}Red`] = `${color[0]} / 255.0`;
            args.green = `${color[1]} / 255.0`;
            args.blue = `${color[2]} / 255.0`;
            args.alpha = color[3];
            return msgSend(type, args);
        }
        case 'array':
            if (propName.indexOf('padding') !== -1) {
                let makeInsetsCall = makeStructCall((os === 'ios' ? 'UI' : 'NS') + 'EdgeInsets', {
                    top: jsValue[0],
                    left: jsValue[3],
                    bottom: jsValue[2],
                    right: jsValue[1],
                });
                let args = {};
                args[`valueWith${os === 'ios' ? 'UI' : ''}EdgeInsets`] = makeInsetsCall;
                return msgSend(type, args);
            } else if (propName.indexOf('offset') !== -1 || propName.indexOf('translate') !== -1) {
                return msgSend(type, {
                    valueWithCGVector: makeStructCall('CGVector', {
                        dx: jsValue[0],
                        dy: jsValue[1],
                    }),
                });
            } else {
                return collection(_.map(jsValue, function (jsValue) {
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
        fn.stops = collection(_.mapKeys(fn.stops, (v, k) => '@' + k));
        if (fn.base === undefined || fn.base === 1) {
            return msgSend(`MGLStyleValue<${type} *>`, {
                valueWithStops: fn.stops,
            });
        } else {
            return msgSend(`MGLStyleValue<${type} *>`, {
                valueWithInterpolationBase: fn.base,
                stops: fn.stops,
            });
        }
    } else {
        let type = getPropertyType(propName, prop, os);
        let value = valueToConstantValue(jsValue, propName, prop, os);
        return msgSend(`MGLStyleValue<${type} *>`, {
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
        leftArg = valueToLiteral(left);
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
            initWithIdentifier: valueToLiteral(layer.id),
        };
        let beforeLayerVar = _.camelCase(beforeLayerId) + 'Layer';
        let sourceDecl;
        if ('source' in layer) {
            let sourceVar = _.camelCase(layer.source) + 'Source';
            let getSourceMsg = msgSend(keyPath(['mapView', 'style']), {
                sourceWithIdentifier: valueToLiteral(layer.source),
            });
            sourceDecl = varDecl('MGLSource', sourceVar, getSourceMsg);
            layerInitArgs.source = sourceVar;
        }
        let layerInitMsg = objInit(layerClass, layerInitArgs);
        let getBeforeLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            layerWithIdentifier: valueToLiteral(beforeLayerId),
        });
        let insertLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            insertLayer: layerVar,
            belowLayer: beforeLayerVar,
        });
        let statements = [varDecl(layerClass, layerVar, layerInitMsg),
                          varDecl('MGLStyleLayer', beforeLayerVar, getBeforeLayerMsg)];
        _.forEach(layer.layout, function (jsValue, jsPropName) {
            let propName = getLayerPropertyName(jsPropName, os);
            let value = valueToStyleValue(jsValue, jsPropName, os);
            statements.push(varAssignment(keyPath([layerVar, propName]), value));
        });
        _.forEach(layer.paint, function (jsValue, jsPropName) {
            let propName = getLayerPropertyName(jsPropName, os);
            let value = valueToStyleValue(jsValue, jsPropName, os);
            statements.push(varAssignment(keyPath([layerVar, propName]), value));
        });
        statements.push(insertLayerMsg);
        if (sourceDecl) {
            statements.unshift(sourceDecl);
        }
        return statements;
    },
    removeLayer: function (layerId) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let removeLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            removeLayer: layerVar,
        });
        return [varDecl('MGLStyleLayer', layerVar, getLayerMsg),
                removeLayerMsg];
    },
    setLayerOrPaintProperty: function (layerId, jsPropName, jsValue, cls, os) {
        let layerClass = getLayerClassByProperty(jsPropName);
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let propName = getLayerPropertyName(jsPropName, os);
        let value = valueToStyleValue(jsValue, jsPropName, os);
        return [varDecl(layerClass, layerVar, typeCast(layerClass, getLayerMsg)),
                varAssignment(keyPath([layerVar, propName]), value)];
    },
    setPaintProperty: function (layerId, jsPropName, jsValue, cls, os) {
        return operations.setLayerOrPaintProperty(layerId, jsPropName, jsValue, cls, os);
    },
    setLayoutProperty: function (layerId, jsPropName, jsValue, cls, os) {
        return operations.setLayerOrPaintProperty(layerId, jsPropName, jsValue, cls, os);
    },
    setFilter: function (layerId, filter) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let args = filterToPredicate(filter);
        args[0] = valueToLiteral(args[0]);
        let predicateMsg = msgSend('NSPredicate', {
            predicateWithFormat: args,
        });
        return [varDecl('MGLVectorStyleLayer', layerVar, typeCast('MGLVectorStyleLayer', getLayerMsg)),
                varAssignment(keyPath([layerVar, 'predicate']), predicateMsg)];
    },
    addSource: function (sourceId, source) {
        let sourceVar = _.camelCase(source.id) + 'Source';
        let sourceClass = getSourceClass(source);
        let initSourceArgs = {
            initWithIdentifier: valueToLiteral(sourceId),
        };
        if ('url' in source) {
            initSourceArgs.configurationURL = msgSend('NSURL', {
                URLWithString: valueToLiteral(source.url),
            });
            if ('tileSize' in source) {
                initSourceArgs.tileSize = valueToLiteral(source.tileSize);
            }
        } else if ('tiles' in source) {
            initSourceArgs.tileURLTemplates = valueToLiteral(source.tiles);
            let sourceOptionKeys = {
                minzoom: 'MGLTileSourceOptionMinimumZoomLevel',
                maxzoom: 'MGLTileSourceOptionMaximumZoomLevel',
                tileSize: 'MGLTileSourceOptionTileSize',
                attribution: 'MGLTileSourceOptionAttributionHTMLString',
            };
            let options = _.mapKeys(source, (v, k) => sourceOptionKeys[k]);
            initSourceArgs.options = valueToLiteral(_.isEmpty(options) ? options : null);
        } else if ('data' in source) {
            if (typeof source.data === 'string') {
                initSourceArgs.URL = msgSend('NSURL', {
                    URLWithString: valueToLiteral(source.url),
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
            initSourceArgs.options = valueToLiteral(_.isEmpty(options) ? options : null);
        }
        let initSourceMsg = objInit(sourceClass, initSourceArgs);
        let statements = [varDecl(sourceClass, sourceVar, initSourceMsg)];
        if ('source-layer' in source) {
            statements.push(varAssignment(keyPath([sourceVar, 'sourceLayerIdentifier']),
                                          valueToLiteral(source['source-layer'])));
        }
        statements.push(msgSend(keyPath(['mapView', 'style']), {
            addSource: sourceVar,
        }));
        return statements;
    },
    removeSource: function (sourceId) {
        let sourceVar = _.camelCase(sourceId) + 'Source';
        let getSourceMsg = msgSend(keyPath(['mapView', 'style']), {
            sourceWithIdentifier: valueToLiteral(sourceId),
        });
        let removeSourceMsg = msgSend(keyPath(['mapView', 'style']), {
            removeSource: sourceVar,
        });
        return [varDecl('MGLSource', sourceVar, getSourceMsg),
                removeSourceMsg];
    },
    setLayerZoomRange: function (layerId, minZoom, maxZoom) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        return [varDecl('MGLStyleLayer', layerVar, getLayerMsg),
                varAssignment(keyPath([layerVar, 'minimumZoomLevel']), minZoom || 0),
                varAssignment(keyPath([layerVar, 'maximumZoomLevel']), maxZoom || 22)];
    },
    setCenter: function (center) {
        let makeCoordinateCall = makeStructCall('CLLocationCoordinate2D', {
            latitude: center[1],
            longitude: center[0],
        });
        return [varAssignment(keyPath(['mapView', 'centerCoordinate']), makeCoordinateCall)];
    },
    setZoom: zoom => [varAssignment(keyPath(['mapView', 'zoomLevel']), zoom)],
    setBearing: bearing => [varAssignment(keyPath(['mapView', 'direction']), bearing)],
    setPitch: function (pitch) {
        return [varDecl('MGLMapCamera', 'camera', keyPath(['mapView', 'camera'])),
                varAssignment(keyPath(['camera', 'pitch']), pitch),
                varAssignment(keyPath(['mapView', 'camera']), camera)];
    },
};

function diffStylesDarwin(before, after, language, os) {
    let diffs = diffStyles(before, after);
    let statements = [];
    diffs.forEach(function (diff) {
        if (diff.command in operations) {
            diff.args.push(os);
            let statement = _.map(operations[diff.command].apply(null, diff.args), s => `\t${s};`);
            statement.unshift('{');
            statement.push('}');
            Array.prototype.push.apply(statements, statement);
        } else {
            console.warn(`${diff.command} not yet supported.`);
        }
    });
    // TODO: Avoid redeclaring a variable with the same name but a different type.
    //return _.uniq(statements);
    return statements;
}

module.exports = diffStylesDarwin;
