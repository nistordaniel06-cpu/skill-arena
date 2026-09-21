(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const canvas = $('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const lanes = [200, 360, 520];
  const RUN_DISTANCE = 7600;
  const BASE_SPEED = 325;
  const LOCAL_KEY = 'ghostRush-v3';
  const cfg = window.GHOST_CONFIG || {};
  const db = (window.supabase && cfg.supabaseUrl && cfg.supabasePublishableKey)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey)
    : null;

  const local = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
  local.coins ??= 420;
  local.displayName ??= `Ghost${Math.floor(1000 + Math.random() * 8999)}`;
  local.bestByDay ??= {};
  local.missions ??= {};
  local.streak ??= 1;

  let user = null;
  let online = false;
  let profile = { display_name: local.displayName, coins: local.coins, rank_points: 0 };
  let leaderboard = [];
  let challenge = null;
  let lastRunId = null;
  let currentGhost = { name: 'Ghost', target: 21.43, actions: [] };

  let playing = false, countdownRunning = false, start = 0, last = 0, elapsed = 0, distance = 0, lane = 1;
  let actions = [], obstacles = [], particles = [], ghostLane = 1, ghostActionIndex = 0;
  let slowUntil = 0, boostUntil = 0, touchStartX = null;
  let runShards = 0, combo = 1, maxCombo = 1, hits = 0, shake = 0, flash = 0, speedFx = 0;
  let audioCtx = null;

  function persist() { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); }
  function seed() { const d = new Date(); return Number(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`); }
  function courseSeed() { return challenge?.daily_seed || seed(); }
  function fmtSec(s) { return `${Number(s).toFixed(2)}s`; }
  function rankFor(rp) { if (rp >= 2500) return 'Phantom'; if (rp >= 1200) return 'Diamond'; if (rp >= 600) return 'Platinum'; if (rp >= 250) return 'Gold'; if (rp >= 80) return 'Silver'; return 'Rookie'; }
  function rankProgress(rp) { const stops=[0,80,250,600,1200,2500,4000]; let i=0; while(i<stops.length-1 && rp>=stops[i+1]) i++; const next=stops[Math.min(i+1,stops.length-1)]; return Math.min(100, Math.max(8, ((rp-stops[i])/(next-stops[i]||1))*100)); }
  function rng(s) { let t=s+0x6D2B79F5; return () => { t+=0x6D2B79F5; let r=Math.imul(t^t>>>15,1|t); r^=r+Math.imul(r^r>>>7,61|r); return ((r^r>>>14)>>>0)/4294967296; }; }
  function toast(msg) { const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._x); t._x=setTimeout(()=>t.classList.remove('show'),2200); }
  function setOnline(v,label) { online=v; $('#onlineDot').classList.toggle('live',v); $('#onlineLabel').textContent=label || (v?'online':'local'); }
  function show(id) { $$('.screen').forEach(x=>x.classList.remove('active')); $('#'+id).classList.add('active'); $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.screen===id)); $('#nav').style.display=id==='game'||id==='result'?'none':'grid'; window.scrollTo(0,0); }
  function escapeHtml(v){return String(v??'Ghost').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  function initAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  function sfx(freq=440, duration=.06, type='sine', gain=.035) {
    if (!audioCtx) return;
    const osc=audioCtx.createOscillator(), g=audioCtx.createGain();
    osc.type=type; osc.frequency.value=freq; g.gain.value=gain;
    osc.connect(g); g.connect(audioCtx.destination);
    const now=audioCtx.currentTime; g.gain.setValueAtTime(gain,now); g.gain.exponentialRampToValueAtTime(.0001,now+duration);
    osc.start(now); osc.stop(now+duration);
  }
  function haptic(pattern=18){ try { navigator.vibrate?.(pattern); } catch(_){} }

  async function boot() {
    $('#dailySeedLabel').textContent = `#${seed()}`;
    $('#displayName').value = local.displayName;
    normalizeMission();
    renderLocal();
    if (!db) { setOnline(false,'local'); await loadChallengeFallback(); return; }
    try {
      let { data: sessionData } = await db.auth.getSession();
      if (!sessionData.session) {
        const { data, error } = await db.auth.signInAnonymously({ options:{ data:{ display_name:local.displayName } } });
        if (error) throw error;
        sessionData = { session:data.session };
      }
      user = sessionData.session.user;
      setOnline(true,'online');
      await ensureProfile();
      await Promise.all([loadLeaderboard(), loadChallenge()]);
      renderAll();
    } catch (e) {
      console.warn('Ghost Rush online mode unavailable:', e);
      setOnline(false,'local');
      toast('Online mode unavailable — local play still works');
      await loadChallengeFallback();
    }
  }

  async function ensureProfile() {
    const { data, error } = await db.from('ghost_profiles').select('id,display_name,rank_points,coins').eq('id',user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const payload={id:user.id,display_name:local.displayName,rank_points:0,coins:local.coins};
      const ins=await db.from('ghost_profiles').insert(payload).select().single();
      if (ins.error) throw ins.error;
      profile=ins.data;
    } else profile=data;
    local.displayName=profile.display_name; local.coins=profile.coins; persist();
  }

  async function loadLeaderboard() {
    if (!online) return;
    const { data, error } = await db.from('ghost_runs').select('id,user_id,player_name,elapsed_ms,actions,created_at').eq('daily_seed',seed()).order('elapsed_ms',{ascending:true}).limit(20);
    if (error) throw error;
    const seen=new Set(); leaderboard=[];
    for (const r of data||[]) { if (!seen.has(r.user_id)) { seen.add(r.user_id); leaderboard.push(r); } }
    if (!challenge && leaderboard.length) {
      const g=leaderboard.find(r=>r.user_id!==user?.id) || leaderboard[0];
      currentGhost={name:g.player_name,target:g.elapsed_ms/1000,actions:Array.isArray(g.actions)?g.actions:[]};
    }
  }

  async function loadChallenge() {
    const code=new URLSearchParams(location.search).get('c');
    if (!code || !online) return;
    const c=await db.from('ghost_challenges').select('code,run_id,expires_at').eq('code',code).maybeSingle();
    if (c.error || !c.data) return;
    const r=await db.from('ghost_runs').select('id,user_id,player_name,elapsed_ms,actions,daily_seed').eq('id',c.data.run_id).single();
    if (r.error || !r.data) return;
    challenge={code,...r.data};
    currentGhost={name:r.data.player_name,target:r.data.elapsed_ms/1000,actions:Array.isArray(r.data.actions)?r.data.actions:[]};
    $('#challengeBanner').classList.add('show');
    $('#challengeTitle').textContent=`${r.data.player_name} challenged you 👻`;
    $('#challengeText').textContent=`Beat ${fmtSec(currentGhost.target)} on the exact same course.`;
    $('#playBtn').textContent=`⚡ BEAT ${r.data.player_name.toUpperCase()}`;
  }
  async function loadChallengeFallback(){ const code=new URLSearchParams(location.search).get('c'); if(code) toast('Challenge needs online mode'); }

  function normalizeMission(){
    const day=String(seed());
    if(!local.missions[day]) local.missions[day]={bestShards:0,claimed:false};
  }
  function missionState(){ normalizeMission(); return local.missions[String(seed())]; }
  function renderMission(){
    const m=missionState();
    const pct=Math.min(100,(m.bestShards/8)*100);
    $('#missionProgress').style.width=`${pct}%`;
    $('#missionText').textContent=m.claimed?'CLAIMED ✓':`${Math.min(8,m.bestShards)}/8 shards`;
    $('#missionReward').textContent=m.claimed?'Completed today':'Reward: +100 coins';
    const p=$('#missionTextProfile'); if(p) p.textContent=m.claimed?'Done ✓':`${Math.min(8,m.bestShards)}/8`;
  }

  function renderLocal() {
    const best=local.bestByDay[seed()]?.time || null;
    $('#coins').textContent=online ? (profile.coins ?? local.coins) : local.coins;
    $('#bestLabel').textContent=best?fmtSec(best):'--';
    $('#profileBest').textContent=best?fmtSec(best):'--';
    $('#streakLabel').textContent=`${local.streak}d`;
    renderMission();
  }
  function renderAll() {
    renderLocal();
    const rp=profile.rank_points||0, rank=rankFor(rp);
    $('#rankLabel').textContent=rank; $('#rankPoints').textContent=`${rp} RP`; $('#profileRank').textContent=rank; $('#profileRp').textContent=`${rp} RP`; $('#rankProgress').style.width=`${rankProgress(rp)}%`;
    $('#profileCoins').textContent=profile.coins ?? local.coins;
    $('#displayName').value=profile.display_name||local.displayName;
    $('#profileId').textContent=online?`online • ${String(user.id).slice(0,8)}`:'local player';
    renderBoards();
  }
  function renderBoards() {
    const rows=leaderboard.length?leaderboard.slice(0,10):[
      {player_name:'Nova',elapsed_ms:21430,user_id:'a'}, {player_name:'Vex',elapsed_ms:22010,user_id:'b'}, {player_name:local.displayName,elapsed_ms:(local.bestByDay[seed()]?.time||23.17)*1000,user_id:user?.id||'me'}
    ];
    const rowHtml=rows.map((r,i)=>`<div class="boardRow ${r.user_id===user?.id?'you':''}"><span class="rankNo">${i+1}</span><span>${escapeHtml(r.player_name)}</span><span class="time">${(r.elapsed_ms/1000).toFixed(2)}s</span></div>`);
    $('#homeBoard').innerHTML=rowHtml.slice(0,5).join('');
    $('#fullBoard').innerHTML=rowHtml.join('');
  }

  function buildTrack() {
    const r=rng(courseSeed()); obstacles=[]; let d=620;
    while(d<RUN_DISTANCE-260){
      d += 210+r()*175;
      const roll=r();
      if(roll<.18){
        obstacles.push({lane:Math.floor(r()*3),dist:d,type:'boost',hit:false});
      } else if(roll<.42){
        const l=Math.floor(r()*3);
        obstacles.push({lane:l,dist:d,type:'shard',hit:false});
        if(r()<.38) obstacles.push({lane:l,dist:d+90,type:'shard',hit:false});
      } else {
        const blocked=r()<.18?2:1, used=[];
        for(let i=0;i<blocked;i++){ let l=Math.floor(r()*3); while(used.includes(l))l=(l+1)%3; used.push(l); obstacles.push({lane:l,dist:d,type:'block',hit:false}); }
        if(blocked===1 && r()<.42){ const safe=[0,1,2].filter(x=>x!==used[0]); obstacles.push({lane:safe[Math.floor(r()*safe.length)],dist:d+45,type:'shard',hit:false}); }
      }
    }
  }
  function defaultGhost() { const r=rng(courseSeed()+77), out=[]; let t=.7,l=1; while(t<20.5){t+=.6+r()*1.1; const n=Math.max(0,Math.min(2,l+(r()<.5?-1:1))); if(n!==l){out.push({t:Number(t.toFixed(3)),next:n});l=n;}} return out; }
  function pickGhost() {
    if (challenge) return currentGhost;
    if (online && leaderboard.length) { const g=leaderboard.find(x=>x.user_id!==user?.id)||leaderboard[0]; return {name:g.player_name,target:g.elapsed_ms/1000,actions:Array.isArray(g.actions)?g.actions:[]}; }
    const best=local.bestByDay[seed()];
    if(best?.actions?.length) return {name:'YOUR BEST',target:best.time,actions:best.actions};
    return {name:'GHOST',target:21.43,actions:defaultGhost()};
  }

  async function startRun() {
    if(countdownRunning || playing) return;
    initAudio();
    currentGhost=pickGhost(); buildTrack(); elapsed=0; distance=0; lane=1; actions=[]; particles=[]; ghostLane=1; ghostActionIndex=0; slowUntil=0; boostUntil=0;
    runShards=0; combo=1; maxCombo=1; hits=0; shake=0; flash=0; speedFx=0;
    $('#ghostName').textContent=currentGhost.name; $('#ghostTime').textContent=currentGhost.target.toFixed(2);
    $('#hint').style.opacity='1'; $('#runCoins').textContent='0'; $('#comboLabel').textContent='COMBO x1';
    show('game');
    countdownRunning=true;
    const c=$('#countdown');
    for(const txt of ['3','2','1','GO!']){
      c.textContent=txt; c.classList.add('show');
      sfx(txt==='GO!'?740:420, .08, 'square', .025);
      if(txt!=='GO!') haptic(10);
      await new Promise(r=>setTimeout(r,txt==='GO!'?360:520));
      c.classList.remove('show');
      await new Promise(r=>setTimeout(r,80));
    }
    countdownRunning=false; playing=true; start=performance.now(); last=start; requestAnimationFrame(loop);
  }

  function setLane(n){
    if(!playing)return;
    n=Math.max(0,Math.min(2,n));
    if(n!==lane){lane=n;actions.push({t:Number(elapsed.toFixed(3)),next:n});burst(lanes[n],H*.78,'#55eaff',12);sfx(260+lane*70,.04,'triangle',.018);}
  }
  function burst(x,y,c,count=9){
    for(let i=0;i<count;i++)particles.push({x,y,vx:(Math.random()-.5)*210,vy:(Math.random()-.5)*200,life:.55,c,size:3+Math.random()*6});
  }
  function floatText(text,x,y,c){ particles.push({x,y,vx:0,vy:-70,life:.8,c,size:0,text}); }
  function updateCombo(next){
    combo=Math.max(1,next); maxCombo=Math.max(maxCombo,combo);
    $('#comboLabel').textContent=`COMBO x${combo}`;
    $('#comboLabel').classList.remove('pop'); void $('#comboLabel').offsetWidth; $('#comboLabel').classList.add('pop');
  }
  function collide() {
    for(const o of obstacles){
      if(o.hit||Math.abs(o.dist-distance)>72||o.lane!==lane) continue;
      o.hit=true;
      if(o.type==='block'){
        slowUntil=elapsed+.72; distance=Math.max(0,distance-95); hits++; updateCombo(1); shake=14; flash=.22;
        burst(lanes[lane],H*.78,'#ff5b7c',20); floatText('HIT!',lanes[lane],H*.67,'#ff6c89'); sfx(105,.13,'sawtooth',.05); haptic([35,25,35]);
      } else if(o.type==='boost'){
        boostUntil=elapsed+1.18; distance+=155; updateCombo(combo+1); speedFx=1;
        burst(lanes[lane],H*.78,'#4ff0a0',18); floatText('BOOST!',lanes[lane],H*.67,'#4ff0a0'); sfx(680,.09,'square',.03); haptic(22);
      } else if(o.type==='shard'){
        runShards++; updateCombo(combo+1); distance+=18;
        $('#runCoins').textContent=runShards; burst(lanes[lane],H*.73,'#ffd166',14); floatText(`+${combo}`,lanes[lane],H*.66,'#ffd166'); sfx(540+Math.min(300,combo*20),.055,'sine',.035); haptic(12);
      }
    }
  }

  function loop(now){
    if(!playing)return;
    const dt=Math.min(.034,(now-last)/1000); last=now; elapsed=(now-start)/1000;
    let speed=BASE_SPEED+Math.min(65,elapsed*2.7); if(elapsed<slowUntil)speed*=.6;if(elapsed<boostUntil)speed*=1.43;
    distance+=speed*dt; speedFx=Math.max(0,speedFx-dt*1.1); shake*=.88; flash=Math.max(0,flash-dt);
    while(ghostActionIndex<(currentGhost.actions||[]).length&&(currentGhost.actions[ghostActionIndex].t||0)<=elapsed){ghostLane=currentGhost.actions[ghostActionIndex].next;ghostActionIndex++;}
    collide(); updateParticles(dt); draw(); $('#youTime').textContent=elapsed.toFixed(2);
    if(elapsed>1.8)$('#hint').style.opacity='0';
    if(distance>=RUN_DISTANCE)return finish(false);
    if(elapsed>45)return finish(true);
    requestAnimationFrame(loop);
  }
  function updateParticles(dt){
    for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;if(!p.text)p.vy+=110*dt;p.life-=dt;}
    particles=particles.filter(p=>p.life>0);
  }

  function draw(){
    ctx.save();
    const sx=(Math.random()-.5)*shake, sy=(Math.random()-.5)*shake; ctx.translate(sx,sy);
    ctx.clearRect(-20,-20,W+40,H+40);
    const sky=ctx.createLinearGradient(0,0,0,H); sky.addColorStop(0,'#0b1640');sky.addColorStop(.52,'#08102a');sky.addColorStop(1,'#03050d');ctx.fillStyle=sky;ctx.fillRect(-20,-20,W+40,H+40);

    for(let i=0;i<18;i++){
      const x=(i*61 + 17)%W, h=90+((i*47)%170), y=235-h;
      ctx.fillStyle=i%3===0?'#101b46':'#0b1434';ctx.fillRect(x,y,45,h);
      ctx.fillStyle=i%4===0?'rgba(85,234,255,.35)':'rgba(255,79,216,.18)';
      for(let wy=y+14;wy<230;wy+=22)ctx.fillRect(x+8,wy,5,8);
    }
    const horizon=225, roadTopL=300, roadTopR=420, roadBottomL=72, roadBottomR=648;
    const rg=ctx.createLinearGradient(0,horizon,0,H);rg.addColorStop(0,'#101a3b');rg.addColorStop(1,'#060a15');ctx.fillStyle=rg;
    ctx.beginPath();ctx.moveTo(roadTopL,horizon);ctx.lineTo(roadTopR,horizon);ctx.lineTo(roadBottomR,H);ctx.lineTo(roadBottomL,H);ctx.closePath();ctx.fill();

    ctx.strokeStyle='rgba(94,126,220,.42)';ctx.lineWidth=3;
    for(const x of [280,440]){ctx.beginPath();ctx.moveTo(W/2+(x-W/2)*.16,horizon);ctx.lineTo(x,H);ctx.stroke();}
    for(let i=0;i<22;i++){
      const phase=((distance*.28+i*100)%1350)/1350, y=horizon+(H-horizon)*phase*phase;
      const half=55+phase*260;ctx.strokeStyle=`rgba(72,118,222,${.06+.15*phase})`;ctx.beginPath();ctx.moveTo(W/2-half,y);ctx.lineTo(W/2+half,y);ctx.stroke();
    }

    const lineCount=elapsed<boostUntil?34:14;
    for(let i=0;i<lineCount;i++){
      const r=((i*71+Math.floor(distance*2))%1000)/1000, side=i%2?-1:1;
      const y=280+r*760, x=W/2+side*(150+r*230), len=18+r*65+(speedFx*35);
      ctx.strokeStyle=`rgba(85,234,255,${.05+r*.22})`;ctx.lineWidth=2+r*2;
      ctx.beginPath();ctx.moveTo(x,y-len);ctx.lineTo(x+side*8,y);ctx.stroke();
    }

    for(const o of obstacles){
      const diff=o.dist-distance;if(diff<-220||diff>3100)continue;
      const y=H*.77-diff*.23;const scale=Math.max(.22,1-diff/4100);const x=lanes[o.lane];
      ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
      if(o.type==='block'){
        ctx.fillStyle=o.hit?'#69263a':'#ff466d';ctx.shadowBlur=28;ctx.shadowColor='#ff466d';
        ctx.beginPath();ctx.roundRect(-55,-30,110,60,13);ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.38)';ctx.fillRect(-38,-9,76,8);
      }else if(o.type==='boost'){
        ctx.strokeStyle='#4ff0a0';ctx.lineWidth=10;ctx.shadowBlur=30;ctx.shadowColor='#4ff0a0';
        ctx.beginPath();ctx.moveTo(-45,18);ctx.lineTo(0,-25);ctx.lineTo(45,18);ctx.stroke();
      }else{
        ctx.rotate(elapsed*2.8);ctx.strokeStyle=o.hit?'rgba(255,209,102,.18)':'#ffd166';ctx.lineWidth=10;ctx.shadowBlur=30;ctx.shadowColor='#ffd166';
        ctx.beginPath();ctx.arc(0,0,24,0,Math.PI*2);ctx.stroke();
        ctx.rotate(-elapsed*5.6);ctx.fillStyle='#fff1b8';ctx.beginPath();ctx.moveTo(0,-15);ctx.lineTo(8,0);ctx.lineTo(0,15);ctx.lineTo(-8,0);ctx.closePath();ctx.fill();
      }
      ctx.restore();
    }

    const ghostDist=RUN_DISTANCE*Math.min(1,elapsed/currentGhost.target);
    let gy=H*.78-(ghostDist-distance)*.065;gy=Math.max(155,Math.min(H*.78-78,gy));
    drawRunner(lanes[ghostLane],gy,true); drawRunner(lanes[lane],H*.78,false);

    for(const p of particles){
      ctx.globalAlpha=Math.max(0,p.life/(p.text?.8:.55));
      if(p.text){ctx.fillStyle=p.c;ctx.font='900 25px system-ui';ctx.textAlign='center';ctx.fillText(p.text,p.x,p.y);}
      else{ctx.fillStyle=p.c;ctx.shadowBlur=10;ctx.shadowColor=p.c;ctx.fillRect(p.x,p.y,p.size,p.size);}
    }
    ctx.globalAlpha=1;ctx.shadowBlur=0;

    const prog=Math.min(1,distance/RUN_DISTANCE);ctx.fillStyle='#111a36';ctx.fillRect(78,H-34,564,10);
    const pg=ctx.createLinearGradient(78,0,642,0);pg.addColorStop(0,'#55eaff');pg.addColorStop(.6,'#8157ff');pg.addColorStop(1,'#ff4fd8');ctx.fillStyle=pg;ctx.fillRect(78,H-34,564*prog,10);
    ctx.fillStyle='rgba(255,255,255,.85)';ctx.beginPath();ctx.arc(78+564*prog,H-29,8,0,Math.PI*2);ctx.fill();
    if(flash>0){ctx.fillStyle=`rgba(255,70,109,${flash*.55})`;ctx.fillRect(-20,-20,W+40,H+40);}
    ctx.restore();
  }

  function drawRunner(x,y,ghost){
    ctx.save();ctx.translate(x,y);const bob=Math.sin(elapsed*12)*3;ctx.translate(0,bob);
    if(ghost){ctx.globalAlpha=.48;ctx.shadowBlur=34;ctx.shadowColor='#8a6cff';ctx.strokeStyle='#a997ff';ctx.lineWidth=6;ctx.fillStyle='rgba(129,87,255,.2)';}
    else{ctx.shadowBlur=26;ctx.shadowColor=elapsed<boostUntil?'#4ff0a0':'#55eaff';ctx.strokeStyle=elapsed<boostUntil?'#4ff0a0':'#55eaff';ctx.lineWidth=6;ctx.fillStyle='#101831';}
    if(!ghost){ctx.globalAlpha=.24;ctx.fillStyle=elapsed<boostUntil?'#4ff0a0':'#55eaff';for(let i=1;i<5;i++){ctx.beginPath();ctx.ellipse(0,35+i*18,24-i*3,10,0,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
    ctx.beginPath();ctx.roundRect(-34,-38,68,78,24);ctx.fill();ctx.stroke();
    ctx.fillStyle=ghost?'rgba(201,193,255,.65)':'#ffd166';ctx.shadowBlur=18;ctx.shadowColor=ctx.fillStyle;
    ctx.beginPath();ctx.roundRect(-23,-48,46,24,10);ctx.fill();
    ctx.fillStyle=ghost?'rgba(129,87,255,.55)':'#8157ff';ctx.beginPath();ctx.moveTo(-34,4);ctx.lineTo(-52,28);ctx.lineTo(-31,23);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(34,4);ctx.lineTo(52,28);ctx.lineTo(31,23);ctx.closePath();ctx.fill();
    ctx.restore();
  }

  async function finish(failed){
    if(!playing)return; playing=false;
    const final=Number((failed?elapsed+1.2:elapsed).toFixed(3)), won=final<currentGhost.target, day=seed(), old=local.bestByDay[day]?.time;
    const isPB=!failed&&(!old||final<old);
    if(isPB)local.bestByDay[day]={time:final,actions};
    const baseReward=failed?0:5, performanceReward=failed?0:runShards*2+(won?10:0)+(isPB?25:0);
    let reward=baseReward+performanceReward;
    const m=missionState(); m.bestShards=Math.max(m.bestShards,runShards);
    let missionBonus=0;
    if(!m.claimed && runShards>=8){m.claimed=true;missionBonus=100;reward+=missionBonus;}
    local.coins+=reward; persist();

    $('#resultHeadline').textContent=won?'YOU WIN!':'SO CLOSE!';
    $('#resultHeadline').className=`headline ${won?'win':'lose'}`;
    $('#resultTime').textContent=fmtSec(final);$('#resultYou').textContent=fmtSec(final);$('#resultGhost').textContent=fmtSec(currentGhost.target);$('#resultGhostName').textContent=currentGhost.name;
    $('#pbText').textContent=isPB?'NEW PERSONAL BEST ⚡':won?'Ghost beaten. Send the challenge back.':'Rematch and take the time back.';
    $('#resultShards').textContent=runShards;$('#resultCombo').textContent=`x${maxCombo}`;$('#resultReward').textContent=`+${reward}`;
    $('#missionComplete').style.display=missionBonus?'block':'none';
    show('result');renderLocal();sfx(won?760:180,.18,won?'square':'sawtooth',.045);haptic(won?[20,30,20]:30);

    if(online&&!failed){
      try{
        const ins=await db.from('ghost_runs').insert({user_id:user.id,player_name:profile.display_name||local.displayName,daily_seed:courseSeed(),elapsed_ms:Math.round(final*1000),actions}).select('id').single();
        if(ins.error)throw ins.error;lastRunId=ins.data.id;
        const rpGain=won?25:8;profile.coins=(profile.coins||0)+reward;profile.rank_points=(profile.rank_points||0)+rpGain;
        const up=await db.from('ghost_profiles').update({coins:profile.coins,rank_points:profile.rank_points,updated_at:new Date().toISOString()}).eq('id',user.id);
        if(up.error)throw up.error;
        local.coins=profile.coins;persist();await loadLeaderboard();renderAll();
      }catch(e){console.warn(e);toast('Run saved locally; online save failed');}
    } else renderAll();
  }

  async function shareChallenge(){
    if(!online||!lastRunId){toast('Finish an online run first');return;}
    try{
      const c=await db.from('ghost_challenges').insert({run_id:lastRunId,created_by:user.id}).select('code').single();if(c.error)throw c.error;
      const u=new URL(location.href);u.search='';u.searchParams.set('c',c.data.code);
      const text=`${profile.display_name||local.displayName} challenged you in Ghost Rush. Beat ${$('#resultTime').textContent}.`;
      if(navigator.share)await navigator.share({title:'Ghost Rush Challenge',text,url:u.toString()});
      else{await navigator.clipboard.writeText(u.toString());toast('Challenge link copied');}
    }catch(e){console.warn(e);toast('Could not create challenge');}
  }
  async function saveProfile(){
    const name=$('#displayName').value.trim().slice(0,20)||'Ghost';local.displayName=name;persist();
    if(online){const q=await db.from('ghost_profiles').update({display_name:name,updated_at:new Date().toISOString()}).eq('id',user.id).select().single();if(q.error){toast('Profile save failed');return;}profile=q.data;}
    toast('Profile saved');renderAll();
  }

  $('#playBtn').onclick=startRun;$('#rematchBtn').onclick=startRun;$('#shareBtn').onclick=shareChallenge;$('#homeBtn').onclick=()=>show('home');
  $('#leftBtn').onclick=()=>setLane(lane-1);$('#rightBtn').onclick=()=>setLane(lane+1);$('#saveProfileBtn').onclick=saveProfile;
  $('#refreshBoardBtn').onclick=async()=>{if(online){await loadLeaderboard();renderAll();toast('Leaderboard refreshed');}};
  canvas.addEventListener('pointerdown',e=>{initAudio();touchStartX=e.clientX});
  canvas.addEventListener('pointerup',e=>{if(touchStartX==null)return;const dx=e.clientX-touchStartX;if(Math.abs(dx)>24)setLane(lane+(dx>0?1:-1));else setLane(lane+(e.clientX<innerWidth/2?-1:1));touchStartX=null});
  addEventListener('keydown',e=>{initAudio();if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a')setLane(lane-1);if(e.key==='ArrowRight'||e.key.toLowerCase()==='d')setLane(lane+1)});
  $$('#nav button').forEach(b=>b.onclick=()=>show(b.dataset.screen));
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  boot();
})();
