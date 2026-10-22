const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let n=0;const ok=(c,m)=>{assert(c,m);n++;};
ok(!html.includes('stepSensorBtn')&&!/Enable step sensor/i.test(html),'no enable-sensor button or text');
ok(!html.includes('Enable the step sensor, keep this page open'),'old static note removed');
ok(/<p class="note" id="phoneStepsNote"[^>]*><\/p>/.test(html),'phoneStepsNote kept empty for runtime status');
ok(/id="startBtn"[^>]*>Start game<\/button>[\s\S]{0,300}<p class="note" id="sensorStartNote">Once start game, step sensor is initiated\.<\/p>\s*<p class="note" id="gameLockNote">The screen locks when the game starts\./.test(html),'new note under Start game, lock note unchanged');
ok(html.includes('tap Start game and choose Allow'),'denied message points at Start game');
ok(html.includes('setPhoneNote("Step sensor on.");'),'short sensor-on message');
// behavioral: extract startPhoneSteps + start click handler and run with fakes
const src=html.slice(html.indexOf('async function startPhoneSteps()'),html.indexOf('function stopPhoneSteps()'));
const clk=html.slice(html.indexOf('$("startBtn").onclick = () => {'),html.indexOf('const holdGuard'));
function run(perm){
  const log=[];let notes=[],status=[];
  const ctx={state:{running:false,finished:false,elapsed:0},log,
    DeviceMotionEvent: perm===undefined?undefined:{requestPermission:()=>{log.push('perm');return Promise.resolve(perm);}},
  };
  const f=new Function('ctx',`let {state,log}=ctx;let DeviceMotionEvent=ctx.DeviceMotionEvent;let gameHoldDone=false,pocketOn=false,phoneStepsOn=false,sensorLastAt=0;
   const window={removeEventListener(){},addEventListener(t){log.push('listen:'+t);}};
   const onMotion=()=>{};const stepDetector={reset(){}},stepVerifier={reset(){},resume(){},denied(){log.push('denied')},noSensor(){log.push('nosensor')}};
   const performance={now:()=>1};const setInterval=()=>0;const render=()=>{};
   const setStatus=(m)=>log.push('status:'+m);const setPhoneNote=(m)=>log.push('note:'+m);const startSensorDot=()=>log.push('dot');
   const gameWake={start(){log.push('wake');return Promise.resolve();}};const setPocket=(v)=>log.push('pocket:'+v);
   const $=()=>({});const _o={};const $$=_o;
   ${src}
   const btn={}; ${clk.replace('$("startBtn").onclick','btn.onclick')}
   btn.onclick(); return {log,state,on:()=>phoneStepsOn};`);
  return f(ctx);
}
(async()=>{
  let r=run('granted');
  ok(r.log[0]==='status:Game on.'&&r.log[1]==='perm','permission requested synchronously inside the tap');
  ok(r.log.indexOf('wake')>0&&r.log.includes('pocket:true'),'wake + pocket lock set on start');
  await new Promise(x=>setTimeout(x,0));
  ok(r.log.includes('listen:devicemotion')&&r.on(),'sensor started after grant');
  r=run('denied');await new Promise(x=>setTimeout(x,0));
  ok(r.state.running&&r.log.includes('pocket:true')&&r.log.includes('wake'),'game still runs when denied');
  ok(r.log.includes('denied')&&r.log.some(l=>l.includes("steps won't count"))&&!r.on(),'denied path notes steps won\'t count');
  r=run(undefined);
  ok(r.state.running&&r.log.includes('nosensor'),'no sensor API: game runs, practice note');
  // lock/relock still wired
  ok(/if \(pocketOn\) \{ setPocket\(false\); armRelock\(\);/.test(html),'1s hold unlock + relock still wired');
  console.log('PASS washers sensor auto-start ('+n+' checks)');
})().catch(e=>{console.error(e);process.exit(1);});
