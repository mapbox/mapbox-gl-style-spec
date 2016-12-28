'use strict';

const diffStyles = require('./diff');
const latestStyleSpec = require('../reference/latest.min');

const _ = require('lodash');
const colorParser = require('csscolorparser');

function getLayerType(prop) {
    return _.findKey(latestStyleSpec, prop).replace(/^(?:paint|layout)_/, '');
}

function valueToConstantValue(jsValue, propName, prop, propType, os) {
    let type;
    let value;
    switch (propType) {
        case 'boolean':
            type = 'NSNumber';
            value = jsValue ? '@YES' : '@NO';
            break;
        case 'number':
            type = 'NSNumber';
            value = '@' + jsValue;
            break;
        case 'string':
            type = 'NSString';
            value = `@"${jsValue}"`;
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
                return `@${stop[0]}: ${stop[1]}`;
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
            jsValue = jsValue.replace(/'/g, `\\\'`).replace(/"/g, '\\"').replace(/\\/g, '\\\\');
            return `'${jsValue}'`;
        default:
            throw `Filter value ${jsValue} cannot be converted to an expression.`;
    }
}

function filterToPredicate(filter) {
    let left = filter[1];
    let leftArg;
    if (typeof left !== 'object' && !left.match(/^\w*$/)) {
        left = left.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
        leftArg = `@"${left}"`;
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
            sourceDecl = `MGLSource *${sourceVar} = [mapView.style sourceWithIdentifier:@"${layer.source}"];`;
            sourceArg = ` source:${sourceVar}`;
        }
        let statements = [`${layerClass} *${layerVar} = [[${layerClass} alloc] initWithIdentifier:@"${layer.id}"${sourceArg}];`,
                          `MGLStyleLayer *${beforeLayerVar} = [mapView.style layerWithIdentifier:@"${beforeLayerId}"];`,
                          `[mapView.style insertLayer:${layerVar} belowLayer:${beforeLayerVar}];`];
        if (sourceDecl) {
            statements.unshift(sourceDecl);
        }
        return statements;
    },
    removeLayer: function (layerId) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        return [`MGLStyleLayer *${layerVar} = [mapView.style layerWithIdentifier:@"${layerId}"];`,
                `[mapView.style removeLayer:${layerVar}];`];
    },
    setPaintProperty: function (layerId, prop, value, cls, os) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let layerClass = 'MGL' + _.capitalize(_.camelCase(getLayerType(prop))) + 'StyleLayer';
        let params = valueToStyleValue(value, prop, os);
        return [`${layerClass} *${layerVar} = (${layerClass} *)[mapView.style layerWithIdentifier:@"${layerId}"];`,
                `${layerVar}.${params[0]} = ${params[1]};`];
    },
    setLayoutProperty: function (layerId, prop, value, cls, os) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let layerClass = 'MGL' + _.capitalize(_.camelCase(getLayerType(prop))) + 'StyleLayer';
        let params = valueToStyleValue(value, prop, os);
        return [`${layerClass} *${layerVar} = (${layerClass} *)[mapView.style layerWithIdentifier:@"${layerId}"];`,
                `${layerVar}.${params[0]} = ${params[1]};`];
    },
    setFilter: function (layerId, filter) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let args = filterToPredicate(filter);
        args[0] = `@"${args[0]}"`;
        return [`MGLVectorStyleLayer *${layerVar} = (MGLVectorStyleLayer *)[mapView.style layerWithIdentifier:@"${layerId}"];`,
                `${layerVar}.predicate = [NSPredicate predicateWithFormat:${args.join(', ')}];`];
    },
    addSource: function (sourceId, source) {
        let sourceVar = _.camelCase(source.id) + 'Source';
        let sourceClass = getSourceClass(source);
        let args = [];
        if ('url' in source) {
            args.push(` configurationURL:[NSURL URLWithString:@"${source.url}"]`);
            if ('tileSize' in source) {
                args.push(` tileSize:${source.tileSize}`);
            }
        } else if ('tiles' in source) {
            let templates = _.map(source.tiles, str => `@"${str}"`);
            args.push(` tileURLTemplates:@[${templates.join(', ')}`);
            let options = {};
            if ('minzoom' in source) {
                options['MGLTileSourceOptionMinimumZoomLevel'] = '@' + source.minzoom;
            }
            if ('maxzoom' in source) {
                options['MGLTileSourceOptionMaximumZoomLevel'] = '@' + source.maxzoom;
            }
            if ('tileSize' in source) {
                options['MGLTileSourceOptionTileSize'] = '@' + source.tileSize;
            }
            if ('attribution' in source) {
                options['MGLTileSourceOptionAttributionHTMLString'] = `@"${source.attribution}"`;
            }
            if (_.isEmpty(options)) {
                args.push(` options:nil`);
            } else {
                options = _.forEach(options, (value, key) => `${key}: ${value}`);
                args.push(` options:@{${options.join(', ')}}`);
            }
        } else if ('data' in source) {
            if (typeof source.data === 'string') {
                args.push(` URL:[NSURL URLWithString:@"${source.url}"]`);
            } else {
                throw 'Inline GeoJSON not implemented.';
            }
            let options = {};
            if ('maxzoom' in source) {
                options['MGLShapeSourceOptionMaximumZoomLevel'] = '@' + source.maxzoom;
            }
            if ('buffer' in source) {
                options['MGLShapeSourceOptionBuffer'] = '@' + source.buffer;
            }
            if ('tolerance' in source) {
                options['MGLShapeSourceOptionSimplificationTolerance'] = '@' + source.tolerance;
            }
            if ('cluster' in source) {
                options['MGLShapeSourceOptionClustered'] = source.cluster ? '@YES' : '@NO';
            }
            if ('clusterRadius' in source) {
                options['MGLShapeSourceOptionClusterRadius'] = '@' + source.clusterRadius;
            }
            if ('clusterMaxZoom' in source) {
                options['MGLShapeSourceOptionMaximumZoomLevelForClustering'] = '@' + source.clusterMaxZoom;
            }
            if (_.isEmpty(options)) {
                args.push(` options:nil`);
            } else {
                options = _.forEach(options, (value, key) => `${key}: ${value}`);
                args.push(` options:@{${options.join(', ')}}`);
            }
        }
        let statements = [`${sourceClass} *${sourceVar} = [${sourceClass} sourceWithIdentifier:@"${sourceId}"${args.join(' ')}];`];
        if ('source-layer' in source) {
            statements.push(`${sourceVar}.sourceLayerIdentifier = @"${source.source-layer}";`);
        }
        statements.push(`[mapView.style addSource:${sourceVar}];`);
        return statements;
    },
    removeSource: function (sourceId) {
        let sourceVar = _.camelCase(sourceId) + 'Source';
        return [`MGLSource *${sourceVar} = [mapView.style sourceWithIdentifier:@"${sourceId}"];`,
                `[mapView.style removeSource:${sourceVar}];`];
    },
    setLayerZoomRange: function (layerId, minZoom, maxZoom) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        return [`MGLStyleLayer *${layerVar} = [mapView.style layerWithIdentifier:@"${layerId}"];`,
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
