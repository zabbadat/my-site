const assert=require("assert");global.window=undefined;
const DS=require("../daily-steps.js");
const store={m:{},getItem(k){return this.m[k]||null},setItem(k,v){this.m[k]=v}};
const c=DS.createController({localStorage:store,performance:{now:()=>0}},{});
assert.strictEqual(c.addManual(5000),5000);assert.strictEqual(c.addManual(-3),5000);assert.strictEqual(c.addManual(100000),60000);
console.log("manual-steps ok");
