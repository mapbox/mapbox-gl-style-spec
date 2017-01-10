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
        let tab = ' '.repeat(tabWidth);
        items = _.map(items, item => item + ',');
        return `@{\n${tab}${items.join('\n' + tab)}\n}`;
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
            let tab = ' '.repeat(tabWidth);
            items = _.map(items, item => item + ',');
            return `[\n${tab}${items.join('\n' + tab)}\n]`;
        }
    }
};

Collection.prototype.toAppleScript = function () {
    let items = this.items;
    if (Array.isArray(items)) {
        items = _.invokeMap(items, 'toAppleScript');
        return `{${items.join(', ')}}`;
    } else {
        items = _.map(items, function (value, key) {
            value = value.toAppleScript();
            if (key.toAppleScript) {
                key = key.toAppleScript();
            } else {
                if (!Number.isNaN(parseFloat(key))) {
                    key = Literal(parseFloat(key), true);
                    key = `|${key.toAppleScript()}|`;
                } else {
                    key = Literal(key, true).toAppleScript();
                }
            }
            return `${key}: ${value}`;
        });
        let tab = ' '.repeat(tabWidth);
        return `{ ¬\n${tab}${items.join(', ¬\n' + tab)} ¬\n}`;
    }
};

function Literal(jsValue, isObject, unit) {
    if (!(this instanceof Literal)) {
        return new Literal(jsValue, isObject, unit);
    }
    this.type = 'literal';
    this.jsValue = jsValue;
    this.isObject = isObject;
    this.unit = unit;
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
            jsValue = jsValue.replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\t/g, '\\t')
                .replace(/\n/g, '\\n');
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
            jsValue = jsValue.replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\t/g, '\\t')
                .replace(/\n/g, '\\n');
            return `"${jsValue}"`;
        case 'object':
            return Collection(_.mapValues(_.mapKeys(jsValue, key => Literal(key, true)),
                                          value => Literal(value, true)));
        default:
            throw `Cannot convert value ${jsValue} to Swift literal.`;
    }
};

// https://developer.apple.com/library/content/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_classes.html#//apple_ref/doc/uid/TP40000983-CH1g-SW8
const unitTypes = [
    'centimetres', 'centimeters', 'feet', 'inches', 'kilometres', 'kilometers', 'metres', 'meters', 'miles', 'yards',
    'square feet', 'square kilometres', 'square kilometers', 'square metres', 'square meters', 'square miles', 'square yards',
];

Literal.prototype.toAppleScript = function () {
    let jsValue = this.jsValue;
    let isObject = this.isObject;
    if (jsValue == null || jsValue === undefined) {
        return 'missing value';
    }
    if (Array.isArray(jsValue)) {
        return Collection(_.map(jsValue, value => Literal(value, true, this.unit)));
    }
    switch (typeof jsValue) {
        case 'boolean':
            return jsValue;
        case 'number':
            return unitTypes.indexOf(this.unit) !== -1 ? `${jsValue} as ${this.unit}` : jsValue;
        case 'string':
            jsValue = jsValue.replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\t/g, '\\t')
                .replace(/\n/g, '\\n');
            return `"${jsValue}"`;
        case 'object':
            return Collection(_.mapValues(_.mapKeys(jsValue, key => Literal(key, true)),
                                          value => Literal(value, true, this.unit)));
        default:
            throw `Cannot convert value ${jsValue} to AppleScript literal.`;
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

const superclasses = {
    MGLBackgroundStyleLayer: 'MGLStyleLayer',
    MGLForegroundStyleLayer: 'MGLStyleLayer',
    MGLRasterStyleLayer: 'MGLForegroundStyleLayer',
    MGLVectorStyleLayer: 'MGLForegroundStyleLayer',
    MGLCircleStyleLayer: 'MGLVectorStyleLayer',
    MGLFillStyleLayer: 'MGLVectorStyleLayer',
    MGLFillExtrusionStyleLayer: 'MGLVectorStyleLayer',
    MGLLineStyleLayer: 'MGLVectorStyleLayer',
    MGLSymbolStyleLayer: 'MGLVectorStyleLayer',
    MGLShapeSource: 'MGLSource',
    MGLTileSource: 'MGLSource',
    MGLRasterSource: 'MGLTileSource',
    MGLVectorSource: 'MGLTileSource',
    MGLStyleConstantValue: 'MGLStyleValue',
    MGLStyleFunction: 'MGLStyleValue',
};

ClassReference.prototype.getSuper = function () {
    return superclasses[this.name]
        && ClassReference(superclasses[this.name], this.objType, this.keyType, this.isNullable);
};

ClassReference.prototype.hasSuperiorNamed = function (name) {
    let superClass = this.getSuper();
    return superClass ? superClass.hasSuperiorNamed(name) : this.name === name;
};

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

ClassReference.prototype.toAppleScript = function () {
    let name = this.name;
    if (name.toAppleScript) {
        name = name.toAppleScript();
    }
    return `the current application's ${name}`;
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
    return `${this.enumType || ''}.${_.camelCase(this.value)}`;
};

EnumReference.prototype.toAppleScript = function () {
    // FIXME: It may be necessary to use the raw unsigned integer here, but we
    // don’t know the underlying number used in mbgl.
    return `the current application's ${this.enumType}${this.value}`;
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

FunctionCall.prototype.toAppleScript = function () {
    let args = _.invokeMap(this.args, 'toAppleScript');
    return `the current application's ${this.name}(${args.join(', ')})`;
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
    let args = _.map(this.labeledArgs, (v, k) => `${k}: ${v.toSwift()}`);
    return `${this.struct}(${args.join(', ')})`;
};

StructFactoryFunctionCall.prototype.toAppleScript = function () {
    let args = _.invokeMap(this.args, 'toAppleScript');
    return `{${args.join(', ')}}`;
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
                if (v instanceof EnumReference && _.endsWith(arg, v.enumType)) {
                    v.enumType = null;
                }
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

Message.prototype.toAppleScript = function () {
    let receiver = this.receiver;
    if (receiver) {
        if (receiver instanceof Message) {
            receiver = `(${receiver.toAppleScript()})`;
        } else if (receiver.toAppleScript) {
            receiver = receiver.toAppleScript();
        }
    }
    let args = this.args;
    // Assume that _.map iterates over args in the order the keys were added.
    let pieces;
    if (typeof args === 'string') {
        pieces = [args];
    } else if (_.some(args, arg => Array.isArray(arg))) {
        let method = _.map(_.keys(args), arg => arg + '_').join('');
        args = _.map(args, function (v, arg) {
            return Array.isArray(v) ? _.invokeMap(v, 'toAppleScript').join(', ') : v.toAppleScript();
        });
        return receiver ? `${receiver}'s ${method}(${args.join(', ')})` : `${method}(${args.join(', ')})`;
    } else {
        pieces = _.map(args, function (v, arg) {
            if (v instanceof Message) {
                v = `(${v.toAppleScript()})`;
            } else if (v.toAppleScript) {
                v = v.toAppleScript();
            }
            return `${arg}:${v}`;
        });
    }
    return receiver ? `${receiver}'s ${pieces.join(' ')}` : pieces.join(' ');
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
    if (typeof coercedType === 'string') {
        coercedType = ClassReference(coercedType);
    }
    this.coercedType = coercedType;
    this.val = val;
}

TypeCoercion.prototype.toObjC = function () {
    return this.coercedType ? `(${this.coercedType.toObjC()} *)${this.val.toObjC()}` : this.val.toObjC();
};

TypeCoercion.prototype.toSwift = function () {
    return this.coercedType ? `${this.val.toSwift()} as! ${this.coercedType.toSwift()}` : `${this.val.toSwift()}!`;
};

TypeCoercion.prototype.toAppleScript = function () {
    return this.val.toAppleScript();
};

function KeyPath(components, dataType) {
    if (!(this instanceof KeyPath)) {
        return new KeyPath(components, dataType);
    }
    this.type = 'key-path';
    this.components = components;
    this.dataType = dataType;
}

KeyPath.prototype.toObjC = function () {
    let components = this.components;
    if (components[0] === true) {
        components[0] = 'self';
    }
    return components.join('.');
};

KeyPath.prototype.toSwift = function () {
    let components = this.components;
    if (components[0] === true) {
        components.shift();
    }
    return components.join('.');
};

KeyPath.prototype.toAppleScript = function () {
    let components = this.components;
    let isOfTarget = components[0] === true;
    if (isOfTarget) {
        components.shift();
    }
    let path = components.join(`'s `);
    if (isOfTarget) {
        path = `its ${path}`;
    }
    return path;
};

function Statement() {
    if (!(this instanceof Statement)) {
        return new Statement();
    }
    this.type = 'statement';
}

function VariableDeclaration(dataType, name, value) {
    if (!(this instanceof VariableDeclaration)) {
        return new VariableDeclaration(dataType, name, value);
    }
    Statement.call(this);
    this.type = 'variable-declaration';
    if (typeof dataType === 'string') {
        dataType = ClassReference(dataType);
    }
    this.dataType = dataType;
    this.name = name;
    this.value = value;
    this.isConstant = true;
}

VariableDeclaration.prototype = Object.create(Statement.prototype);
VariableDeclaration.prototype.constructor = VariableDeclaration;

VariableDeclaration.prototype.toObjC = function () {
    let value = this.value;
    if (value.toObjC) {
        value = value.toObjC();
    }
    return `${this.dataType.toObjC()} *${this.name} = ${value};`;
};

VariableDeclaration.prototype.toSwift = function () {
    let keyword = this.isConstant ? 'let' : 'var';
    let value = this.value;
    if (value.returnType && value.returnType.isNullable) {
        value = value.toSwift() + '!';
    } else if (value.toSwift) {
        value = value.toSwift();
    }
    return `${keyword} ${this.name} = ${value}`;
};

VariableDeclaration.prototype.toAppleScript = function () {
    let value = this.value;
    if (value.toAppleScript) {
        value = value.toAppleScript();
    }
    return `set ${this.name} to ${value}`;
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
    return (variable ? `${variable} = ${value}` : value) + ';';
};

Assignment.prototype.toSwift = function () {
    let variable = this.variable;
    let value = this.value;
    if (!variable && value && (value.returnType || value.coercedType)) {
        variable = '_';
    }
    if (variable && variable.toSwift) {
        variable = variable.toSwift();
    }
    if (value && value.toSwift) {
        value = value.toSwift();
    }
    return (variable ? `${variable} = ${value}` : value);
};

Assignment.prototype.toAppleScript = function () {
    let variable = this.variable;
    let value = this.value;
    let receiver;
    if (!variable) {
        let msg = value;
        if (value instanceof TypeCoercion) {
            msg = msg.val;
        }
        if (msg instanceof Message) {
            receiver = msg.receiver.toAppleScript();
            msg.receiver = null;
        }
    }
    if (variable && variable.toAppleScript) {
        variable = variable.toAppleScript();
    }
    if (value && value.toAppleScript) {
        value = value.toAppleScript();
    }
    if (receiver && receiver.toAppleScript) {
        receiver = receiver.toAppleScript();
    }
    if (variable) {
        return `set ${variable} to ${value}`;
    } else if (receiver) {
        return `tell ${receiver} to ${value}`;
    }
    return value;
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
    this.substatements = substatements;
}

BlockStatement.prototype = Object.create(ControlStatement.prototype, {
    declarations: {
        get: function () {
            return _.filter(this.substatements, stmt => stmt instanceof VariableDeclaration);
        },
    },
    
    newObjects: {
        get: function () {
            let decls = _.filter(this.declarations, decl => decl.value instanceof NewObject);
            return _.fromPairs(_.map(decls, decl => [decl.name, decl.dataType]));
        },
    },
});
BlockStatement.prototype.constructor = BlockStatement;

BlockStatement.prototype.getDeclarationsByName = function () {
    return _.keyBy(this.declarations, decl => decl.name);
};

BlockStatement.prototype.mergeWith = function (other) {
    let declsByName = this.getDeclarationsByName();
    let otherDeclsByName = other.getDeclarationsByName();
    let hasConflicts = _.some(other.substatements, function (stmt) {
        if (!(stmt instanceof VariableDeclaration && stmt.name in declsByName)) {
            return false;
        }
        let declaredType = declsByName[stmt.name].dataType;
        let redeclaredType = stmt.value.returnType || stmt.value.coercedType;
        return ((declaredType.name !== stmt.dataType.name
                 && !redeclaredType.hasSuperiorNamed(declaredType.name))
                || stmt.value instanceof NewObject);
    });
    if (hasConflicts) {
        return false;
    }
    
    _.forEach(other.substatements, function (stmt, idx) {
        if (stmt instanceof VariableDeclaration && stmt.name in declsByName
            && !_.isEqual(declsByName[stmt.name], stmt)) {
            declsByName[stmt.name].isConstant = false;
            let declaredType = declsByName[stmt.name].dataType;
            let redeclaredType = stmt.value.returnType || stmt.value.coercedType;
            let value = stmt.value;
            if (redeclaredType && redeclaredType.hasSuperiorNamed(declaredType.name)) {
                declsByName[stmt.name].dataType = redeclaredType;
                declsByName[stmt.name].value = TypeCoercion(redeclaredType, declsByName[stmt.name].value);
            } else {
                if (stmt.value instanceof Message && declaredType.name !== redeclaredType.name) {
                    value = TypeCoercion(declaredType, value);
                } else if (stmt.value instanceof TypeCoercion) {
                    value.coercedType = declaredType;
                }
            }
            let reassignment = Assignment(stmt.name, value);
            other.substatements[idx] = reassignment;
        }
    });
    let removed = _.remove(other.substatements, function (stmt) {
        return stmt instanceof VariableDeclaration && stmt.name in declsByName;
    });
    this.substatements = _.concat(this.substatements, other.substatements);
    return true;
};

BlockStatement.prototype.toObjC = function () {
    let substatements = _.invokeMap(this.substatements, 'toObjC');
    let tab = ' '.repeat(tabWidth);
    return `{\n${tab}${substatements.join('\n').replace(/\n/g, '\n' + tab)}\n}`;
};

BlockStatement.prototype.toSwift = function () {
    let substatements = _.invokeMap(this.substatements, 'toSwift');
    let tab = ' '.repeat(tabWidth);
    return `_ = {\n${tab}${substatements.join('\n').replace(/\n/g, '\n' + tab)}\n}()`;
};

BlockStatement.prototype.toAppleScript = function () {
    let substatements = _.invokeMap(this.substatements, 'toAppleScript');
    return substatements.join('\n');
};

function WithStatement(target, substatements) {
    if (!(this instanceof WithStatement)) {
        return new WithStatement(target, substatements);
    }
    ControlStatement.call(this);
    this.type = 'group-statement';
    this.target = target;
    this.substatements = substatements;
}

WithStatement.prototype = Object.create(ControlStatement.prototype);

WithStatement.prototype.toObjC = function () {
    return _.invokeMap(this.substatements, 'toObjC').join('\n');
};

WithStatement.prototype.toSwift = function () {
    return _.invokeMap(this.substatements, 'toSwift').join('\n');
};

WithStatement.prototype.toAppleScript = function () {
    let substatements = this.substatements;
    let target = this.target;
    _.forEach(substatements, function (stmt) {
        if (stmt instanceof Assignment
            && stmt.variable instanceof KeyPath
            && stmt.variable.components[0] === target) {
            stmt.variable.components[0] = true;
        }
    });
    substatements = _.invokeMap(substatements, 'toAppleScript');
    let tab = ' '.repeat(tabWidth);
    return `tell ${this.target}\n${tab}${substatements.join('\n').replace(/\n/g, '\n' + tab)}\nend tell`;
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
        case 'string':
            return Literal(jsValue, true);
        case 'number':
            return Literal(jsValue, true, prop.units);
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
                    top: Literal(jsValue[0], false),
                    left: Literal(jsValue[3], false),
                    bottom: Literal(jsValue[2], false),
                    right: Literal(jsValue[1], false),
                });
                let args = {};
                args[`valueWith${os === 'ios' ? 'UI' : ''}EdgeInsets`] = makeInsetsCall;
                return Message(type, args, type);
            } else if (propName.indexOf('offset') !== -1 || propName.indexOf('translate') !== -1) {
                return Message(type, {
                    valueWithCGVector: StructFactoryFunctionCall('CGVector', {
                        dx: Literal(jsValue[0], false),
                        dy: Literal(jsValue[1], false),
                    }),
                }, type);
            } else {
                return Collection(_.map(jsValue, function (jsValue) {
                    return valueToConstantValue(jsValue, propName, {
                        type: prop.value,
                        units: prop.units,
                    }, os);
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
        return Literal(null);
    } else if (typeof jsValue === 'object' && !Array.isArray(jsValue)) {
        let type = ClassReference('MGLStyleValue', getPropertyType(propName, prop, os));
        let fn = valueToFunction(jsValue, propName, os);
        if (_.isEmpty(fn.stops)) {
            return Literal(null);
        }
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
        let layoutStatements = _.map(layer.layout, function (jsValue, jsPropName) {
            if (!layerClass) {
                layerClass = getLayerClassByProperty(jsPropName);
            }
            let propName = getLayerPropertyName(jsPropName, os);
            let value = valueToStyleValue(jsValue, jsPropName, os);
            return Assignment(KeyPath([layerVar, propName]), value);
        });
        if (layoutStatements.length) {
            statements.push(WithStatement(layerVar, layoutStatements));
        }
        let paintStatements = _.map(layer.paint, function (jsValue, jsPropName) {
            if (!layerClass) {
                layerClass = getLayerClassByProperty(jsPropName);
            }
            let propName = getLayerPropertyName(jsPropName, os);
            let value = valueToStyleValue(jsValue, jsPropName, os);
            return Assignment(KeyPath([layerVar, propName]), value);
        });
        if (paintStatements.length) {
            statements.push(WithStatement(layerVar, paintStatements));
        }
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
            let getSourceMsg = Message(KeyPath(['style']), {
                sourceWithIdentifier: Literal(layer.source),
            }, ClassReference('MGLSource', null, null, true));
            statements.unshift(VariableDeclaration('MGLSource', sourceVar, getSourceMsg));
        }
        if (refLayerId) {
            if (layerClass !== 'MGLBackgroundStyleLayer') {
                let layerSourceVar = refLayerVar + 'Source';
                let getSourceMsg = Message(KeyPath(['style']), {
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
            let getRefLayerMsg = Message(KeyPath(['style']), {
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
            let getBeforeLayerMsg = Message(KeyPath(['style']), {
                layerWithIdentifier: Literal(beforeLayerId),
            }, ClassReference('MGLStyleLayer', null, null, true));
            statements.push(VariableDeclaration('MGLStyleLayer', beforeLayerVar, getBeforeLayerMsg));
        }
        let insertLayerMsg = Message(KeyPath(['style']), {
            insertLayer: layerVar,
            belowLayer: beforeLayerVar,
        });
        statements.push(Assignment(null, insertLayerMsg));
        return statements;
    },
    removeLayer: function (layerId) {
        let getLayerMsg = Message(KeyPath(['style']), {
            layerWithIdentifier: Literal(layerId),
        }, ClassReference('MGLStyleLayer', null, null, true));
        let removeLayerMsg = Message(KeyPath(['style']), {
            removeLayer: TypeCoercion(null, getLayerMsg),
        });
        return [Assignment(null, removeLayerMsg)];
    },
    setLayerOrPaintProperty: function (layerId, jsPropName, jsValue, cls, os) {
        let layerClass = getLayerClassByProperty(jsPropName);
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = Message(KeyPath(['style']), {
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
        let getLayerMsg = Message(KeyPath(['style']), {
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
        statements.push(Assignment(null, Message(KeyPath(['style']), {
            addSource: sourceVar,
        })));
        return statements;
    },
    removeSource: function (sourceId) {
        let getSourceMsg = Message(KeyPath(['style']), {
            sourceWithIdentifier: Literal(sourceId),
        }, ClassReference('MGLSource', null, null, true));
        let removeSourceMsg = Message(KeyPath(['style']), {
            removeSource: TypeCoercion(null, getSourceMsg),
        });
        return [Assignment(null, removeSourceMsg)];
    },
    setLayerZoomRange: function (layerId, minZoom, maxZoom) {
        let layerVar = _.camelCase(layerId) + 'Layer';
        let getLayerMsg = Message(KeyPath(['style']), {
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
    if (statements.length > 1) {
        statements = _.transform(statements.slice(1), function (result, stmt) {
            let base = _.last(result);
            if (!base.mergeWith(stmt)) {
                result.push(stmt);
            }
        }, [statements[0]]);
    }
    switch (language) {
        case 'objc':
            return _.invokeMap(statements, 'toObjC').join('\n');
        case 'swift':
            return _.invokeMap(statements, 'toSwift').join('\n');
        case 'applescript':
            return _.invokeMap(statements, 'toAppleScript').join('\n');
        default:
            return JSON.stringify(statements, null, 2);
    }
}

module.exports = diffStylesDarwin;
