var _ = require("lodash");
var e = require("estree-builder");
var toId = require("to-js-identifier");
var assertT = require("./assertT");
var SymbolTable = require("symbol-table");

var sysIDtoJsID = function(id){
    return "$$$ecmaless$$$" + toId(id);
};

var omitTypeInstanceSpecifics = function(TYPE){
    //TODO recurse down in complex types
    return _.omit(_.omit(TYPE, "value"), "loc");
};

var comp_ast_node = {
    "Number": function(ast, comp){
        return {
            estree: e("number", ast.value, ast.loc),
            TYPE: {tag: "Number", value: ast.value, loc: ast.loc},
        };
    },
    "String": function(ast, comp){
        return {
            estree: e("string", ast.value, ast.loc),
            TYPE: {tag: "String", value: ast.value, loc: ast.loc},
        };
    },
    "Boolean": function(ast, comp){
        return {
            estree: e(ast.value ? "true" : "false", ast.loc),
            TYPE: {tag: "Boolean", value: ast.value, loc: ast.loc},
        };
    },
    "Nil": function(ast, comp){
        return {
            estree: e("void", e("number", 0, ast.loc), ast.loc),
            TYPE: {tag: "Nil", loc: ast.loc},
        };
    },
    "Identifier": function(ast, comp, ctx){
        var id = ctx.useIdentifier(ast.value, ast.loc);
        if(!id){
            throw new Error("Not defined: " + ast.value);
        }
        return {
            estree: e("id", toId(ast.value), ast.loc),
            TYPE: id.TYPE,
        };
    },
    "Array": function(ast, comp){
        var TYPE = {
            tag: "Array",
            type: void 0,
            loc: ast.loc,
        };
        var est_vals = [];
        _.each(ast.value, function(v_ast, i){
            var v = comp(v_ast);
            if(TYPE.type){
                //TODO better error message i.e. array elements all must have same type
                assertT(v.TYPE, TYPE.type, v_ast.loc);
            }else{
                TYPE.type = v.TYPE;
            }
            est_vals.push(v.estree);
        });
        return {
            estree: e("array", est_vals, ast.loc),
            TYPE: TYPE,
        };
    },
    "Struct": function(ast, comp){
        var TYPE = {
            tag: "Struct",
            by_key: {},
            loc: ast.loc,
        };
        var est_pairs = [];
        _.each(_.chunk(ast.value, 2), function(pair){
            var key = pair[0];
            var key_str;
            var key_est;
            if(key.type === "Symbol"){
                key_str = key.value;
                key_est = e("string", key.value, key.loc);
            }else if(key.type === "String"){
                key_str = key.value;
                key_est = comp(key).estree;
            }else{
                throw new Error("Invalid struct key.type: " + key.type);
            }

            var val = comp(pair[1]);

            if(_.has(TYPE.by_key, key_str)){
                //TODO better error
                throw new Error("No duplicate keys: " + key_str);
            }

            TYPE.by_key[key_str] = val.TYPE;

            est_pairs.push(e("object-property", key_est, val.estree, {start: pair[0].loc.start, end: pair[1].loc.end}));
        });
        return {
            estree: e("object-raw", est_pairs, ast.loc),
            TYPE: TYPE,
        };
    },
    "Function": function(ast, comp, ctx, from_caller){
        var expTYPE = from_caller && from_caller.TYPE;
        if(!expTYPE || expTYPE.tag !== "Fn"){
            //TODO better error
            throw new Error("Sorry, function types are not infered");
        }
        if(_.size(expTYPE.params) !== _.size(ast.params)){
            //TODO better error
            throw new Error("Function should have " + _.size(expTYPE.params) + " params not " + _.size(ast.params));
        }

        ctx.pushScope();

        var params = _.map(ast.params, function(p, i){
            ctx.defIdentifier(p.value, expTYPE.params[i]);
            return comp(p).estree;
        });
        var body = _.compact(_.map(ast.block.body, function(b){
            var c = comp(b);
            if(c){
                //TODO check return type matches expTYPE
                //TODO check return type matches expTYPE
                return c.estree;
            }
        }));
        ctx.popScope();
        var id;
        return {
            estree: e("function", params, body, id, ast.loc),
            TYPE: expTYPE,
        };
    },
    "Application": function(ast, comp){

        var callee = comp(ast.callee);
        var args = _.map(ast.args, function(arg){
            return comp(arg);
        });

        assertT({
            tag: "Fn",
            params: _.map(args, function(arg, i){
                return _.assign({}, arg.TYPE, {
                    loc: ast.args[i].loc,
                });
            }),
        }, callee.TYPE, ast.callee.loc);

        return {
            estree: e("call", callee.estree, _.map(args, "estree"), ast.loc),
            TYPE: callee.TYPE["return"],
        };
    },
    "UnaryOperator": require("./c/UnaryOperator"),
    "InfixOperator": require("./c/InfixOperator"),
    "AssignmentExpression": function(ast, comp, ctx){
        var left = comp(ast.left);
        var right = comp(ast.right);

        //TODO better error i.e. explain can't change types
        assertT(right.TYPE, left.TYPE, ast.right.loc);

        if(ast.left.type === "Identifier"){
            return {
                estree: e("=", left.estree, right.estree, ast.loc),
                TYPE: left.TYPE,
            };
        }else if(ast.left.type === "MemberExpression"){
            left.estree.callee.name = ctx.useSystemIdentifier("set", ast.loc);
            left.estree["arguments"].push(right.estree);
            return {
                estree: left.estree,
                TYPE: left.TYPE,
            };
        }
        throw new Error("Only Identifier or MemberExpression can be assigned");
    },
    "MemberExpression": function(ast, comp, ctx){

        var obj = comp(ast.object);

        if(ast.method === "dot" && ast.path && ast.path.type === "Identifier"){

            var key = ast.path.value;

            if(obj.TYPE.tag !== "Struct"){
                //TODO better error
                throw new TypeError(". notation only works on Struct");
            }
            if( ! _.has(obj.TYPE.by_key, key)){
                //TODO better error
                throw new TypeError("Key does not exist: " + key);
            }

            return {
                estree: e(".", obj.estree, e("id", key, ast.path.loc), ast.loc),
                TYPE: obj.TYPE.by_key[key],
            };
        }else if(ast.method === "index"){
            var path = comp(ast.path);
            if(obj.TYPE.tag === "Array"){
                if(path.TYPE.tag !== "Number"){//TODO Int
                    //TODO better error
                    throw new TypeError("Array subscript notation only works with Ints");
                }
                return {
                    estree: e("get", obj.estree, path.estree, ast.loc),
                    TYPE: {
                        tag: "Maybe",
                        params: [obj.TYPE.type],
                        loc: ast.loc,
                    },
                };
            }else{
                //TODO better error
                throw new TypeError("subscript notation only works on Arrays");
            }
        }else{
            throw new Error("Unsupported MemberExpression method: " + ast.method);
        }
    },
    "ConditionalExpression": function(ast, comp, ctx){
        var test = comp(ast.test);
        var consequent = comp(ast.consequent);
        var alternate = comp(ast.alternate);

        assertT(test.TYPE, {tag: "Boolean"}, ast.test.loc);

        //TODO better error i.e. explain both need to match
        assertT(alternate.TYPE, consequent.TYPE, ast.alternate.loc);

        //remove specifics b/c it may be either branch
        var TYPE = omitTypeInstanceSpecifics(consequent.TYPE);

        return {
            estree: e("?",
                test.estree,
                consequent.estree,
                alternate.estree,
                ast.loc
            ),
            TYPE: TYPE,
        };
    },
    "Block": function(ast, comp, ctx){
        ctx.pushScope();
        var body = _.map(ast.body, function(ast){
            return comp(ast).estree;
        });
        ctx.popScope();
        return {
            estree: e("block", body, ast.loc),
        };
    },
    "ExpressionStatement": function(ast, comp){
        var expr = comp(ast.expression);
        return {
            estree: e(";", expr.estree, ast.loc),
        };
    },
    "Return": function(ast, comp){
        return {
            estree: e("return", comp(ast.expression).estree, ast.loc),
        };
    },
    "If": function(ast, comp, ctx){
        var test = comp(ast.test);
        assertT(test.TYPE, {tag: "Boolean"}, ast.test.loc);
        var then = comp(ast.then).estree;
        var els_ = ast["else"]
            ? comp(ast["else"]).estree
            : void 0;
        return {
            estree: e("if", test.estree, then, els_, ast.loc),
        };
    },
    "Case": function(ast, comp){
        var mkTest = function(val){
            return comp({
                loc: val.loc,
                type: "InfixOperator",
                op: "==",
                left: ast.to_test,
                right: val
            }).estree;
        };
        var prev = ast["else"]
            ? comp(ast["else"]).estree
            : undefined;
        var i = _.size(ast.blocks) - 1;
        while(i >= 0){
            var block = ast.blocks[i];
            prev = e("if",
                mkTest(block.value),
                comp(block.block).estree,
                prev,
                block.loc
            );
            i--;
        }
        return {
            estree: prev,
        };
    },
    "While": function(ast, comp, ctx){
        var test = comp(ast.test);
        assertT(test.TYPE, {tag: "Boolean"}, ast.test.loc);
        return {
            estree: e("while", test.estree, comp(ast.block).estree, ast.loc),
        };
    },
    "Break": function(ast, comp){
        return {
            estree: e("break", ast.loc),
        };
    },
    "Continue": function(ast, comp){
        return {
            estree: e("continue", ast.loc),
        };
    },
    "TryCatch": function(ast, comp){
        return {
            estree: e("try",
                comp(ast.try_block).estree,
                comp(ast.catch_id).estree,
                comp(ast.catch_block).estree,
                comp(ast.finally_block).estree,
                ast.loc
            ),
        };
    },
    "Define": function(ast, comp, ctx){
        if(ast.id.type !== "Identifier"){
            throw new Error("Only Identifiers can be defined");
        }
        var curr_val = ctx.get(ast.id.value);
        if(curr_val && curr_val.defined){
            throw new Error("Already defined: " + ast.id.value);
        }
        var annotated = curr_val && curr_val.TYPE;

        var init = comp(ast.init, {TYPE: annotated});

        if(annotated){
            //ensure it matches the annotation
            assertT(init.TYPE, annotated, ast.id.loc);
        }

        ctx.defIdentifier(ast.id.value, init.TYPE);

        var id = comp(ast.id);

        if(init.estree.type === "FunctionExpression"){
            init.estree.id = id.estree;
        }
        return {
            estree: e("var", id.estree, init.estree, ast.loc),
        };
    },
    "Annotation": function(ast, comp, ctx){
        var def = comp(ast.def);
        ctx.annIdentifier(ast.id.value, def.TYPE);
        return void 0;//nothing to compile
    },
    "FunctionType": function(ast, comp, ctx){
        var params = _.map(ast.params, function(p){
            return comp(p).TYPE;
        });
        var ret = comp(ast["return"]).TYPE;
        return {
            TYPE: {
                tag: "Fn",
                params: params,
                "return": ret,
            },
        };
    },
    "Type": function(ast, comp, ctx){
        var basics = {
            "Number": true,
            "String": true,
            "Boolean": true,
            "Nil": true,
        };
        if(_.has(basics, ast.value)){
            return {
                TYPE: {tag: ast.value, loc: ast.loc},
            };
        }
        if(ctx.has(ast.value)){
            return ctx.get(ast.value);
        }
        //TODO better error
        throw new Error("Type not supported: " + ast.value);
    },
    "TypeAlias": function(ast, comp, ctx){
        var TYPE = comp(ast.value).TYPE;
        ctx.defType(ast.id.value, TYPE);
        return {
            TYPE: TYPE,
        };
    },
    "Enum": function(ast, comp, ctx){
        var TYPE = {
            tag: "Enum",
            variants: {},
            loc: ast.loc,
        };
        _.each(ast.variants, function(variant){
            var tag = variant.tag.value;
            if(_.has(TYPE.variants, tag)){
                //TODO better error
                throw new Error("No duplicate variants: " + tag);
            }
            TYPE.variants[tag] = _.map(variant.params, function(param){
                return comp(param).TYPE;
            });
        });
        ctx.defType(ast.id.value, TYPE);
        return {
            TYPE: TYPE,
        };
    },
    "EnumValue": function(ast, comp, ctx){
        if(!ast.enum || !ctx.has(ast.enum.value)){
            //TODO better error
            throw new Error("Enum not defined: " + ast.enum.value);
        }

        var enumT;
        if(ast.enum){
            enumT = ctx.get(ast.enum.value).TYPE;
            if(enumT.tag !== "Enum"){
                //TODO better error
                throw new Error("Not an enum: " + ast.enum.value);
            }
        }else{
            //TODO infer enum type
            throw new Error("Sorry, cannot infer enum type");
        }
        if(!_.has(enumT.variants, ast.tag.value)){
            //TODO better error
            throw new Error("Not an enum variant: " + ast.enum.value + "." + ast.tag.value);
        }
        var paramsT = enumT.variants[ast.tag.value];
        if(_.size(paramsT) !== _.size(ast.params)){
            //TODO better error
            throw new Error("Expected " + _.size(paramsT) + " params not " + _.size(ast.params) + " for " + ast.enum.value + "." + ast.tag.value);
        }
        var params = _.map(ast.params, function(p_ast, i){
            var param = comp(p_ast);
            assertT(param.TYPE, paramsT[i], p_ast.loc);
            return param.estree;
        });
        return {
            estree: e("obj", {
                tag: e("string", ast.tag.value, ast.tag.loc),
                params: e("array", params, ast.loc),
            }, ast.loc),
        };
    },
};

module.exports = function(ast){

    var undefined_symbols = {};
    var symt_stack = [SymbolTable()];
    var ctx = {
        pushScope: function(){
            symt_stack.unshift(symt_stack[0].push());
        },
        popScope: function(){
            symt_stack.shift();
        },
        annIdentifier: function(id, TYPE){
            symt_stack[0].set(id, {
                id: id,
                TYPE: TYPE,
            });
        },
        defType: function(id, TYPE){
            symt_stack[0].set(id, {
                id: id,
                TYPE: TYPE,
            });
        },
        defIdentifier: function(id, TYPE){
            symt_stack[0].set(id, {
                id: id,
                TYPE: TYPE,
                defined: true,
            });
        },
        has: function(id){
            return symt_stack[0].has(id);
        },
        get: function(id){
            return symt_stack[0].get(id);
        },
        useIdentifier: function(id, loc, js_id){
            if(!symt_stack[0].has(id)){
                if(!_.has(undefined_symbols, id)){
                    undefined_symbols[id] = {
                        loc: loc,
                        id: id,
                        js_id: js_id || toId(id),
                    };
                }
            }else{
                return symt_stack[0].get(id);
            }
        },
        useSystemIdentifier: function(id, loc, ret_estree){
            var js_id = sysIDtoJsID(id);
            ctx.useIdentifier("$$$ecmaless$$$" + id, loc, js_id);
            return ret_estree
                ? e("id", js_id, loc)
                : js_id;
        }
    };

    var compile = function compile(ast, from_caller){
        if(!_.has(ast, "type")){
            throw new Error("Invalid ast node: " + JSON.stringify(ast));
        }else if(!_.has(comp_ast_node, ast.type)){
            throw new Error("Unsupported ast node type: " + ast.type);
        }
        return comp_ast_node[ast.type](ast, compile, ctx, from_caller);
    };

    return {
        estree: _.compact(_.map(ast, function(ast){
            var c = compile(ast);
            if(c){
                return c.estree;
            }
        })),
        undefined_symbols: undefined_symbols
    };
};