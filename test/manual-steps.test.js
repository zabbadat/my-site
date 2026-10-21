const assert=require("assert");global.window=undefined;
const DS=require("../daily-steps.js");
const store={m:{},getItem(k){return this.m[k]||null},setItem(k,v){this.m[k]=v}};
const c=DS.createController({localStorage:store,performance:{now:()=>0}},{});
assert.strictEqual(c.addManual(5000),5000);assert.strictEqual(c.addManual(-3),5000);assert.strictEqual(c.addManual(100000),60000);
console.log("manual-steps ok");
assert.strictEqual(c.syncRemote(70000),60000);
const c2=DS.createController({localStorage:{m:{},getItem(){return null},setItem(){}},performance:{now:()=>0}},{});
c2.addManual(1000);assert.strictEqual(c2.syncRemote(4000),4000);assert.strictEqual(c2.syncRemote(2000),4000);console.log("sync ok");
