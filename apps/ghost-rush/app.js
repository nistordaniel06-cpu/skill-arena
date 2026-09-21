(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const canvas = $('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const lanes = [200, 360, 520];
  const RUN_DISTANCE = 7600;
  const BASE_SPEED = 320;
  const LOCAL_KEY = 'ghostRush-v2';
  const cfg = window.GHOST_CONFIG || {};
  const db = (window.supabase && cfg.supabaseUrl && cfg.supabasePublishableKey)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey)
    : null;

  const local = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
  local.coins ??= 420;
  local.displayName ??= `Ghost${Math.floor(1000 + Math.random() * 8999)}`;
  local.bestByDay ??= {};

  let user = null;
  let online = false;
  let profile = { display_name: local.displayName, coins: local.coins, rank_points: 0 };
  let leaderboard = [];
  let challenge = null;
  let lastRunId = null;
  let currentGhost = { name: 'Ghost', target: 21.43, actions: [] };

  let playing = false, start = 0, last = 0, elapsed = 0, distance = 0, lane = 1;
  let actions = [], obstacles = [], particles = [], ghostLane = 1, ghostActionIndex = 0;
  let slowUntil = 0, boostUntil = 0, touchStartX = null;

  function persist() { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); }
  function seed() { const d = new Date(); return Number(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`); }
  function fmtSec(s) { return `${Number(s).toFixed(2)}s`; }
  function rankFor(rp) { if (rp >= 2500) return 'Phantom'; if (rp >= 1200) return 'Diamond'; if (rp >= 600) return 'Platinum'; if (rp >= 250) return 'Gold'; if (rp >= 80) return 'Silver'; return 'Rookie'; }
  function rankProgress(rp) { const stops=[0,80,250,600,1200,2500,4000]; let i=0; while(i<stops.length-1 && rp>=stops[i+1]) i++; return Math.min(100, Math.max(8, ((rp-stops[i])/(stops[i+1]-stops[i]))*100)); }
  function rng(s) { let t=s+0x6D2B79F5; return () => { t+=0x6D2B79F5; let r=Math.imul(t^t>>>15,1|t); r^=r+Math.imul(r^r>>>7,61|r); return ((r^r>>>14)>>>0)/4294967296; }; }
  function toast(msg) { const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._x); t._x=setTimeout(()=>t.classList.remove('show'),2200); }
  function setOnline(v,label) { online=v; $('#onlineDot').classList.toggle('live',v); $('#onlineLabel').textContent=label || (v?'online':'local'); }
  function show(id) { $$('.screen').forEach(x=>x.classList.remove('active')); $('#'+id).classList.add('active'); $$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.screen===id)); $('#nav').style.display=id==='game'||id==='result'?'none':'grid'; window.scrollTo(0,0); }

  async function boot() {
    $('#dailySeedLabel').textContent = `#${seed()}`;
    $('#displayName').value = local.displayName;
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
    const seen=new Set();
    leaderboard=[];
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
    $('#challengeText').textContent=`Beat ${fmtSec(currentGhost.target)} on the same run.`;
    $('#playBtn').textContent=`⚡ BEAT ${r.data.player_name.toUpperCase()}`;
  }
  async function loadChallengeFallback(){ const code=new URLSearchParams(location.search).get('c'); if(code) toast('Challenge needs online mode'); }

  function renderLocal() {
    const best=local.bestByDay[seed()]?.time || null;
    $('#coins').textContent=profile.coins ?? local.coins;
    $('#bestLabel').textContent=best?fmtSec(best):'--';
    $('#profileBest').textContent=best?fmtSec(best):'--';
  }
  function renderAll() {
    renderLocal();
    const rp=profile.rank_points||0;
    const rank=rankFor(rp);
    $('#rankLabel').textContent=rank; $('#rankPoints').textContent=`${rp} RP`; $('#profileRank').textContent=rank; $('#profileRp').textContent=`${rp} RP`; $('#rankProgress').style.width=`${rankProgress(rp)}%`;
    $('#profileCoins').textContent=profile.coins ?? local.coins;
    $('#displayName').value=profile.display_name||local.displayName;
    $('#profileId').textContent=online?`online • ${String(user.id).slice(0,8)}`:'local player';
    renderBoards();
  }
  function renderBoards() {
    const rows=leaderboard.length?leaderboard.slice(0,10):[
      {player_name:'Dan',elapsed_ms:21430,user_id:'a'}, {player_name:'Alex',elapsed_ms:22010,user_id:'b'}, {player_name:local.displayName,elapsed_ms:local.bestByDay[seed()]?.time*1000||23170,user_id:user?.id||'me'}
    ];
    const rowHtml=rows.map((r,i)=>`<div class="boardRow ${r.user_id===user?.id?'you':''}"><span class="rankNo">${i+1}</span><span>${escapeHtml(r.player_name)}</span><span class="time">${(r.elapsed_ms/1000).toFixed(2)}s</span></div>`);
    $('#homeBoard').innerHTML=rowHtml.slice(0,5).join('');
    $('#fullBoard').innerHTML=rowHtml.join('');
  }
  function escapeHtml(v){return String(v??'Ghost').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  function buildTrack() {
    const r=rng(challenge?.daily_seed || seed()); obstacles=[]; let d=720;
    while(d<RUN_DISTANCE-300){ d += 240+r()*210; const blocked=r()<.19?2:1; const used=[]; for(let i=0;i<blocked;i++){ let l=Math.floor(r()*3); while(used.includes(l)) l=(l+1)%3; used.push(l); obstacles.push({lane:l,dist:d,type:r()<.16?'boost':'block',hit:false}); } }
  }
  function defaultGhost() { const r=rng((challenge?.daily_seed||seed())+77), out=[]; let t=.7,l=1; while(t<20.5){t+=.6+r()*1.1; const n=Math.max(0,Math.min(2,l+(r()<.5?-1:1))); if(n!==l){out.push({t:Number(t.toFixed(3)),next:n});l=n;}} return out; }
  function pickGhost() {
    if (challenge) return currentGhost;
    if (online && leaderboard.length) { const g=leaderboard.find(x=>x.user_id!==user?.id)||leaderboard[0]; return {name:g.player_name,target:g.elapsed_ms/1000,actions:Array.isArray(g.actions)?g.actions:[]}; }
    const best=local.bestByDay[seed()];
    if(best?.actions?.length) return {name:'YOUR BEST',target:best.time,actions:best.actions};
    return {name:'GHOST',target:21.43,actions:defaultGhost()};
  }
  function startRun() {
    currentGhost=pickGhost(); buildTrack(); playing=true; start=performance.now(); last=start; elapsed=0; distance=0; lane=1; actions=[]; particles=[]; ghostLane=1; ghostActionIndex=0; slowUntil=0; boostUntil=0;
    $('#ghostName').textContent=currentGhost.name; $('#ghostTime').textContent=currentGhost.target.toFixed(2); $('#hint').style.opacity='1'; show('game'); requestAnimationFrame(loop);
  }
  function setLane(n){ if(!playing)return; n=Math.max(0,Math.min(2,n)); if(n!==lane){lane=n;actions.push({t:Number(elapsed.toFixed(3)),next:n});burst(lanes[n],H*.78,'#55eaff');} }
  function burst(x,y,c){for(let i=0;i<9;i++)particles.push({x,y,vx:(Math.random()-.5)*180,vy:(Math.random()-.5)*170,life:.55,c});}
  function collide() {
    for(const o of obstacles){ if(o.hit||Math.abs(o.dist-distance)>80||o.lane!==lane) continue; o.hit=true; if(o.type==='block'){slowUntil=elapsed+0.85; distance=Math.max(0,distance-110); burst(lanes[lane],H*.78,'#ff5b7c');} else {boostUntil=elapsed+1.1; distance+=150; burst(lanes[lane],H*.78,'#4ff0a0');} }
  }
  function loop(now){ if(!playing)return; const dt=Math.min(.034,(now-last)/1000); last=now; elapsed=(now-start)/1000; let speed=BASE_SPEED+Math.min(55,elapsed*2.4); if(elapsed<slowUntil)speed*=.58;if(elapsed<boostUntil)speed*=1.38;distance+=speed*dt; while(ghostActionIndex<(currentGhost.actions||[]).length&&(currentGhost.actions[ghostActionIndex].t||0)<=elapsed){ghostLane=currentGhost.actions[ghostActionIndex].next;ghostActionIndex++;} collide(); updateParticles(dt); draw(); $('#youTime').textContent=elapsed.toFixed(2); if(elapsed>1.8)$('#hint').style.opacity='0'; if(distance>=RUN_DISTANCE)return finish(false); if(elapsed>45)return finish(true); requestAnimationFrame(loop); }
  function updateParticles(dt){for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=110*dt;p.life-=dt;}particles=particles.filter(p=>p.life>0);}
  function draw(){
    ctx.clearRect(0,0,W,H); const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#0b1739');g.addColorStop(1,'#050814');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#31416b';ctx.lineWidth=3;for(const x of [280,440]){ctx.beginPath();ctx.moveTo(W/2+(x-W/2)*.33,120);ctx.lineTo(x,H);ctx.stroke();}
    for(let i=0;i<20;i++){const yy=(H-((distance*0.19+i*90)%H));ctx.strokeStyle='rgba(80,130,220,.12)';ctx.beginPath();ctx.moveTo(100,yy);ctx.lineTo(620,yy);ctx.stroke();}
    for(const o of obstacles){const diff=o.dist-distance;if(diff<-220||diff>3000)continue;const y=H*.77-diff*.23;const scale=Math.max(.25,1-diff/4200);const x=lanes[o.lane];ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.fillStyle=o.type==='boost'?'#35e69a':'#ff466d';ctx.shadowBlur=24;ctx.shadowColor=ctx.fillStyle;ctx.fillRect(-52,-27,104,54);ctx.restore();}
    const ghostDist=RUN_DISTANCE*Math.min(1,elapsed/currentGhost.target);let gy=H*.78-(ghostDist-distance)*.065;gy=Math.max(150,Math.min(H*.78-75,gy));drawRunner(lanes[ghostLane],gy,'rgba(116,102,255,.43)',true);drawRunner(lanes[lane],H*.78,'#111827',false);
    for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/.55);ctx.fillStyle=p.c;ctx.fillRect(p.x,p.y,6,6);}ctx.globalAlpha=1;
    const prog=Math.min(1,distance/RUN_DISTANCE);ctx.fillStyle='#111a36';ctx.fillRect(80,H-34,560,10);const pg=ctx.createLinearGradient(80,0,640,0);pg.addColorStop(0,'#55eaff');pg.addColorStop(1,'#9a4dff');ctx.fillStyle=pg;ctx.fillRect(80,H-34,560*prog,10);
  }
  function drawRunner(x,y,color,ghost){ctx.save();ctx.translate(x,y);ctx.globalAlpha=ghost?.72:1;ctx.shadowBlur=ghost?30:16;ctx.shadowColor=ghost?'#7b61ff':'#4fc3ff';ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(-35,-44,70,74,22);ctx.fill();ctx.fillStyle=ghost?'#c9c1ff':'#ffd166';ctx.beginPath();ctx.arc(0,-54,24,0,Math.PI*2);ctx.fill();ctx.restore();}

  async function finish(failed){
    if(!playing)return;playing=false;const final=Number((failed?elapsed+1.2:elapsed).toFixed(3));const won=final<currentGhost.target;const day=seed();const old=local.bestByDay[day]?.time;const isPB=!failed&&(!old||final<old);if(isPB){local.bestByDay[day]={time:final,actions};local.coins+=50;persist();}
    $('#resultHeadline').textContent=won?'YOU WIN!':'SO CLOSE!';$('#resultHeadline').className=`headline ${won?'win':'lose'}`;$('#resultTime').textContent=fmtSec(final);$('#resultYou').textContent=fmtSec(final);$('#resultGhost').textContent=fmtSec(currentGhost.target);$('#resultGhostName').textContent=currentGhost.name;$('#pbText').textContent=isPB?'New personal best • +50 coins':won?'Ghost beaten. Send the challenge back.':'Rematch and take the time back.';show('result');renderLocal();
    if(online&&!failed){try{const ins=await db.from('ghost_runs').insert({user_id:user.id,player_name:profile.display_name||local.displayName,daily_seed:challenge?.daily_seed||day,elapsed_ms:Math.round(final*1000),actions}).select('id').single();if(ins.error)throw ins.error;lastRunId=ins.data.id;const reward=isPB?50:10;const rpGain=won?25:8;profile.coins=(profile.coins||0)+reward;profile.rank_points=(profile.rank_points||0)+rpGain;await db.from('ghost_profiles').update({coins:profile.coins,rank_points:profile.rank_points,updated_at:new Date().toISOString()}).eq('id',user.id);await loadLeaderboard();renderAll();}catch(e){console.warn(e);toast('Run saved locally; online save failed');}}
  }

  async function shareChallenge(){
    if(!online||!lastRunId){toast('Finish an online run first');return;}
    try{const c=await db.from('ghost_challenges').insert({run_id:lastRunId,created_by:user.id}).select('code').single();if(c.error)throw c.error;const u=new URL(location.href);u.search='';u.searchParams.set('c',c.data.code);const text=`${profile.display_name||local.displayName} challenged you in Ghost Rush. Beat my run.`;if(navigator.share)await navigator.share({title:'Ghost Rush Challenge',text,url:u.toString()});else{await navigator.clipboard.writeText(u.toString());toast('Challenge link copied');}}catch(e){console.warn(e);toast('Could not create challenge');}
  }
  async function saveProfile(){const name=$('#displayName').value.trim().slice(0,20)||'Ghost';local.displayName=name;persist();if(online){const q=await db.from('ghost_profiles').update({display_name:name,updated_at:new Date().toISOString()}).eq('id',user.id).select().single();if(q.error){toast('Profile save failed');return;}profile=q.data;}toast('Profile saved');renderAll();}

  $('#playBtn').onclick=startRun;$('#rematchBtn').onclick=startRun;$('#shareBtn').onclick=shareChallenge;$('#homeBtn').onclick=()=>show('home');$('#leftBtn').onclick=()=>setLane(lane-1);$('#rightBtn').onclick=()=>setLane(lane+1);$('#saveProfileBtn').onclick=saveProfile;$('#refreshBoardBtn').onclick=async()=>{if(online){await loadLeaderboard();renderAll();toast('Leaderboard refreshed');}};
  canvas.addEventListener('pointerdown',e=>{touchStartX=e.clientX});canvas.addEventListener('pointerup',e=>{if(touchStartX==null)return;const dx=e.clientX-touchStartX;if(Math.abs(dx)>24)setLane(lane+(dx>0?1:-1));else setLane(lane+(e.clientX<innerWidth/2?-1:1));touchStartX=null});
  addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a')setLane(lane-1);if(e.key==='ArrowRight'||e.key.toLowerCase()==='d')setLane(lane+1)});
  $$('#nav button').forEach(b=>b.onclick=()=>show(b.dataset.screen));
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  boot();
})();
