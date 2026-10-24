const fs=require('fs'),path=require('path'),assert=require('assert');
const ZT=require('../zab-balance.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let n=0;const ok=(c,m)=>{assert(c,m);n++;};
const s=html.indexOf('<section id="zab">'),sec=html.slice(s,html.indexOf('</section>',s));
ok(s>0,'ZAB section present');
ok(/<h2><span class="zab">ZAB<svg class="zab-ring"[^>]*aria-hidden="true"[\s\S]*?<\/svg><\/span><\/h2>/.test(sec),'heading is ZAB + ring');
ok(/<nav>[\s\S]*<a href="#zab"><span class="zab">ZAB<svg class="zab-ring"[\s\S]*?<\/a>[\s\S]*<\/nav>/.test(html),'nav link is ZAB + ring');
ok(/<nav>[\s\S]*id="ztBadge" href="#zab"[^>]*>Sign in<\/a>/.test(html),'header badge, signed-out text, links to section');
ok(sec.includes('Sign in to start earning.')&&sec.includes('href="#play"'),'signed-out text with sign-in link');
ok(sec.includes('id="ztBalance"')&&sec.includes('id="ztRates"')&&sec.includes('id="ztTxBody"'),'balance/rates/tx targets');
// rates match constants
const lines=ZT.rateLines();
ok(lines[0]===ZT.RATES.pushups.per+' push-ups = 1 ZAB'&&lines[0]==='10 push-ups = 1 ZAB','pushups rate');
ok(lines[1]==='1 minute of plank = 1 ZAB'&&ZT.RATES.plank.per===60,'plank rate');
ok(lines[2]==='1 minute of TUT = 1 ZAB'&&ZT.RATES.tut.per===60,'tut rate');
ok(lines[3]==='10 minutes of walking = 1 ZAB'&&ZT.RATES.walk.per===10,'walk rate');
// tx render
const esc=x=>String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const d=new Date(2026,9,21,20,0);
const rows=ZT.txRowsHtml([{source:'pushups',amount:3,qty:34,units:'reps',createdAt:{toDate:()=>d}},{source:'walk',amount:2,qty:25,units:'minutes',createdAt:null},{source:'<x>',amount:1,qty:1}],esc);
ok(rows.split('<tr>').length-1===3,'three rows');
ok(rows.includes('<td>Push-ups</td><td>+3 <span class="zab">ZAB<svg class="zab-ring"')&&rows.includes('</svg></span></td><td>34 push-ups</td><td>'+d.toLocaleString()+'</td>'),'pushup row (amount + ZAB ring)');
ok(rows.includes('<td>Walking</td><td>+2 <span class="zab">ZAB')&&rows.includes('</span></td><td>25 minutes</td><td>just now</td>'),'walk row, pending timestamp');
ok(rows.includes('&lt;x&gt;')&&!rows.includes('<x>'),'escaped');
ok(ZT.txLine({source:'plank',amount:1,qty:90}).qty==='1 minute','plank qty');
ok(/No ZAB earned yet/.test(ZT.txRowsHtml([],esc))&&/No ZAB earned yet/.test(ZT.txRowsHtml(null,esc)),'empty state');
// wiring
ok(/paintZab\(n\)[^\n]*paintZabSection\(n\)/.test(html),'balance paints section+badge');
ok(/collection\(db, "users", u\.uid, "zabLedger"\), orderBy\("createdAt", "desc"\), limit\(10\)/.test(html),'recent tx query');
ok(html.includes('id="zabBalanceRow"')&&html.includes('" ZAB." : ""'),'legacy line + status note intact');
// no one-B user text
const text=html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ');
ok(!/\bZaba\b/.test(text),'no one-B Zaba in page text');
ok(!/\bZaba\b/.test(lines.join(' ')+rows),'no one-B Zaba in rendered ZAB text');
// rules
const rules=fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8');
ok(/match \/zabLedger\/\{txId\} \{[\s\S]*?allow read: if request\.auth != null && request\.auth\.uid == uid;/.test(rules),'owner can read/list zabLedger');
console.log('PASS ZAB section ('+n+' checks)');
