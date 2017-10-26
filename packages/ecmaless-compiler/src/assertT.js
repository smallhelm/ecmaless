var _ = require("lodash");

var typeToString = function(type){
    if(type.tag === "Enum"){
        return type.id + "<" + _.map(type.args, typeToString).join(", ") + ">";
    }
    return type.tag;
};

module.exports = function assertT(ctx, actual, expected, loc){
    var aTag = actual && actual.tag;

    if(aTag !== (expected && expected.tag)){
        throw ctx.error(loc, "expected `" + typeToString(expected) + "` but was `" + typeToString(actual) + "`");
    }

    if(aTag === "Fn"){
        if(_.size(actual.params) !== _.size(expected.params)){
            throw ctx.error(loc, "Expected "  + _.size(expected.params) + " params but was " + _.size(actual.params));
        }
        _.each(actual.params, function(param, i){
            var exp = expected.params[i];
            assertT(ctx, param, exp, param.loc || exp.loc || loc);
        });
    }

    if(aTag === "Struct"){
        if(!_.isEqual(_.keys(actual.by_key), _.keys(expected.by_key))){
            throw ctx.error(actual.loc, "TODO better error Bad Struct keys");
        }
        _.each(actual.by_key, function(act, key){
            var exp = expected.by_key[key];
            assertT(ctx, act, exp, act.loc || exp.loc || loc);
        });
    }

    if(aTag === "Enum"){
        if(!_.isEqual(_.keys(actual.args).sort(), _.keys(expected.args).sort())){
            throw ctx.error(actual.loc, "TODO better error Enum arg missmatch");
        }
        _.each(actual.args, function(act, key){
            var exp = expected.args[key];
            assertT(ctx, act, exp, act.loc || exp.loc || loc);
        });
    }
};
