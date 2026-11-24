// node test-v1.js : tests the pure logic block (/*LOGIC*/ ... /*ENDLOGIC*/) of index.html (v1)
var fs=require('fs'),assert=require('assert'),src=fs.readFileSync(__dirname+'/index.html','utf8');
var m=src.match(/\/\*LOGIC\*\/([\s\S]*?)\/\*ENDLOGIC\*\//);assert(m,'logic block');
var L=new Function(m[1]+';return{SIG_THR,SIG_CONF,SIG_W,SIG_NAME,sigThr,sigTol,sigBase,sigScore,sigStep,sigRaw,aroonSigText,aroonSeg,aroonRow,aroon,aroonLabel,aroonNote,swAtr,swZones,swInZone,swFlipBars,znTc,znMarkMitig,znLiveOne,znDist,znAtOrReacting,znBlocked,znRange,znPack,znDecide,ZN_NEAR_ATR,ZN_REACT_SEC,PL_MS,PL_SL,PL_LIM_ATR,PL_LIM_FB,plPhtHm,plPhtTag,plUpdatedText,plBucket,plNext,plShouldBuild,plEntry,plSl,plSt,plTp,plLimit,plTriggers,plBuild,plCopyText,plHtml}')(),n=0;
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
 assert.deepStrictEqual(L.aroonSeg({up:14.28,down:100}),{u:'14',d:'100',k:'dn',tag:'SELL'});assert.deepStrictEqual(L.aroonSeg({up:40,down:100}),{u:'40',d:'100',k:'none',tag:'WAIT'});
 assert.deepStrictEqual(L.aroonSeg({up:100,down:0}),{u:'100',d:'0',k:'up',tag:'BUY'});
 assert.deepStrictEqual(L.aroonSeg({up:0,down:100}),{u:'0',d:'100',k:'dn',tag:'SELL'});
 assert.deepStrictEqual(L.aroonSeg({up:50,down:50}),{u:'50',d:'50',k:'none',tag:'WAIT'});
 assert.strictEqual(L.aroonSeg({up:71,down:29}).tag,'BUY');assert.strictEqual(L.aroonSeg({up:70,down:29}).tag,'WAIT');assert.strictEqual(L.aroonSeg({up:29,down:71}).tag,'SELL');assert.strictEqual(L.aroonSeg({up:30,down:71}).tag,'WAIT')});
t('aroonSeg: missing data shows dashes',function(){var na={u:'–',d:'–',k:'na',tag:'–'};assert.deepStrictEqual(L.aroonSeg(null),na);assert.deepStrictEqual(L.aroonSeg(undefined),na)});
t('aroonRow: 5m and 1h from AR, dashes when AR is null or half-loaded',function(){
 var r=L.aroonRow({m5:{up:14,down:100},h1:{up:0,down:50}});assert.strictEqual(r.m5.u,'14');assert.strictEqual(r.m5.d,'100');assert.strictEqual(r.h1.u,'0');assert.strictEqual(r.h1.d,'50');
 var n=L.aroonRow(null);assert.strictEqual(n.m5.u,'–');assert.strictEqual(n.h1.d,'–');var h=L.aroonRow({m5:{up:100,down:0},h1:null});assert.strictEqual(h.m5.tag,'BUY');assert.strictEqual(h.h1.tag,'–')});

t('aroonSigText: bold card text per timeframe (BUY / SELL / WAIT, dash when no data)',function(){assert.strictEqual(L.aroonSigText({up:100,down:0}),'Aroon signal: BUY');assert.strictEqual(L.aroonSigText({up:0,down:100}),'Aroon signal: SELL');assert.strictEqual(L.aroonSigText({up:50,down:50}),'Aroon signal: WAIT');assert.strictEqual(L.aroonSigText({up:70,down:29}),'Aroon signal: WAIT');assert.strictEqual(L.aroonSigText({up:71,down:30}),'Aroon signal: WAIT');assert.strictEqual(L.aroonSigText({up:71,down:29}),'Aroon signal: BUY');assert.strictEqual(L.aroonSigText({up:29,down:71}),'Aroon signal: SELL');assert.strictEqual(L.aroonSigText({up:30,down:71}),'Aroon signal: WAIT');assert.strictEqual(L.aroonSigText(null),'Aroon signal: –')});
t('aroon row never shows UP/DOWN tags any more',function(){['m5','h1'].forEach(function(k){assert(['BUY','SELL','WAIT','–'].indexOf(L.aroonRow({m1:{up:100,down:0},m5:{up:0,down:100},h1:{up:50,down:50}})[k].tag)>=0)});assert.strictEqual(L.aroonRow({m5:{up:100,down:0},h1:{up:0,down:100}}).m5.tag,'BUY');assert.strictEqual(L.aroonRow({m5:{up:100,down:0},h1:{up:0,down:100}}).h1.tag,'SELL')});

t('v1 page: label, 15s Aroon, old wording gone, NFA, feed origin hidden',function(){
 assert(src.indexOf('Momentum (30s-weighted, 1-10 min)')>0);assert(!/10-min move|Momentum \(10|Momentum \(2-min|Momentum \(30-sec/i.test(src));assert(/setInterval\(aroonLoad,15000\)/.test(src));
 assert(/not financial advice/i.test(src));assert(/var BASE=atob\(/.test(src));assert(!/var API='https:/.test(src));
 assert(/Aroon signal: /.test(src)&&/id="arow"/.test(src)&&/id="arc"/.test(src)&&/id="parts"/.test(src))});

// ---- demand / supply zones (v3 order-block rules) + v1 filter ----
function swBar(t,o,h,l,c){return {t:t,open:o,high:h,low:l,close:c}}
function padFlat(n,t0){var a=[],i;for(i=0;i<n;i++)a.push(swBar((t0||0)+i,10,11,9,10));return a}
t('swZones: down bar then impulsive close above it is a demand box',function(){
 var zbars=padFlat(16);zbars.push(swBar(16,10,10.2,8,8.5));zbars.push(swBar(17,8.6,14,8.6,13.5));
 var zs=L.swZones(zbars,L.swAtr(zbars,14),1,zbars.length-1);
 var dem=zs.filter(function(z){return z.k==='DEMAND'&&!z.broken});
 assert(dem.length>=1);assert.strictEqual(dem[dem.length-1].lo,8);assert.strictEqual(dem[dem.length-1].hi,10.2)});
t('swZones: up bar then impulsive close below it is a supply box (BUY/SELL mirror)',function(){
 var sbars=padFlat(16);sbars.push(swBar(16,10,12,9.8,11.5));sbars.push(swBar(17,11.4,11.4,6,6.5));
 var zs=L.swZones(sbars,L.swAtr(sbars,14),1,sbars.length-1);
 var sup=zs.filter(function(z){return z.k==='SUPPLY'&&!z.broken});
 assert(sup.length>=1);assert.strictEqual(sup[sup.length-1].hi,12);assert.strictEqual(sup[sup.length-1].lo,9.8)});
t('swZones: a close through the far side breaks the zone',function(){
 var zbars=padFlat(16);zbars.push(swBar(16,10,10.2,8,8.5));zbars.push(swBar(17,8.6,14,8.6,13.5));
 zbars.push(swBar(18,13,13,7.5,7.8)); // close under demand lo=8
 var zs=L.swZones(zbars,L.swAtr(zbars,14),1,zbars.length-1);
 var dem=zs.filter(function(z){return z.k==='DEMAND'&&z.i===16});
 assert(dem.length>=1);assert.strictEqual(dem[dem.length-1].broken,true);assert.strictEqual(dem[dem.length-1].broke_i,18)});
t('swInZone: a wick into the box counts as a touch; a gap away does not',function(){
 assert(L.swInZone(swBar(1,11,11,10,10.5),{lo:8,hi:10}));
 assert(!L.swInZone(swBar(1,12,13,11,12),{lo:8,hi:10}))});
t('znMarkMitig: first overlap after birth is the touch; earlier bars do not count',function(){
 var zbars=padFlat(16);zbars.push(swBar(16,10,10.2,8,8.5));zbars.push(swBar(17,8.6,14,8.6,13.5));
 zbars.push(swBar(18,13,13.2,12,12.5)); // no touch
 zbars.push(swBar(19,12,12.2,9,11)); // wick into 8–10.2
 var zs=L.swZones(zbars,L.swAtr(zbars,14),1,17);
 assert(zs.some(function(z){return z.k==='DEMAND'&&!z.broken}));
 var dem=zs.filter(function(z){return z.k==='DEMAND'&&!z.broken})[0];
 L.znMarkMitig([dem],zbars);
 assert.strictEqual(dem.mitig_i,19);assert.strictEqual(dem.mitig_t,19)});
t('zones flip: demand/supply boxes swap and high/low flip around a constant',function(){
 var C=8000,zbars=padFlat(16);zbars.push(swBar(16,10,10.2,8,8.5));zbars.push(swBar(17,8.6,14,8.6,13.5));
 var zs=L.swZones(zbars,L.swAtr(zbars,14),1,zbars.length-1);
 var fl=L.swFlipBars(zbars,C),zf=L.swZones(fl,L.swAtr(fl,14),1,fl.length-1);
 assert.strictEqual(zs.length,zf.length);
 zs.forEach(function(z,ix){var m=zf[ix];assert.strictEqual(m.k,z.k==='DEMAND'?'SUPPLY':'DEMAND');assert.ok(Math.abs(m.lo-(C-z.hi))<1e-9);assert.ok(Math.abs(m.hi-(C-z.lo))<1e-9)})});

t('znAtOrReacting: BUY only at a still-fresh demand; SELL mirrors at supply',function(){
 var dem={k:'DEMAND',lo:8,hi:10,i:1,born:2,broken:false,mitig_t:null};
 var bar={t:5,open:9,high:9.5,low:8.5,close:9};
 assert(L.znAtOrReacting('BUY',9,bar,[dem],2,5,10));
 // already mitigated earlier, and price has left the 15m window → not fresh, not reacting
 dem={k:'DEMAND',lo:8,hi:10,i:1,born:2,broken:false,mitig_t:5,mitig_i:5};
 assert.strictEqual(L.znAtOrReacting('BUY',12,bar,[dem],2,5+L.ZN_REACT_SEC+1,10),null);
 // reacting: first touch 600s ago, still within 1 ATR
 dem={k:'DEMAND',lo:8,hi:10,i:1,born:2,broken:false,mitig_t:1000,mitig_i:5};
 assert(L.znAtOrReacting('BUY',11,{t:1600,open:11,high:11.2,low:10.8,close:11},[dem],2,1600,10));
 // too far from the zone
 assert.strictEqual(L.znAtOrReacting('BUY',15,{t:1600,open:15,high:15,low:15,close:15},[dem],2,1600,10),null);
 // SELL at fresh supply
 var sup={k:'SUPPLY',lo:20,hi:22,i:1,born:2,broken:false,mitig_t:null};
 assert(L.znAtOrReacting('SELL',21,{t:5,open:21,high:21.5,low:20.5,close:21},[sup],2,5,10));
 assert.strictEqual(L.znAtOrReacting('BUY',21,{t:5,open:21,high:21.5,low:20.5,close:21},[sup],2,5,10),null)});

t('znBlocked: no BUY when supply is within 1 ATR above; SELL mirrors',function(){
 var sup={k:'SUPPLY',lo:102,hi:104,i:1,born:2,broken:false};
 assert(L.znBlocked('BUY',100,[sup],3,10)); // 102 is 2 <= 1*3 above
 assert.strictEqual(L.znBlocked('BUY',100,[sup],1,10),null); // 2 > 1 ATR
 var dem={k:'DEMAND',lo:96,hi:98,i:1,born:2,broken:false};
 assert(L.znBlocked('SELL',100,[dem],3,10));
 assert.strictEqual(L.znBlocked('SELL',100,[dem],1,10),null);
 // already inside the opposite zone also blocks
 assert(L.znBlocked('BUY',103,[sup],3,10));
 assert.strictEqual(L.znBlocked('BUY',100,[dem],3,10),null); // demand below does not block BUY
});

t('znDecide: toggle off passes the v1 signal through',function(){
 var pack={zones:[],atrNow:2,endI:10};
 assert.strictEqual(L.znDecide('BUY',9,pack,null,5,false).s,'BUY');
 assert.strictEqual(L.znDecide('SELL',9,pack,null,5,false).s,'SELL');
 assert.strictEqual(L.znDecide('WAIT',9,pack,null,5,false).s,'WAIT');
 assert.strictEqual(L.znDecide('BUY',9,pack,null,5,false).why,'')});
t('znDecide: missing 15m data waits instead of passing a raw BUY',function(){
 var r=L.znDecide('BUY',9,null,null,5,true);
 assert.strictEqual(r.s,'WAIT');assert(/15m/.test(r.why))});
t('znDecide (c): BUY only at fresh demand with no nearby supply; SELL is the exact mirror',function(){
 var dem={k:'DEMAND',lo:8,hi:10,i:1,born:2,broken:false,mitig_t:null};
 var pack={zones:[dem],atrNow:2,endI:10};
 var bar={t:5,open:9,high:9.5,low:8.5,close:9};
 var r=L.znDecide('BUY',9,pack,bar,5,true);
 assert.strictEqual(r.s,'BUY');assert.strictEqual(r.why,'BUY at demand 8–10');
 var r2=L.znDecide('BUY',20,pack,{t:5,open:20,high:20,low:20,close:20},5,true);
 assert.strictEqual(r2.s,'WAIT');assert(/not at a fresh demand zone/.test(r2.why));
 var C=100;
 var packS={zones:L.swFlipBars?null:null};
 var sup={k:'SUPPLY',lo:C-10,hi:C-8,i:1,born:2,broken:false,mitig_t:null}; // 90–92
 var pack2={zones:[sup],atrNow:2,endI:10};
 var barS={t:5,open:C-9,high:C-8.5,low:C-9.5,close:C-9};
 var rS=L.znDecide('SELL',C-9,pack2,barS,5,true);
 assert.strictEqual(rS.s,'SELL');assert.strictEqual(rS.why,'SELL at supply 90–92');
 // blocked by opposite zone even when at a fresh zone
 var nearSup={k:'SUPPLY',lo:11,hi:12,i:3,born:4,broken:false,mitig_t:null};
 var pack3={zones:[dem,nearSup],atrNow:2,endI:10};
 var rB=L.znDecide('BUY',9,pack3,bar,5,true);
 assert.strictEqual(rB.s,'WAIT');assert(/supply 11–12 is within 1 ATR above/.test(rB.why));
 var nearDem={k:'DEMAND',lo:C-12,hi:C-11,i:3,born:4,broken:false,mitig_t:null}; // 88–89
 var pack4={zones:[sup,nearDem],atrNow:2,endI:10};
 var rBS=L.znDecide('SELL',C-9,pack4,barS,5,true);
 assert.strictEqual(rBS.s,'WAIT');assert(/demand 88–89 is within 1 ATR below/.test(rBS.why));
 // full flip of decide: flipping price and zones swaps BUY/SELL and the reason text
 var flipZ=function(z){return{k:z.k==='DEMAND'?'SUPPLY':'DEMAND',lo:C-z.hi,hi:C-z.lo,i:z.i,born:z.born,broken:z.broken,mitig_t:z.mitig_t,broke_i:z.broke_i}};
 function flipBar(b){return{t:b.t,open:C-b.open,high:C-b.low,low:C-b.high,close:C-b.close}}
 function flipSide(x){return x==='BUY'?'SELL':x==='SELL'?'BUY':x}
 var cases=[['BUY',9,pack,bar],['BUY',20,pack,{t:5,open:20,high:20,low:20,close:20}],['BUY',9,pack3,bar]];
 cases.forEach(function(c){
  var A=L.znDecide(c[0],c[1],c[2],c[3],5,true);
  var B=L.znDecide(flipSide(c[0]),C-c[1],{zones:(c[2].zones||[]).map(flipZ),atrNow:c[2].atrNow,endI:c[2].endI},flipBar(c[3]),5,true);
  assert.strictEqual(B.s,flipSide(A.s));
  assert.strictEqual(B.kind,A.kind);
  var exp=A.why.replace(/BUY/g,'#S#').replace(/SELL/g,'BUY').replace(/#S#/g,'SELL').replace(/demand/g,'#D#').replace(/supply/g,'demand').replace(/#D#/g,'supply').replace(/\babove\b/g,'#A#').replace(/\bbelow\b/g,'above').replace(/#A#/g,'below').replace(/(\d+)–(\d+)/g,function(_,a,b){return (C-+b)+'–'+(C-+a)});
  assert.strictEqual(B.why,exp);
 });
});
t('znRange rounds the box for the reason line',function(){assert.strictEqual(L.znRange({lo:3610.4,hi:3614.6}),'3610–3615')});

t('v1 page: zone toggle, reason line, demand/supply colours, filter wired',function(){
 assert(/id="znOn"/.test(src)&&/id="sigwhy"/.test(src));
 assert(/Use demand\/supply in the signal/.test(src));
 assert(/#00ffc8/.test(src)&&/#ff4fa3/.test(src));
 assert(/function znDecide/.test(src)&&/ZPACK=znPack/.test(src));
 assert(/localStorage\.gdZ1/.test(src));
 assert(/interval=15m/.test(src));
 assert(/When the zone filter is on/.test(src))});


// ---- 2-minute BUY/SELL plan card ----
t('plan clock: 2-minute buckets, PHT 24-hour time, and the updated line',function(){
 assert.strictEqual(L.PL_MS,120000);
 var t=Date.UTC(2026,10,24,7,58,30); // 15:58:30 PHT
 assert.strictEqual(L.plBucket(t),Date.UTC(2026,10,24,7,58,0));
 assert.strictEqual(L.plNext(t),Date.UTC(2026,10,24,8,0,0));
 assert.strictEqual(L.plShouldBuild(null,t),true);
 assert.strictEqual(L.plShouldBuild(L.plBucket(t),t),false);
 assert.strictEqual(L.plShouldBuild(L.plBucket(t),L.plBucket(t)+119999),false);
 assert.strictEqual(L.plShouldBuild(L.plBucket(t),Date.UTC(2026,10,24,8,0,0)),true);
 assert.strictEqual(L.plShouldBuild(L.plBucket(t)-L.PL_MS,t),true);
 assert.strictEqual(L.plPhtHm(Date.UTC(2026,10,24,7,58,0)),'15:58');
 assert.strictEqual(L.plPhtHm(Date.UTC(2026,10,21,12,45,0)),'20:45');
 assert.strictEqual(L.plPhtHm(Date.UTC(2026,10,21,16,0,0)),'00:00');
 assert.strictEqual(L.plPhtHm(Date.UTC(2026,10,21,16,5,0)),'00:05');
 assert.strictEqual(L.plPhtTag(Date.UTC(2026,10,24,7,58,0)),'15:58 PHT');
 assert.strictEqual(L.plUpdatedText(Date.UTC(2026,10,24,7,58,0),Date.UTC(2026,10,24,8,0,0)),'Updated 15:58 PHT · next 16:00');
 assert.strictEqual(L.plPhtHm(Date.UTC(2026,10,24,7,58,0)/1000),'15:58'); // seconds also ok
});

t('plEntry uses ask for BUY and bid for SELL; mid is the fallback',function(){
 assert.strictEqual(L.plEntry('BUY',100,99.8,100.2),100.2);
 assert.strictEqual(L.plEntry('SELL',100,99.8,100.2),99.8);
 assert.strictEqual(L.plEntry('BUY',100,null,null),100);
 assert.strictEqual(L.plEntry('SELL',100,undefined,undefined),100);
 assert.strictEqual(L.plSl('BUY',100.2),100.2*(1-L.PL_SL));
 assert.strictEqual(L.plSl('SELL',99.8),99.8*(1+L.PL_SL));
 assert.strictEqual(L.PL_SL,0.0005);
 assert.strictEqual(L.plSt(2,100),3);
 assert.strictEqual(L.plSt(null,100),100*0.003)});

t('plCopyText is a 2-decimal price, ready to paste into MT5',function(){
 assert.strictEqual(L.plCopyText(3612.4),'3612.40');
 assert.strictEqual(L.plCopyText(3515),'3515.00');
 assert.strictEqual(L.plCopyText(L.plSl('BUY',100.2)),(100.2*(1-0.0005)).toFixed(2))});

function zFresh(k,lo,hi){return{k:k,lo:lo,hi:hi,i:1,born:2,broken:false,mitig_t:null,mitig_i:null}}
t('plLimit: nearest fresh demand top below price, else entry minus 0.5× 5m ATR; SELL mirrors',function(){
 var atr=2,entryB=100.2,entryS=99.8,mid=100;
 assert.strictEqual(L.PL_LIM_ATR,2);assert.strictEqual(L.PL_LIM_FB,0.5);
 // fallback, no zones
 assert.strictEqual(L.plLimit('BUY',entryB,mid,atr,[],10),entryB-0.5*atr);
 assert.strictEqual(L.plLimit('SELL',entryS,mid,atr,[],10),entryS+0.5*atr);
 // zone within 2 ATR
 var dem=zFresh('DEMAND',96,98),sup=zFresh('SUPPLY',102,104);
 assert.strictEqual(L.plLimit('BUY',entryB,mid,atr,[dem],10),98);
 assert.strictEqual(L.plLimit('SELL',entryS,mid,atr,[sup],10),102);
 // zone too far (>2 ATR) → fallback
 var farD=zFresh('DEMAND',80,90),farS=zFresh('SUPPLY',110,120);
 assert.strictEqual(L.plLimit('BUY',entryB,mid,atr,[farD],10),entryB-0.5*atr);
 assert.strictEqual(L.plLimit('SELL',entryS,mid,atr,[farS],10),entryS+0.5*atr);
 // already-touched zone is not used
 var used=zFresh('DEMAND',96,98);used.mitig_t=1;
 assert.strictEqual(L.plLimit('BUY',entryB,mid,atr,[used],10),entryB-0.5*atr);
 // nearest of two fresh demand boxes below
 var d1=zFresh('DEMAND',94,96),d2=zFresh('DEMAND',97,99);
 assert.strictEqual(L.plLimit('BUY',entryB,mid,atr,[d1,d2],10),99)});

t('plTp: TP1 is 1.5×ATR, TP2 is the next key level or 2× TP1 distance, TP3 is 3× or a nearer fresh opposing zone beyond TP2',function(){
 var e=100.2,atr=2,st=3; // TP1 dist
 var t=L.plTp('BUY',e,atr,[90,200],[],10); // 200 is far
 assert.strictEqual(t.tp1,e+st);
 assert.strictEqual(t.tp2,200); // next key level beyond TP1
 // 3× TP1 = 109.2 sits before TP2=200, so TP3 extends one TP1-step past TP2
 assert.strictEqual(t.tp3,200+st);
 var t2=L.plTp('BUY',e,atr,[],[],10);
 assert.strictEqual(t2.tp1,e+st);assert.strictEqual(t2.tp2,e+2*st);assert.strictEqual(t2.tp3,e+3*st);
 var sup=zFresh('SUPPLY',108,110); // lo=108 is beyond TP2=106.2 and nearer than 109.2
 var t3=L.plTp('BUY',e,atr,[], [sup],10);
 assert.strictEqual(t3.tp2,e+2*st);
 assert.strictEqual(t3.tp3,108);
 var t4=L.plTp('SELL',99.8,atr,[], [zFresh('DEMAND',90,91.6)],10);
 assert.strictEqual(t4.tp1,99.8-st);
 assert.strictEqual(t4.tp2,99.8-2*st);
 assert.strictEqual(t4.tp3,91.6)});

t('plBuild BUY/SELL are exact mirrors, including bid/ask, zones, and key levels',function(){
 var now=Date.UTC(2026,10,24,7,58,30),C=8000;
 var dem=zFresh('DEMAND',96,98),sup=zFresh('SUPPLY',102,104);
 var opt={side:'BUY',mid:100,bid:99.8,ask:100.2,atr:2,levels:[90,107],zones:[dem,sup],endI:10,nowMs:now,filterOn:true};
 var A=L.plBuild(opt);
 assert.strictEqual(A.s,'BUY');
 assert.strictEqual(A.t0,Date.UTC(2026,10,24,7,58,0));
 assert.strictEqual(A.t1,Date.UTC(2026,10,24,8,0,0));
 assert.strictEqual(A.time,'15:58');
 assert.strictEqual(A.updated,'Updated 15:58 PHT · next 16:00');
 assert.strictEqual(A.entry,100.2);
 assert.strictEqual(A.sl,100.2*(1-0.0005));
 assert.strictEqual(A.tp1,100.2+3);
 assert.strictEqual(A.tp2,107); // key level between TP1=103.2 and 3×=109.2
 assert.strictEqual(A.tp3,100.2+9); // no opposing zone between 107 and 109.2
 assert.strictEqual(A.limit,98);
 assert(/0\.01 lot split in thirds/.test(A.lot));
 function flipZ(z){return{k:z.k==='DEMAND'?'SUPPLY':'DEMAND',lo:C-z.hi,hi:C-z.lo,i:z.i,born:z.born,broken:z.broken,mitig_t:z.mitig_t,mitig_i:z.mitig_i}}
 var B=L.plBuild({side:'SELL',mid:C-100,bid:C-100.2,ask:C-99.8,atr:2,levels:[C-90,C-107],zones:[dem,sup].map(flipZ),endI:10,nowMs:now,filterOn:true});
 assert.strictEqual(B.s,'SELL');
 assert.strictEqual(B.entry,C-A.entry);
 // SL is 0.05% of the fill, so it mirrors in percent, not as a dollar flip around C
 assert.ok(Math.abs((A.entry-A.sl)/A.entry - (B.sl-B.entry)/B.entry)<1e-12);
 assert.strictEqual(A.sl,A.entry*(1-L.PL_SL));
 assert.strictEqual(B.sl,B.entry*(1+L.PL_SL));
 assert.ok(Math.abs(B.tp1-(C-A.tp1))<1e-9);
 assert.ok(Math.abs(B.tp2-(C-A.tp2))<1e-9);
 assert.ok(Math.abs(B.tp3-(C-A.tp3))<1e-9);
 assert.ok(Math.abs(B.limit-(C-A.limit))<1e-9);
 assert.strictEqual(B.time,A.time);assert.strictEqual(B.updated,A.updated)});

t('plBuild WAIT: no plan, but nearby fresh zone levels are shown as triggers',function(){
 var now=Date.UTC(2026,10,24,7,58,0);
 var dem=zFresh('DEMAND',96,98),sup=zFresh('SUPPLY',102,104);
 var W=L.plBuild({side:'WAIT',mid:100,bid:99.8,ask:100.2,atr:2,levels:[],zones:[dem,sup],endI:10,nowMs:now,filterOn:true});
 assert.strictEqual(W.s,'WAIT');
 assert.strictEqual(W.entry,null);assert.strictEqual(W.sl,null);assert.strictEqual(W.tp1,null);
 assert.strictEqual(W.time,'15:58');
 assert(W.triggers&&W.triggers.buy&&W.triggers.sell);
 assert.strictEqual(W.triggers.buy.hi,98);assert.strictEqual(W.triggers.sell.lo,102);
 var off=L.plBuild({side:'WAIT',mid:100,bid:99.8,ask:100.2,atr:2,levels:[],zones:[dem,sup],endI:10,nowMs:now,filterOn:false});
 assert.strictEqual(off.s,'WAIT');
 assert.strictEqual(off.triggers.buy,null);assert.strictEqual(off.triggers.sell,null);
 var none=L.plBuild({side:'WAIT',mid:100,bid:99.8,ask:100.2,atr:2,levels:[],zones:[],endI:10,nowMs:now,filterOn:true});
 assert.strictEqual(none.triggers.buy,null);assert.strictEqual(none.triggers.sell,null)});

t('plHtml: prices, copy buttons, WAIT wording, and the lot split hint',function(){
 var now=Date.UTC(2026,10,24,7,58,0);
 var p=L.plBuild({side:'BUY',mid:100,bid:99.8,ask:100.2,atr:2,levels:[],zones:[zFresh('DEMAND',96,98)],endI:10,nowMs:now,filterOn:true});
 var h=L.plHtml(p);
 assert(/BUY plan/.test(h)&&/15:58/.test(h));
 assert(/Updated 15:58 PHT · next 16:00/.test(h));
 assert(/Buy at/.test(h)&&/Stop loss/.test(h)&&/TP1/.test(h)&&/TP2/.test(h)&&/TP3/.test(h)&&/Buy Limit at/.test(h));
 assert(/data-copy="100\.20"/.test(h));
 assert(/data-copy="103\.20"/.test(h)); // TP1
 assert(/data-copy="98\.00"/.test(h));
 assert(/0\.01 lot split in thirds/.test(h));
 assert((h.match(/data-copy=/g)||[]).length>=6); // entry, sl, tp1, tp2, tp3, limit
 var w=L.plHtml(L.plBuild({side:'WAIT',mid:100,bid:99.8,ask:100.2,atr:2,levels:[],zones:[zFresh('DEMAND',96,98),zFresh('SUPPLY',102,104)],endI:10,nowMs:now,filterOn:true}));
 assert(/WAIT – no plan/.test(w)||/WAIT – no plan/.test(w));
 assert(/demand 96–98/.test(w)&&/supply 102–104/.test(w));
 assert(!/Buy at/.test(w));
 var w2=L.plHtml(L.plBuild({side:'WAIT',mid:100,bid:99.8,ask:100.2,atr:2,levels:[],zones:[],endI:10,nowMs:now,filterOn:false}));
 assert(/WAIT – no plan/.test(w2));
 assert(!/demand /.test(w2)&&!/Buy at/.test(w2))});

t('v1 page: plan card under the signal, 2-minute refresh, relabeled ATR card, NFA, copy buttons',function(){
 assert(/id="plan"/.test(src));
 assert(/plShouldBuild/.test(src)&&/PL_MS=120000/.test(src));
 assert(/TP1 distance \(1\.5×ATR14, 5m\)/.test(src));
 assert(!/Stop \(1\.5×ATR14, 5m\)/.test(src));
 assert(/not financial advice/i.test(src));
 assert(/data-copy/.test(src)||/function plHtml/.test(src));
 assert(/var BASE=atob\(/.test(src));assert(!/var API='https:/.test(src))});

console.log(n+' tests passed');
