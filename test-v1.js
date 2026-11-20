// node test-v1.js : tests the pure logic block (/*LOGIC*/ ... /*ENDLOGIC*/) of index.html (v1)
var fs=require('fs'),assert=require('assert'),src=fs.readFileSync(__dirname+'/index.html','utf8');
var m=src.match(/\/\*LOGIC\*\/([\s\S]*?)\/\*ENDLOGIC\*\//);assert(m,'logic block');
var L=new Function(m[1]+';return{SIG_THR,SIG_CONF,SIG_W,SIG_NAME,sigThr,sigTol,sigBase,sigScore,sigStep,sigRaw,aroonSeg,aroonRow,aroon,aroonLabel,aroonNote}')(),n=0;
function t(name,fn){fn();n++;console.log('ok',name)}
// Aroon(14)
function bars(hs,ls){return hs.map(function(h,i){return{high:h,low:ls[i]}})}
function flat(n){var h=[],l=[];for(var i=0;i<n;i++){h.push(100);l.push(50)}return{h:h,l:l}}
t('aroon: high on newest bar → Up 100; low 14 bars ago → Down 0',function(){var f=flat(15);f.h[14]=120;f.l[0]=40;var a=L.aroon(bars(f.h,f.l),14);assert.strictEqual(a.up,100);assert.strictEqual(a.down,0)});
t('aroon: high 14 bars ago → Up 0; low on newest → Down 100',function(){var f=flat(15);f.h[0]=120;f.l[14]=40;var a=L.aroon(bars(f.h,f.l),14);assert.strictEqual(a.up,0);assert.strictEqual(a.down,100)});
t('aroon: exact values for high 3 bars ago, low 7 bars ago',function(){var f=flat(15);f.h[11]=130;f.l[7]=30;var a=L.aroon(bars(f.h,f.l),14);assert.strictEqual(a.up,100*(14-3)/14);assert.strictEqual(a.down,100*(14-7)/14)});
t('aroon: only the last 15 bars count (older extremes ignored)',function(){var f=flat(30);f.h[0]=999;f.l[0]=1;f.h[20]=130;f.l[28]=30;var a=L.aroon(bars(f.h,f.l),14);assert.strictEqual(a.up,100*(14-9)/14);assert.strictEqual(a.down,100*(14-1)/14)});
t('aroon: ties use the most recent extreme',function(){var f=flat(15);var a=L.aroon(bars(f.h,f.l),14);assert.strictEqual(a.up,100);assert.strictEqual(a.down,100)});
t('aroon: needs 15 bars, else null',function(){assert.strictEqual(L.aroon(bars(flat(14).h,flat(14).l),14),null);assert.strictEqual(L.aroon([],14),null);assert.strictEqual(L.aroon(null,14),null)});
t('aroon: rising series → Up 100, Down 0 (uptrend)',function(){var h=[],l=[];for(var i=0;i<20;i++){h.push(100+i);l.push(90+i)}var a=L.aroon(bars(h,l),14);assert.strictEqual(a.up,100);assert.strictEqual(a.down,0);assert.strictEqual(L.aroonLabel(a.up,a.down).k,'up')});
t('aroon: falling series → downtrend',function(){var h=[],l=[];for(var i=0;i<20;i++){h.push(100-i);l.push(90-i)}var a=L.aroon(bars(h,l),14);assert.strictEqual(a.up,0);assert.strictEqual(a.down,100);assert.strictEqual(L.aroonLabel(a.up,a.down).k,'dn')});
t('aroon label wording',function(){assert.strictEqual(L.aroonLabel(100,0).t,'Uptrend: buyers in control');assert.strictEqual(L.aroonLabel(0,100).t,'Downtrend: sellers in control');assert.strictEqual(L.aroonLabel(50,50).t,'No clear trend: wait');assert.strictEqual(L.aroonLabel(null,null).t,'No clear trend: wait')});
t('aroon label boundaries: 70/30 are NOT enough (strict)',function(){
 assert.strictEqual(L.aroonLabel(70,29).k,'none');assert.strictEqual(L.aroonLabel(71,30).k,'none');assert.strictEqual(L.aroonLabel(70,30).k,'none');
 assert.strictEqual(L.aroonLabel(71,29).k,'up');assert.strictEqual(L.aroonLabel(70.01,29.99).k,'up');
 assert.strictEqual(L.aroonLabel(29,70).k,'none');assert.strictEqual(L.aroonLabel(30,71).k,'none');assert.strictEqual(L.aroonLabel(30,70).k,'none');
 assert.strictEqual(L.aroonLabel(29,71).k,'dn');assert.strictEqual(L.aroonLabel(29.99,70.01).k,'dn');
 assert.strictEqual(L.aroonLabel(100,100).k,'none');assert.strictEqual(L.aroonLabel(0,0).k,'none')});
t('aroon note says confirm, not predict',function(){assert(/confirms a trend/i.test(L.aroonNote)&&/can.t predict/i.test(L.aroonNote)&&!/biquote/i.test(L.aroonNote))});

// weighted multi-window momentum (30s .40, 1m .20, 2m .15, 5m .15, 10m .10)
function run(ps,thr,st){st=st||{s:'WAIT',c:null,n:0};var out=[];ps.forEach(function(p){st=L.sigStep(st,p,thr==null?L.SIG_THR:thr);out.push(st.s)});return out}
t('weights, windows, label, trigger',function(){assert.deepStrictEqual(L.SIG_W.map(function(x){return x.ms}),[30000,60000,120000,300000,600000]);assert.deepStrictEqual(L.SIG_W.map(function(x){return x.w}),[0.4,0.2,0.15,0.15,0.1]);assert(Math.abs(L.SIG_W.reduce(function(s,x){return s+x.w},0)-1)<1e-12);assert.strictEqual(L.SIG_THR,1);assert.strictEqual(L.SIG_CONF,3);assert.strictEqual(L.SIG_NAME,'Momentum (30s-weighted, 1-10 min)')});
t('per-window threshold = 0.02% x sqrt(window/10min)',function(){L.SIG_W.forEach(function(x){assert(Math.abs(L.sigThr(x.ms)-0.02*Math.sqrt(x.ms/600000))<1e-12)});assert.strictEqual(L.sigThr(600000),0.02);assert(Math.abs(L.sigThr(30000)-0.004472)<1e-6);assert(Math.abs(L.sigThr(60000)-0.006325)<1e-6);assert(Math.abs(L.sigThr(120000)-0.008944)<1e-6);assert(Math.abs(L.sigThr(300000)-0.014142)<1e-6)});
// history where price p0 was px at each window base and now is m
function H5(now,px){var h=[];L.SIG_W.forEach(function(x,i){h.push([now-x.ms-1000,px[i]])});h.sort(function(a,b){return a[0]-b[0]});return h}
t('score: every window moves exactly its own threshold → score 1 (BUY boundary)',function(){var now=1e6,m=100,px=L.SIG_W.map(function(x){return m/(1+L.sigThr(x.ms)/100)});var r=L.sigScore(H5(now,px),now,m);assert(Math.abs(r.score-1)<1e-9);assert.strictEqual(r.parts.length,5);r.parts.forEach(function(p){assert(Math.abs(p.z-1)<1e-9)})});
t('score: only the 30s window moves 1x → 0.40; 2x → 0.80; all-zero → 0',function(){var now=1e6,m=100,flat=[m,m,m,m,m];assert.strictEqual(L.sigScore(H5(now,flat),now,m).score,0);var a=flat.slice();a[0]=m/(1+L.sigThr(30000)/100);assert(Math.abs(L.sigScore(H5(now,a),now,m).score-0.4)<1e-9);a[0]=m/(1+2*L.sigThr(30000)/100);assert(Math.abs(L.sigScore(H5(now,a),now,m).score-0.8)<1e-9)});
t('score: each window contributes its weight (1m .2, 2m .15, 5m .15, 10m .1)',function(){var now=1e6,m=100;[1,2,3,4].forEach(function(i){var a=[m,m,m,m,m];a[i]=m/(1+L.sigThr(L.SIG_W[i].ms)/100);assert(Math.abs(L.sigScore(H5(now,a),now,m).score-L.SIG_W[i].w)<1e-9)})});
t('score: falling price gives negative score, symmetric',function(){var now=1e6,m=100,px=L.SIG_W.map(function(x){return m*(1+L.sigThr(x.ms)/100)});var r=L.sigScore(H5(now,px),now,m);assert(r.score<-0.99&&r.score>-1.01);assert(r.parts.every(function(p){return p.p<0}))});
t('score: windows without history count 0 (no fake move)',function(){var now=1e6,m=100;var r=L.sigScore([[now-31000,m/(1+L.sigThr(30000)/100)]],now,m);assert(Math.abs(r.score-0.4)<1e-9);assert.strictEqual(r.parts[4].p,0);assert.strictEqual(L.sigScore([],now,m).score,0)});
t('sigRaw: ±1 triggers (inclusive), just below is WAIT',function(){assert.strictEqual(L.sigRaw(1,1,'WAIT'),'BUY');assert.strictEqual(L.sigRaw(-1,1,'WAIT'),'SELL');assert.strictEqual(L.sigRaw(0.9999,1,'WAIT'),'WAIT');assert.strictEqual(L.sigRaw(-0.9999,1,'WAIT'),'WAIT');assert.strictEqual(L.sigRaw(0,1,'WAIT'),'WAIT')});
t('signal needs 3 ticks in a row to turn BUY / SELL',function(){assert.deepStrictEqual(run([2,2,2]),['WAIT','WAIT','BUY']);assert.deepStrictEqual(run([-2,-2,-2,-2]),['WAIT','WAIT','SELL','SELL'])});
t('one- or two-tick blip does not flip the signal',function(){assert.deepStrictEqual(run([3,0,3,3,0,3]),['WAIT','WAIT','WAIT','WAIT','WAIT','WAIT']);assert.deepStrictEqual(run([3,3,0,0,0]),['WAIT','WAIT','WAIT','WAIT','WAIT'])});
t('alternating noise around the trigger never flips',function(){var p=[];for(var i=0;i<40;i++)p.push(i%2?1.3:-1.3);assert(run(p).every(function(x){return x=='WAIT'}))});
t('hysteresis: BUY holds while score >= 0.5, drops after 3 ticks below',function(){assert.deepStrictEqual(run([2,2,2,0.6,0.4,0.4,0.4]),['WAIT','WAIT','BUY','BUY','BUY','BUY','WAIT']);assert.deepStrictEqual(run([2,2,2,0.5,0.5,0.5,0.5]).slice(2),['BUY','BUY','BUY','BUY','BUY'])});
t('hysteresis: dips between 0.5 and 1 keep BUY indefinitely',function(){var p=[2,2,2];for(var i=0;i<20;i++)p.push(0.7);assert(run(p).slice(2).every(function(x){return x=='BUY'}))});
t('BUY → SELL needs 3 straight SELL ticks',function(){var st={s:'BUY',c:null,n:0};assert.deepStrictEqual(run([-2,-2,-2],null,st),['BUY','BUY','SELL']);st={s:'BUY',c:null,n:0};assert.deepStrictEqual(run([-2,-2,2,-2,-2],null,st),['BUY','BUY','BUY','BUY','BUY'])});
t('SELL holds symmetric, and exits to WAIT after 3 ticks inside the band',function(){var st={s:'SELL',c:null,n:0};assert.deepStrictEqual(run([-0.6,-0.6,-0.6],null,st),['SELL','SELL','SELL']);st={s:'SELL',c:null,n:0};assert.deepStrictEqual(run([-0.4,-0.4,-0.4],null,st),['SELL','SELL','WAIT'])});
t('sigStep does not mutate its input',function(){var st={s:'WAIT',c:null,n:0},a=L.sigStep(st,5,1);assert.deepStrictEqual(st,{s:'WAIT',c:null,n:0});assert.notStrictEqual(a,st)});
function hist(now,step,span,px){var h=[];for(var t0=now-span;t0<=now;t0+=step)h.push([t0,px(t0)]);return h}
t('sigBase: 1.5s ticks → base entry is the last one at least `ms` old, for every window',function(){var now=1e6,h=hist(now,1500,900000,function(t){return 100+(t-now)/1e6});L.SIG_W.forEach(function(x){var b=L.sigBase(h,now,x.ms,L.sigTol(x.ms));assert(b&&b[0]<=now-x.ms&&now-b[0]<x.ms+1500)})});
t('sigBase: no history old enough, or stale base → null',function(){var now=1e6;assert.strictEqual(L.sigBase([],now,30000,10000),null);assert.strictEqual(L.sigBase([[now-10000,1],[now,1]],now,30000,10000),null);assert.strictEqual(L.sigBase([[now-90000,1],[now,1]],now,30000,10000),null);assert.notStrictEqual(L.sigBase([[now-35000,1],[now,1]],now,30000,10000),null)});
t('sigBase: exact boundary and tolerance; sigTol grows with window',function(){var now=1e6;assert.notStrictEqual(L.sigBase([[now-30000,1]],now,30000,10000),null);assert.notStrictEqual(L.sigBase([[now-40000,1]],now,30000,10000),null);assert.strictEqual(L.sigBase([[now-40001,1]],now,30000,10000),null);assert.strictEqual(L.sigTol(30000),10000);assert(L.sigTol(600000)>=60000)});
t('15 min of 1.5s history covers the full 10-min window (>=600 points)',function(){var now=1e6,h=hist(now,1500,900000,function(){return 1});assert(h.length>=600);assert(L.sigBase(h,now,600000,L.sigTol(600000)))});

// Aroon top row segment
t('aroonSeg: values rounded, colour kind and tag',function(){
 assert.deepStrictEqual(L.aroonSeg({up:14.28,down:100}),{u:'14',d:'100',k:'dn',tag:'DOWN'});assert.deepStrictEqual(L.aroonSeg({up:40,down:100}),{u:'40',d:'100',k:'none',tag:'WAIT'});
 assert.deepStrictEqual(L.aroonSeg({up:100,down:0}),{u:'100',d:'0',k:'up',tag:'UP'});
 assert.deepStrictEqual(L.aroonSeg({up:0,down:100}),{u:'0',d:'100',k:'dn',tag:'DOWN'});
 assert.deepStrictEqual(L.aroonSeg({up:50,down:50}),{u:'50',d:'50',k:'none',tag:'WAIT'});
 assert.strictEqual(L.aroonSeg({up:71,down:29}).tag,'UP');assert.strictEqual(L.aroonSeg({up:70,down:29}).tag,'WAIT');assert.strictEqual(L.aroonSeg({up:29,down:71}).tag,'DOWN');assert.strictEqual(L.aroonSeg({up:30,down:71}).tag,'WAIT')});
t('aroonSeg: missing data shows dashes',function(){var na={u:'–',d:'–',k:'na',tag:'–'};assert.deepStrictEqual(L.aroonSeg(null),na);assert.deepStrictEqual(L.aroonSeg(undefined),na)});
t('aroonRow: 5m and 1h from AR, dashes when AR is null or half-loaded',function(){
 var r=L.aroonRow({m5:{up:14,down:100},h1:{up:0,down:50}});assert.strictEqual(r.m5.u,'14');assert.strictEqual(r.m5.d,'100');assert.strictEqual(r.h1.u,'0');assert.strictEqual(r.h1.d,'50');
 var n=L.aroonRow(null);assert.strictEqual(n.m5.u,'–');assert.strictEqual(n.h1.d,'–');var h=L.aroonRow({m5:{up:100,down:0},h1:null});assert.strictEqual(h.m5.tag,'UP');assert.strictEqual(h.h1.tag,'–')});

t('v1 page: label, 15s Aroon, old wording gone, data credit kept',function(){assert(src.indexOf('Momentum (30s-weighted, 1-10 min)')>0);assert(!/10-min move|Momentum \(10|Momentum \(2-min|Momentum \(30-sec/i.test(src));assert(/setInterval\(aroonLoad,15000\)/.test(src));assert(/Data: biquote\.io/.test(src));assert(/id="arow"/.test(src)&&/id="arc"/.test(src)&&/id="parts"/.test(src))});
console.log(n+' tests passed');
