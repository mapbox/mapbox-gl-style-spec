'use strict';

const diffStyles = require('./diff');
const latestStyleSpec = require('../reference/latest.min');

const _ = require('lodash');
const colorParser = require('csscolorparser');

function getLayerType(prop) {
    return _.findKey(latestStyleSpec, prop).replace(/^(?:paint|layout)_/, '');
}

function valueToLiteral(jsValue, isObject) {
    if (jsValue == null || jsValue === undefined) {
        return isObject ? '[NSNull null]' : 'nil';
    }
    if (Array.isArray(jsValue)) {
        let literals = _.map(jsValue, value => valueToLiteral(value, true));
        return `@[${literals.join(', ')}]`;
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
            let literals = _.map(jsValue, (value, key) => `${valueToLiteral(key, true)}: ${valueToLiteral(value, true)}`);
            return `@{${items.join(', ')}}`;
        default:
            throw `Cannot convert value ${jsValue} to Objective-C literal.`;
    }
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

function fnCall(fn, args) {
    return `${fn}(${args.join(', ')})`;
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
            let enumType = _.capitalize(_.camelCase(propName));
            let args = {};
            args['valueWithMGL' + enumType] = `${enumType}${_.capitalize(_.camelCase(jsValue))}`;
            value = msgSend(type, args);
            break;
        case 'color': {
            type = os === 'ios' ? 'UIColor' : 'NSColor';
            let color = colorParser.parseCSSColor(jsValue);
            let args = {};
            args[`colorWith${os === 'macos' ? 'Calibrated' : ''}Red`] = color[0] / 255;
            args.green = color[1] / 255;
            args.blue = color[2] / 255;
            args.alpha = color[3];
            value = msgSend(type, args);
            break;
        }
        case 'array':
            if (propName.indexOf('padding') !== -1) {
                type = 'NSValue';
                let makeInsetsCall = fnCall((os === 'ios' ? 'UI' : 'NS') + 'EdgeInsetsMake',
                                            [jsValue[0], jsValue[3], jsValue[2], jsValue[1]]);
                let args = {};
                args[`valueWith${os === 'ios' ? 'UI' : ''}EdgeInsets`] = makeInsetsCall;
                value = msgSend(type, args);
            } else if (propName.indexOf('offset') !== -1 || propName.indexOf('translate') !== -1) {
                type = 'NSValue';
                value = msgSend(type, {
                    valueWithCGVector: fnCall('CGVectorMake', [jsValue[0], jsValue[1]]),
                });
            } else {
                type = 'NSArray';
                value = '@[' + _.map(jsValue, function (jsValue) {
                    let params = valueToConstantValue(jsValue, propName, prop, prop.value, os);
                    type = `NSArray<${params[0]} *>`;
                    return params[1];
                }).join(', ') + ']';
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
    let stops = _.map(jsValue.stops, function (stop) {
        let jsValue = stop[1];
        let params = valueToConstantValue(jsValue, propName, prop, prop.type, os);
        type = params[0];
        return [stop[0], params[1]];
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
            stops = '@{' + _.map(params[2], function (stop) {
                return `${valueToLiteral(stop[0], true)}: ${stop[1]}`;
            }).join(', ') + '}';
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
    addLayer: function (layer, beforeLayerId) {
        let layerVar = _.camelCase(layer.id) + 'Layer';
        let layerClass = 'MGL' + _.capitalize(_.camelCase(layer.type)) + 'StyleLayer';
        let layerInitArgs = {
            initWithIdentifier: valueToLiteral(layer.id),
        };
        let beforeLayerVar = _.camelCase(beforeLayerId) + 'Layer';
        let sourceDecl;
        if ('source' in layer) {
            let sourceVar = _.camelCase(layer.source) + 'Source';
            let getSourceMsg = msgSend('mapView.style', {
                sourceWithIdentifier: valueToLiteral(layer.source),
            });
            sourceDecl = `MGLSource *${sourceVar} = ${getSourceMsg}`;
            layerInitArgs.source = sourceVar;
        }
        let layerInitMsg = msgSend(msgSend(layerClass, 'alloc'), layerInitArgs);
        let getBeforeLayerMsg = msgSend('mapView.style', {
            layerWithIdentifier: valueToLiteral(beforeLayerId),
        });
        let insertLayerMsg = msgSend('mapView.style', {
            insertLayer: layerVar,
            belowLayer: beforeLayerVar,
        });
        let statements = [`${layerClass} *${layerVar} = ${layerInitMsg}`,
                          `MGLStyleLayer *${beforeLayerVar} = ${getBeforeLayerMsg}`,
                          insertLayerMsg];
        if (sourceDecl) {
            statements.unshift(sourceDecl);
        }
        return statements;
    },
    removeLayer: function (layerId) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = msgSend('mapView.style', {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let removeLayerMsg = msgSend('mapView.style', {
            removeLayer: layerVar,
        });
        return [`MGLStyleLayer *${layerVar} = ${getLayerMsg}`,
                removeLayerMsg];
    },
    setPaintProperty: function (layerId, prop, value, cls, os) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let layerClass = 'MGL' + _.capitalize(_.camelCase(getLayerType(prop))) + 'StyleLayer';
        let getLayerMsg = msgSend('mapView.style', {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let params = valueToStyleValue(value, prop, os);
        return [`${layerClass} *${layerVar} = (${layerClass} *)${getLayerMsg}`,
                `${layerVar}.${params[0]} = ${params[1]}`];
    },
    setLayoutProperty: function (layerId, prop, value, cls, os) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let layerClass = 'MGL' + _.capitalize(_.camelCase(getLayerType(prop))) + 'StyleLayer';
        let getLayerMsg = msgSend('mapView.style', {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let params = valueToStyleValue(value, prop, os);
        return [`${layerClass} *${layerVar} = (${layerClass} *)${getLayerMsg}`,
                `${layerVar}.${params[0]} = ${params[1]}`];
    },
    setFilter: function (layerId, filter) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = msgSend('mapView.style', {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        let args = filterToPredicate(filter);
        args[0] = valueToLiteral(args[0]);
        let predicateMsg = msgSend('NSPredicate', {
            predicateWithFormat: args,
        });
        return [`MGLVectorStyleLayer *${layerVar} = (MGLVectorStyleLayer *)${getLayerMsg}`,
                `${layerVar}.predicate = ${predicateMsg}`];
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
        let initSourceMsg = msgSend(msgSend(sourceClass, 'alloc'), initSourceArgs);
        let statements = [`${sourceClass} *${sourceVar} = ${initSourceMsg}`];
        if ('source-layer' in source) {
            statements.push(`${sourceVar}.sourceLayerIdentifier = ${valueToLiteral(source['source-layer'])}`);
        }
        statements.push(msgSend('mapView.style', {
            addSource: sourceVar,
        }));
        return statements;
    },
    removeSource: function (sourceId) {
        let sourceVar = _.camelCase(sourceId) + 'Source';
        let getSourceMsg = msgSend('mapView.style', {
            sourceWithIdentifier: valueToLiteral(sourceId),
        });
        let removeSourceMsg = msgSend('mapView.style', {
            removeSource: sourceVar,
        });
        return [`MGLSource *${sourceVar} = ${getSourceMsg}`,
                removeSourceMsg];
    },
    setLayerZoomRange: function (layerId, minZoom, maxZoom) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = msgSend('mapView.style', {
            layerWithIdentifier: valueToLiteral(layerId),
        });
        return [`MGLStyleLayer *${layerVar} = ${getLayerMsg}`,
                `${layerVar}.minimumZoomLevel = ${minZoom || 0}`,
                `${layerVar}.maximumZoomLevel = ${maxZoom || 22}`];
    },
    setCenter: function (center) {
        let makeCoordinateCall = fnCall('CLLocationCoordinate2DMake', [center[1], center[0]]);
        return [`mapView.centerCoordinate = ${makeCoordinateCall}`];
    },
    setZoom: zoom => [`mapView.zoomLevel = ${zoom}`],
    setBearing: bearing => [`mapView.direction = ${bearing}`],
    setPitch: function (pitch) {
        return [`MGLMapCamera *camera = mapView.camera`,
                `camera.pitch = ${pitch}`,
                `mapView.camera = camera`];
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
