var _ = require("lodash");
var test = require("tape");
var compile = require("../../");

var testCompile = function(t, src, expected){
  t.equals(compile(src, {
    escodegen: {format: {compact: true}}
  }), expected);
};

test("basics", function(t){
  var tc = _.partial(testCompile, t);

  tc("(add 1 2)", "add(1,2);");
  tc('( log "hello world" )', "log('hello world');");
  tc("(js/+ 1 2)", "1+2;");
  tc("(js/=== a b)", "a===b;");
  tc("(js/typeof a)", "typeof a;");
  tc("(js/&& a b)", "a&&b;");
  tc("(js/! a)", "!a;");
  tc(
    "(log js/null js/false js/true js/undefined js/this js/arguments)",
    "log(null,false,true,undefined,this,arguments);"
  );
  tc("(js/var a 1 b 2)", "var a=1,b=2;");
  tc("(js/property-access a b)", "a[b];");
  tc("(js/property-access a :b)", "a['b'];");
  tc("(js/= a :b)", "a='b';");
  tc(
    "(js/function add4 (a) (js/block-statement\n"
    + "(js/var b 4)\n"
    + "(log :hello-world)\n"
    + "(js/return (js/+ a b))))"
    ,
    "(function add4(a){var b=4;log('hello-world');return a+b;});"
  );
  tc(
    "(js/function js/null (a b) (js/block-statement\n"
    + "(js/return (js/+ a b))))"
    ,
    "(function(a,b){return a+b;});"
  );
  tc(
    "(js/while (js/lt= i 3) (js/block-statement\n"
    + "(log :loop-again)\n"
    + "(js/= i (js/+ i 1))))"
    ,
    "while(i<=3){log('loop-again');i=i+1;}"
  );
  tc("(js/ternary (js/=== a 1) :one a)", "a===1?'one':a;");
  tc(
    "(js/if (js/=== a 1)\n"
    + "(js/block-statement (log :true))"
    + "(js/block-statement (log :false)))",

    "if(a===1){log('true');}else{log('false');}"
  );
  tc(
    "(js/if (js/=== a 1)\n"
    + "(log :true)"
    + "(log :false))",

    "if(a===1)log('true');else log('false');"
  );
  tc(
    "(js/try-catch\n"
    + "(run)\n"
    + "err\n"
    + "(log \"error\" err))",

    "tryrun();catch(err)log('error',err);"
  );
  tc("((js/property-access console :log) 1 2)",
    "console['log'](1,2);"
  );
  tc("[]", "[];");
  tc("[a 1 :2]", "[a,1,'2'];");

  tc("{}", "({});");
  tc("{:a}", "({'a':undefined});");
  tc("{:a 1}", "({'a':1});");
  tc("{:a 1 :2 3}", "({'a':1,'2':3});");

  tc("(js/throw (js/new Error :msg))", "throw new Error('msg');");

  tc("(def a 1)", "var a=1;");

  tc("(fn [a b] (js/+ a b))", "(function(a,b){return a+b;});");
  tc("(fn [a] (def b 1) (js/+ a b))", "(function(a){var b=1;return a+b;});");
  tc("(fn [])", "(function(){});");

  tc("'a", "({'type':'symbol','value':'a','src':'a','loc':{'start':{'line':1,'column':1},'end':{'line':1,'column':1}}});");
  tc("(list a 1)", "({'type':'list','value':[a,1],'src':'(','loc':{'start':{'line':1,'column':0},'end':{'line':1,'column':0}},'list_type':'('});");

  tc("(defn add [a b] (js/+ a b))", "var add=function add(a,b){return a+b;};");

  tc("(if a b c)", "a?b:c;");
  tc("(if a b)", "a?b:void 0;");

  tc("a.b", "a['b'];");
  tc("a.b.c.d.e", "a['b']['c']['d']['e'];");

  t.end();
});