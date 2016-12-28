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
            value = `[NSValue valueWithMGL${enumType}:${enumType}${_.capitalize(_.camelCase(jsValue))}]`;
            break;
        case 'color': {
            type = os === 'ios' ? 'UIColor' : 'NSColor';
            let color = colorParser.parseCSSColor(jsValue);
            value = `[${type} colorWith${os === 'macos' ? 'Calibrated' : ''}Red:${color[0] / 255} green:${color[1] / 255} blue:${color[2] / 255} alpha:${color[3]}]`;
            break;
        }
        case 'array':
            if (propName.indexOf('padding') !== -1) {
                type = 'NSValue';
                let insets = `${os === 'ios' ? 'UI' : 'NS'}EdgeInsetsMake(${jsValue[0]}, ${jsValue[3]}, ${jsValue[2]}, ${jsValue[1]})`;
                value = `[NSValue valueWith${os === 'ios' ? 'UI' : ''}EdgeInsets:${insets}]`;
            } else if (propName.indexOf('offset') !== -1 || propName.indexOf('translate') !== -1) {
                type = 'NSValue';
                let vector = `CGVectorMake(${jsValue[0]}, ${jsValue[1]})`;
                value = `[NSValue valueWithCGVector:${vector}]`;
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
            return [propName, `[MGLStyleValue${type} valueWithStops:${stops}]`];
        } else {
            return [propName, `[MGLStyleValue${type} valueWithInterpolationBase:${base} stops:${stops}]`];
        }
    } else {
        let params = valueToConstantValue(jsValue, propName, prop, prop.type, os);
        let type = `<${params[0]} *>`,
            value = params[1];
        propName = _.camelCase(getOverriddenPropertyName(prop, os) || propName);
        return [propName, `[MGLStyleValue${type} valueWithRawValue:${value}]`];
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
        let beforeLayerVar = _.camelCase(beforeLayerId) + 'Layer';
        let sourceDecl;
        let sourceArg = '';
        if ('source' in layer) {
            let sourceVar = _.camelCase(layer.source) + 'Source';
            sourceDecl = `MGLSource *${sourceVar} = [mapView.style sourceWithIdentifier:${valueToLiteral(layer.source)}];`;
            sourceArg = ` source:${sourceVar}`;
        }
        let statements = [`${layerClass} *${layerVar} = [[${layerClass} alloc] initWithIdentifier:${valueToLiteral(layer.id)}${sourceArg}];`,
                          `MGLStyleLayer *${beforeLayerVar} = [mapView.style layerWithIdentifier:${valueToLiteral(beforeLayerId)}];`,
                          `[mapView.style insertLayer:${layerVar} belowLayer:${beforeLayerVar}];`];
        if (sourceDecl) {
            statements.unshift(sourceDecl);
        }
        return statements;
    },
    removeLayer: function (layerId) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        return [`MGLStyleLayer *${layerVar} = [mapView.style layerWithIdentifier:${valueToLiteral(layerId)}];`,
                `[mapView.style removeLayer:${layerVar}];`];
    },
    setPaintProperty: function (layerId, prop, value, cls, os) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let layerClass = 'MGL' + _.capitalize(_.camelCase(getLayerType(prop))) + 'StyleLayer';
        let params = valueToStyleValue(value, prop, os);
        return [`${layerClass} *${layerVar} = (${layerClass} *)[mapView.style layerWithIdentifier:${valueToLiteral(layerId)}];`,
                `${layerVar}.${params[0]} = ${params[1]};`];
    },
    setLayoutProperty: function (layerId, prop, value, cls, os) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let layerClass = 'MGL' + _.capitalize(_.camelCase(getLayerType(prop))) + 'StyleLayer';
        let params = valueToStyleValue(value, prop, os);
        return [`${layerClass} *${layerVar} = (${layerClass} *)[mapView.style layerWithIdentifier:${valueToLiteral(layerId)}];`,
                `${layerVar}.${params[0]} = ${params[1]};`];
    },
    setFilter: function (layerId, filter) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let args = filterToPredicate(filter);
        args[0] = valueToLiteral(args[0]);
        return [`MGLVectorStyleLayer *${layerVar} = (MGLVectorStyleLayer *)[mapView.style layerWithIdentifier:${valueToLiteral(layerId)}];`,
                `${layerVar}.predicate = [NSPredicate predicateWithFormat:${args.join(', ')}];`];
    },
    addSource: function (sourceId, source) {
        let sourceVar = _.camelCase(source.id) + 'Source';
        let sourceClass = getSourceClass(source);
        let args = [];
        if ('url' in source) {
            args.push(` configurationURL:[NSURL URLWithString:${valueToLiteral(source.url)}]`);
            if ('tileSize' in source) {
                args.push(` tileSize:${source.tileSize}`);
            }
        } else if ('tiles' in source) {
            args.push(` tileURLTemplates:${valueToLiteral(source.tiles)}`);
            let sourceOptionKeys = {
                minzoom: 'MGLTileSourceOptionMinimumZoomLevel',
                maxzoom: 'MGLTileSourceOptionMaximumZoomLevel',
                tileSize: 'MGLTileSourceOptionTileSize',
                attribution: 'MGLTileSourceOptionAttributionHTMLString',
            };
            let options = _.mapKeys(source, (v, k) => sourceOptionKeys[k]);
            args.push(` options:${valueToLiteral(_.isEmpty(options) ? options : null)}`);
        } else if ('data' in source) {
            if (typeof source.data === 'string') {
                args.push(` URL:[NSURL URLWithString:${valueToLiteral(source.url)}]`);
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
            args.push(` options:${valueToLiteral(_.isEmpty(options) ? options : null)}`);
        }
        let statements = [`${sourceClass} *${sourceVar} = [${sourceClass} sourceWithIdentifier:${valueToLiteral(sourceId)}${args.join('')}];`];
        if ('source-layer' in source) {
            statements.push(`${sourceVar}.sourceLayerIdentifier = ${valueToLiteral(source['source-layer'])};`);
        }
        statements.push(`[mapView.style addSource:${sourceVar}];`);
        return statements;
    },
    removeSource: function (sourceId) {
        let sourceVar = _.camelCase(sourceId) + 'Source';
        return [`MGLSource *${sourceVar} = [mapView.style sourceWithIdentifier:${valueToLiteral(sourceId)}];`,
                `[mapView.style removeSource:${sourceVar}];`];
    },
    setLayerZoomRange: function (layerId, minZoom, maxZoom) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        return [`MGLStyleLayer *${layerVar} = [mapView.style layerWithIdentifier:${valueToLiteral(layerId)}];`,
                `${layerVar}.minimumZoomLevel = ${minZoom || 0};`,
                `${layerVar}.maximumZoomLevel = ${maxZoom || 22};`];
    },
    setCenter: center => [`mapView.centerCoordinate = CLLocationCoordinate2DMake(${center[1]}, ${center[0]});`],
    setZoom: zoom => [`mapView.zoomLevel = ${zoom};`],
    setBearing: bearing => [`mapView.direction = ${bearing};`],
    setPitch: function (pitch) {
        return [`MGLMapCamera *camera = mapView.camera;`,
                `camera.pitch = ${pitch};`,
                `mapView.camera = camera;`];
    },
};

function diffStylesDarwin(before, after, language, os) {
    let diffs = diffStyles(before, after);
    let statements = [];
    diffs.forEach(function (diff) {
        if (diff.command in operations) {
            diff.args.push(os);
            let statement = _.map(operations[diff.command].apply(null, diff.args), s => '\t' + s);
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
