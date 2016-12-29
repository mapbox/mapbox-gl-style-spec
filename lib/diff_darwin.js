'use strict';

const diffStyles = require('./diff');
const latestStyleSpec = require('../reference/latest.min');

const _ = require('lodash');
const colorParser = require('csscolorparser');

function getLayerType(prop) {
    return _.findKey(latestStyleSpec, prop).replace(/^(?:paint|layout)_/, '');
}

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

function valueToConstantValue(jsValue, propName, prop, propType, os) {
    let type;
    let value;
    switch (propType) {
        case 'boolean':
        case 'number':
            type = 'NSNumber';
            value = valueToLiteral(jsValue, true);
            break;
        case 'string':
            type = 'NSString';
            value = valueToLiteral(jsValue, true);
            break;
        case 'enum':
            type = 'NSValue';
            let enumType = upperCamelCase(propName);
            let args = {};
            args['valueWithMGL' + enumType] = `MGL${enumType}${upperCamelCase(jsValue)}`;
            value = msgSend(type, args);
            break;
        case 'color': {
            type = os === 'ios' ? 'UIColor' : 'NSColor';
            let color = colorParser.parseCSSColor(jsValue);
            let args = {};
            args[`colorWith${os === 'macos' ? 'Calibrated' : ''}Red`] = `${color[0]} / 255.0`;
            args.green = `${color[1]} / 255.0`;
            args.blue = `${color[2]} / 255.0`;
            args.alpha = color[3];
            value = msgSend(type, args);
            break;
        }
        case 'array':
            if (propName.indexOf('padding') !== -1) {
                type = 'NSValue';
                let makeInsetsCall = makeStructCall((os === 'ios' ? 'UI' : 'NS') + 'EdgeInsets', {
                    top: jsValue[0],
                    left: jsValue[3],
                    bottom: jsValue[2],
                    right: jsValue[1],
                });
                let args = {};
                args[`valueWith${os === 'ios' ? 'UI' : ''}EdgeInsets`] = makeInsetsCall;
                value = msgSend(type, args);
            } else if (propName.indexOf('offset') !== -1 || propName.indexOf('translate') !== -1) {
                type = 'NSValue';
                value = msgSend(type, {
                    valueWithCGVector: makeStructCall('CGVector', {
                        dx: jsValue[0],
                        dy: jsValue[1],
                    }),
                });
            } else {
                type = 'NSArray';
                value = collection(_.map(jsValue, function (jsValue) {
                    let params = valueToConstantValue(jsValue, propName, prop, prop.value, os);
                    type = `NSArray<${params[0]} *>`;
                    return params[1];
                }));
            }
            break;
        default:
            throw `Value of type ${propType} not implemented for property ${propName}.`;
    }
    return [type, value];
}

function valueToFunction(jsValue, propName, prop, os) {
    if ('property' in jsValue) {
        throw 'Property functions not supported.';
    }
    
    let type;
    let stops = _.mapValues(_.fromPairs(jsValue.stops), function (jsValue) {
        let params = valueToConstantValue(jsValue, propName, prop, prop.type, os);
        type = params[0];
        return params[1];
    });
    return [type, jsValue.base, stops];
}

function getOverriddenPropertyName(prop, os) {
    // In Objective-C, the is- prefix is only for getter methods, not property names.
    return prop['sdk-name'] && prop['sdk-name'][os] && prop['sdk-name'][os].replace(/^is-/, '');
}

function valueToStyleValue(jsValue, propName, os) {
    let prop = latestStyleSpec[_.findKey(latestStyleSpec, propName)][propName];
    if (jsValue == null) {
        propName = _.camelCase(getOverriddenPropertyName(prop, os) || propName);
        return [propName, 'nil'];
    } else if (typeof jsValue === 'object') {
        let params = valueToFunction(jsValue, propName, prop, os);
        let type = `<${params[0]} *>`,
            base = params[1],
            stops = collection(_.mapKeys(params[2], (v, k) => '@' + k));
        propName = _.camelCase(getOverriddenPropertyName(prop, os) || propName);
        if (base === undefined || base === 1) {
            return [propName, msgSend('MGLStyleValue' + type, {
                valueWithStops: stops,
            })];
        } else {
            return [propName, msgSend('MGLStyleValue' + type, {
                valueWithInterpolationBase: base,
                stops: stops,
            })];
        }
    } else {
        let params = valueToConstantValue(jsValue, propName, prop, prop.type, os);
        let type = `<${params[0]} *>`,
            value = params[1];
        propName = _.camelCase(getOverriddenPropertyName(prop, os) || propName);
        return [propName, msgSend('MGLStyleValue' + type, {
            valueWithRawValue: value,
        })];
    }
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
        _.forEach(layer.layout, function (value, prop) {
            let params = valueToStyleValue(value, prop, os);
            statements.push(varAssignment(keyPath([layerVar, params[0]]), params[1]));
        });
        _.forEach(layer.paint, function (value, prop) {
            let params = valueToStyleValue(value, prop, os);
            statements.push(varAssignment(keyPath([layerVar, params[0]]), params[1]));
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
    setPaintProperty: function (layerId, prop, value, cls, os) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let layerClass = 'MGL' + upperCamelCase(getLayerType(prop)) + 'StyleLayer';
        let getLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let params = valueToStyleValue(value, prop, os);
        return [varDecl(layerClass, layerVar, typeCast(layerClass, getLayerMsg)),
                varAssignment(keyPath([layerVar, params[0]]), params[1])];
    },
    setLayoutProperty: function (layerId, prop, value, cls, os) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let layerClass = 'MGL' + upperCamelCase(getLayerType(prop)) + 'StyleLayer';
        let getLayerMsg = msgSend(keyPath(['mapView', 'style']), {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let params = valueToStyleValue(value, prop, os);
        return [varDecl(layerClass, layerVar, typeCast(layerClass, getLayerMsg)),
                varAssignment(keyPath([layerVar, params[0]]), params[1])];
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
