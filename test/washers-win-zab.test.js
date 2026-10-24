const fs=require('fs'),path=require('path'),assert=require('assert');
const ZT=require('../zab-balance.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8');
let n=0;const ok=(c,m)=>{assert(c,m);n++;};
function memFs(){const db={};const k=p=>p.join('/');return{db,ts:()=>'TS',tx:fn=>{const w=[];return Promise.resolve(fn({get:p=>Promise.resolve(db[k(p)]?JSON.parse(JSON.stringify(db[k(p)])):null),set:(p,d)=>w.push([k(p),d]),update:(p,d)=>w.push([k(p),Object.assign({},db[k(p)],d)])})).then(r=>{w.forEach(([p,d])=>db[p]=d);return r;});}};}
(async()=>{
  const f=memFs();
  const e=ZT.washersWinEarn('u1',true,'g1');
  ok(e&&e.id==='washers-g1'&&e.tx.amount===1&&e.tx.qty===1&&e.tx.units==='wins','win earn built');
  ok(ZT.validEarn(e.tx),'valid');
  ok(ZT.washersWinEarn('u1',false,'g1')===null,'no earn on loss');
  ok(ZT.washersWinEarn('',true,'g1')===null&&ZT.washersWinEarn(null,true,'g1')===null,'no earn unsigned/practice');
  ok(ZT.washersWinEarn('u1',true,'')===null,'needs game id');
  let r=await ZT.award(f,e); ok(r.credited===1&&f.db['users/u1'].zabBalance===1,'awarded once');
  r=await ZT.award(f,ZT.washersWinEarn('u1',true,'g1')); ok(r.credited===0&&r.skipped==='duplicate'&&f.db['users/u1'].zabBalance===1,'idempotent');
  await ZT.award(f,ZT.washersWinEarn('u1',true,'g2')); ok(f.db['users/u1'].zabBalance===2,'new game awards again');
  ok(!ZT.validEarn(Object.assign({},e.tx,{amount:2})),'amount 2 rejected');
  ok(ZT.txLine(e.tx).source==='Won Zabba Washers'&&ZT.txLine(e.tx).qty==='1 game won','tx reason text');
  ok(ZT.RATES.pushups.per===10&&ZT.RATES.plank.per===60&&ZT.RATES.tut.per===60&&ZT.RATES.walk.per===10,'other rates unchanged');
  const L=ZT.rateLines(); ok(L.length===5&&L[4]==='Won Zabba Washers game = 1 ZAB','earn rates line');
  ok(ZT.qtyFrom('washers',1)===1&&ZT.qtyFrom('washers',0)===0,'qty');
  const fg=html.slice(html.indexOf('async function finishGame'),html.indexOf('paintRows(localBoard());\nrender();'));
  ok(/awardZab\("washers"/.test(fg)&&fg.indexOf('awardZab("washers"')>fg.indexOf('if (!currentUser)'),'award only after verified + signed-in checks');
  ok(/state\.gameId/.test(fg),'uses game id');
  ok(rules.includes("t().source == 'washers' && t().units == 'wins'    && t().qty == 1    && t().amount == 1"),'rules allow washers win');
  console.log('PASS washers win ZAB ('+n+' checks)');
})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});
