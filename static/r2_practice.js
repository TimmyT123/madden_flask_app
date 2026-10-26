// HB Vision + Moves 3D v0.1 | 2026-10-26
// Standalone sister drill to WURD R2 Practice v20. No changes to original R2 practice.
'use strict';
(() => {
 const $=id=>document.getElementById(id), canvas=$('field'),ctx=canvas.getContext('2d');
 const ui={drill:$('drill'),speed:$('speed'),start:$('start'),pause:$('pause'),reset:$('reset'),status:$('status'),hint:$('hint'),score:$('score'),attempts:$('attempts'),accuracy:$('accuracy'),combo:$('combo'),control:$('control'),r2:$('r2'),stage:$('stage'),read:$('read'),tips:$('tips'),buttons:$('buttons')};
 const drills=[
 {type:'juke-left',name:'JUKE LEFT',why:'Defender closes from your right. Plant, juke LEFT into space.',x:2.2,dx:-.26,move:'juke-left',best:'RS ←',tip:'Wait until the tackler approaches, then flick the right stick LEFT.'},
 {type:'juke-right',name:'JUKE RIGHT',why:'Defender shades your left. Juke RIGHT into the open grass.',x:-2.2,dx:.26,move:'juke-right',best:'RS →',tip:'Use the juke opposite the defender’s leverage, then get vertical.'},
 {type:'spin',name:'SPIN',why:'Defender over-runs your outside hip. Spin off the contact angle.',x:1.1,dx:.19,move:'spin',best:'○',tip:'Spin against an over-pursuing defender, not into a crowd.'},
 {type:'truck',name:'TRUCK',why:'A smaller DB squares up in a narrow downhill lane.',x:0,dx:0,move:'truck',best:'RS ↑',tip:'Stay north–south, build momentum, and truck near contact.'},
 {type:'stiff',name:'STIFF ARM',why:'A defender reaches from your right while the edge is open.',x:2.15,dx:-.11,move:'stiff',best:'✕',tip:'Maintain outside leverage; stiff-arm the reaching tackler.'},
 {type:'deadleg',name:'DEAD LEG',why:'An aggressive linebacker charges straight ahead.',x:0,dx:.08,move:'deadleg',best:'RS ↓',tip:'Use a dead leg to make an over-aggressive tackler miss, then accelerate.'},
 {type:'none',name:'NO MOVE — BURST',why:'The lane is wide open. Do not waste momentum on a move.',x:4.2,dx:0,move:'none',best:'R2 after the crease',tip:'A good running back knows when NOT to use a move.'}
 ];
 const state={running:false,paused:false,startTime:0,prev:0,progress:0,x:0,velocity:0,speed:0,scenario:null,responded:false,result:'',attempts:0,correct:0,combo:0,points:0,moveAt:0,moveName:'',r2Early:false,r2Ever:false,r2:false,activePad:null,lastBtn:[],lastRight:{x:0,y:0},keys:new Set(),phase:'Ready',lastChange:0,freeze:0};
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));const rand=a=>a[Math.floor(Math.random()*a.length)];
 const diff=()=>({rookie:.7,pro:1,allpro:1.3,allmadden:1.65})[ui.speed.value]||1;
 function setStatus(s){ui.status.textContent=s}
 function updateUI(){ui.score.textContent=state.points;ui.attempts.textContent=state.attempts;ui.accuracy.textContent=state.attempts?Math.round(state.correct/state.attempts*100)+'%':'—';ui.combo.textContent=state.combo;ui.stage.textContent=state.phase;ui.r2.textContent=state.r2?'R2 HELD':'R2 RELEASED';ui.r2.classList.toggle('warn',state.r2&&state.progress<.51&&state.running&&!state.responded)}
 function start(){state.running=true;state.paused=false;state.prev=performance.now();state.attempts=0;state.correct=0;state.combo=0;state.points=0;state.keys.clear();newRep();ui.start.textContent='Restart session';ui.pause.textContent='Pause';}
 function newRep(){state.progress=0;state.x=0;state.velocity=0;state.speed=0;state.responded=false;state.result='';state.moveAt=0;state.moveName='';state.r2Early=false;state.r2Ever=false;state.freeze=0;state.scenario=ui.drill.value==='mixed'?rand(drills):drills.find(d=>d.type===ui.drill.value)||rand(drills);state.phase='READ THE DEFENDER';ui.read.textContent='Watch the defender’s angle. Identify the opening.';ui.hint.textContent='Press the lane first. Avoid R2 until there is space.';ui.tips.textContent='Read the defender, choose a move only when needed.';setStatus('RUNNING — Read the defense');updateUI()}
 function pause(){if(!state.running)return;state.paused=!state.paused;ui.pause.textContent=state.paused?'Resume':'Pause';state.prev=performance.now();setStatus(state.paused?'PAUSED':'RUNNING')}
 function grading(move){if(!state.running||state.paused||state.responded)return;
 const s=state.scenario; const inWindow=state.progress>.49&&state.progress<.87;let good=move===s.move&&inWindow;
 state.responded=true;state.moveName=move;state.moveAt=performance.now();state.attempts++;
 if(good){state.correct++;state.combo++;let gain=100+(state.combo-1)*15-(state.r2Early?30:0);state.points+=gain;state.result='success';state.phase='BEAT THE DEFENDER';ui.read.textContent=`GOOD READ — ${s.name}`;ui.hint.textContent=`+${gain} points. ${state.r2Early?'R2 was early; control the cut first.':'Get vertical and burst through the opening.'}`;setStatus('SUCCESS — '+s.best);tone(740)}
 else{state.combo=0;state.result='fail';state.phase='REVIEW THE READ';let reason=!inWindow?'Move timing was outside the tackle window.':`You used ${displayMove(move)}; the read favored ${s.best}.`;ui.read.textContent=`BETTER OPTION: ${s.name}`;ui.hint.textContent=reason;setStatus('REVIEW — '+s.name);tone(220)}
 ui.tips.textContent=s.tip;state.freeze=.92;updateUI()}
 function displayMove(m){return ({'juke-left':'RS ←','juke-right':'RS →','spin':'○','truck':'RS ↑','stiff':'✕','deadleg':'RS ↓','none':'R2 burst'})[m]||m}
 let audio;function tone(hz){try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=hz;o.type=hz<300?'sawtooth':'sine';g.gain.setValueAtTime(.035,audio.currentTime);g.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.17);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.18)}catch(_){}}
 function r2Set(v){if(v&&!state.r2&&state.running&&!state.paused){if(state.progress<.50&&!state.responded){state.r2Early=true;ui.hint.textContent='EARLY R2 — wait for the crease before accelerating.'}if(state.scenario&&state.scenario.move==='none'&&state.progress>.51&&state.progress<.87)grading('none');state.r2Ever=true}state.r2=v;}
 function step(dt){const pad=state.activePad;let steer=0;if(state.keys.has('arrowleft')||state.keys.has('a'))steer-=1;if(state.keys.has('arrowright')||state.keys.has('d'))steer+=1;if(pad&&pad.axes)steer+=Math.abs(pad.axes[0]||0)>.15?pad.axes[0]:0;
 state.velocity+=(clamp(steer,-1,1)*6-state.velocity*4)*dt;state.x=clamp(state.x+state.velocity*dt,-7.6,7.6);
 if(!state.running||state.paused)return;if(state.freeze>0){state.freeze-=dt;if(state.freeze<=0)newRep();return}
 const fast=state.r2?1.25:1;state.progress+=dt*(.25*diff())*fast;state.progress=clamp(state.progress,0,1.1);
 const sc=state.scenario;if(state.progress>.24&&state.progress<.49){state.phase='PRESS THE LANE';ui.read.textContent=sc.why;ui.hint.textContent='Read the angle. Delay the move until the defender closes.'}
 if(state.progress>=.49&&!state.responded){state.phase='MAKE YOUR MOVE';ui.read.textContent=sc.why;ui.hint.textContent=sc.move==='none'?'OPEN LANE! Use R2 once the crease opens.':'TACKLER IN RANGE — pick your move now.'}
 if(state.progress>.88&&!state.responded){grading('__late__')}
 updateUI()}
 function project(x,z){ // 3D-style projected ground plane: z=0 feet at runner, z=1 far distance
 const w=canvas.width,h=canvas.height, horizon=h*.235,near=h*.94,p=Math.pow(1-clamp(z,0,1),1.55);
 return {x:w*.5+(x-state.x*.30)*w*.048*(.24+.76*p),y:horizon+(near-horizon)*p,scale:.23+.77*p};}
 function poly(points,fill,stroke,width=1){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke()}}
 function player(x,z,color,number,angle=0){const p=project(x,z),s=p.scale*Math.min(canvas.width/920,1.6),base=p.y;
 ctx.save();ctx.translate(p.x,base);ctx.scale(s,s);ctx.rotate(angle);ctx.fillStyle='rgba(0,0,0,.33)';ctx.beginPath();ctx.ellipse(0,0,27,10,0,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='#161d2b';ctx.lineWidth=12;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-9,-39);ctx.lineTo(-17,-8);ctx.moveTo(9,-39);ctx.lineTo(17,-8);ctx.stroke();
 ctx.strokeStyle=color;ctx.lineWidth=11;ctx.beginPath();ctx.moveTo(-18,-73);ctx.lineTo(-29,-42);ctx.moveTo(18,-73);ctx.lineTo(29,-42);ctx.stroke();
 ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(-24,-93,48,56,11);ctx.fill();ctx.fillStyle='#f1f5f9';ctx.font='bold 24px system-ui';ctx.textAlign='center';ctx.fillText(number,0,-52);
 ctx.fillStyle='#b9c5d5';ctx.beginPath();ctx.arc(0,-104,17,0,Math.PI*2);ctx.fill();ctx.fillStyle='#243043';ctx.fillRect(-15,-108,30,9);ctx.restore()}
 function line(z,color,thickness=2){const a=project(-9,z),b=project(9,z);ctx.strokeStyle=color;ctx.lineWidth=thickness*a.scale+1;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
 function draw(){let w=canvas.width,h=canvas.height;
 ctx.fillStyle='#091727';ctx.fillRect(0,0,w,h);let sky=ctx.createLinearGradient(0,0,0,h*.35);sky.addColorStop(0,'#0d263b');sky.addColorStop(1,'#284758');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h*.35);
 const farL=project(-9,1),farR=project(9,1),nearR=project(9,0),nearL=project(-9,0);poly([farL,farR,nearR,nearL],'#245a42','#8fdca3',2);
 for(let z=0;z<1;z+=.125){const za=z,zb=Math.min(1,z+.0625);const a=project(-9,za),b=project(9,za),c=project(9,zb),d=project(-9,zb);poly([a,b,c,d],z%(.25)<.125?'rgba(46,127,78,.28)':'rgba(0,0,0,.06)')}
 for(let z=0;z<=1;z+=.1)line(z,z%(.2)<.02?'rgba(255,255,255,.7)':'rgba(255,255,255,.28)',2.6);
 for(const edge of [-9,9]){let a=project(edge,0),b=project(edge,1);ctx.strokeStyle='#edf6e9';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
 for(const x of [-5.8,5.8])for(let z=.05;z<1;z+=.1){const p=project(x,z);ctx.fillStyle='#eaf4de';ctx.fillRect(p.x-3*p.scale,p.y-3*p.scale,6*p.scale,6*p.scale)}
 const sc=state.scenario;if(sc){const progress=state.progress;const z=.94-progress*.92;const dodge=sc.dx*Math.sin(progress*5),baseX=sc.x+dodge;player(baseX,z,'#ef485b','54');
 // teammates show plausible gap/blocking picture, not collision-based NFL simulation
 for(const [i,bx] of [-4,0,4].entries()){player(bx+Math.sin(progress*2+i)*.35,clamp(z-.18,.07,.96),'#e2c281',String(70+i));}
 const lbLeft=project(-5.4,clamp(z+.12,.03,.97)),lbRight=project(5.4,clamp(z+.12,.03,.97));ctx.globalAlpha=.78;player(-5.4,clamp(z+.12,.04,.97),'#d34a60','51');player(5.4,clamp(z+.12,.04,.97),'#d34a60','58');ctx.globalAlpha=1;}
 player(state.x*.7,.05,'#4a98ff','28',state.moveAt&&performance.now()-state.moveAt<480?(state.moveName==='spin'?.16:state.moveName==='juke-left'?.10:state.moveName==='juke-right'?-.10:0):0);
 const barX=w*.065,barY=h*.085,barW=w*.87;ctx.fillStyle='rgba(0,0,0,.45)';ctx.fillRect(barX,barY,barW,14);ctx.fillStyle=state.progress>.49&&state.progress<.87?'#e8ce63':'#48a7ff';ctx.fillRect(barX,barY,barW*clamp(state.progress,0,1),14);
 ctx.strokeStyle='rgba(255,255,255,.7)';ctx.strokeRect(barX+barW*.49,barY-3,barW*.38,20);ctx.font=`${Math.round(w*.022)}px system-ui`;ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText('MOVE WINDOW',w*.68,barY-9);
 if(!state.running||state.paused){ctx.fillStyle='rgba(3,10,24,.55)';ctx.fillRect(0,0,w,h);ctx.fillStyle='#fff';ctx.font=`bold ${Math.round(w*.05)}px system-ui`;ctx.textAlign='center';ctx.fillText(state.paused?'PAUSED':'HB VISION + MOVES 3D',w/2,h*.48);ctx.font=`${Math.round(w*.025)}px system-ui`;ctx.fillText(state.paused?'Press resume to continue':'Press Start Session to practice',w/2,h*.54)}
 }
 function frame(now){const dt=clamp((now-state.prev)/1000||0,0,.055);state.prev=now;const gamepads=navigator.getGamepads?.()||[];state.activePad=Array.from(gamepads).find(p=>p&&p.connected)||null;
 if(state.activePad){const p=state.activePad;const down=i=>!!p.buttons[i]?.pressed;const pressed=i=>down(i)&&!state.lastBtn[i];const rx=p.axes[2]||0,ry=p.axes[3]||0;const last=state.lastRight;
 if(rx<-.7&&last.x>=-.65)grading('juke-left');if(rx>.7&&last.x<=.65)grading('juke-right');if(ry<-.7&&last.y>=-.65)grading('truck');if(ry>.7&&last.y<=.65)grading('deadleg');if(pressed(1))grading('spin');if(pressed(0))grading('stiff');
 if(pressed(9))state.running?pause():start();if(pressed(12)&&state.running&&state.paused)newRep();r2Set(down(7)||p.buttons[7]?.value>.35||state.keys.has('shift'));
 state.lastBtn=p.buttons.map(b=>b.pressed);state.lastRight={x:rx,y:ry};ui.control.textContent=p.id.slice(0,39)}else {r2Set(state.keys.has('shift'));ui.control.textContent='Keyboard / touch (controller not connected)';state.lastBtn=[];state.lastRight={x:0,y:0}}
 step(dt);draw();requestAnimationFrame(frame)}
 function resize(){const r=canvas.getBoundingClientRect();canvas.width=Math.max(620,Math.floor(r.width*devicePixelRatio));canvas.height=Math.max(480,Math.floor(r.height*devicePixelRatio))}
 window.addEventListener('resize',resize);
 const keyMap={'q':'juke-left','e':'juke-right','c':'spin','f':'stiff','w':'truck','s':'deadleg'};
 window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();if(!state.keys.has(k)){if(keyMap[k])grading(keyMap[k]);if(k==='enter')state.running?pause():start();}state.keys.add(k)});
 window.addEventListener('keyup',e=>state.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>{state.keys.clear();r2Set(false)});
 ui.start.addEventListener('click',start);ui.pause.addEventListener('click',pause);ui.reset.addEventListener('click',()=>{state.running=false;state.paused=false;state.scenario=null;state.phase='Ready';state.points=state.correct=state.attempts=state.combo=0;setStatus('Ready');updateUI()});
 for(const [move,label] of [['juke-left','Juke ←'],['juke-right','Juke →'],['spin','Spin ○'],['truck','Truck ↑'],['stiff','Stiff ✕'],['deadleg','Dead leg ↓']]){let b=document.createElement('button');b.textContent=label;b.type='button';b.addEventListener('click',()=>grading(move));ui.buttons.appendChild(b)}
 const burst=$('burst');burst.addEventListener('pointerdown',e=>{e.preventDefault();state.keys.add('shift')});for(let t of ['pointerup','pointercancel','pointerleave'])burst.addEventListener(t,()=>state.keys.delete('shift'));
 resize();updateUI();requestAnimationFrame(frame);
})();
