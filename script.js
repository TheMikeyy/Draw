(function(){
  const video = document.getElementById('video');
  const drawCanvas = document.getElementById('draw-canvas');
  const skelCanvas = document.getElementById('skeleton-canvas');
  const drawCtx = drawCanvas.getContext('2d');
  const skelCtx = skelCanvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const debugEl = document.getElementById('debug');
  const stage = document.getElementById('stage');
  const startScreen = document.getElementById('start-screen');
  const startText = document.getElementById('start-text');
  const startBtn = document.getElementById('startBtn');
  const colorSelect = document.getElementById('colorSelect');
  const toolSelect = document.getElementById('toolSelect');
  const sizeSlider = document.getElementById('sizeSlider');
  const fingerSelect = document.getElementById('fingerSelect');
  const sensSlider = document.getElementById('sensSlider'); // now controls smoothing
  const modeSelect = document.getElementById('modeSelect');

  let mode = modeSelect.value; // 'draw' or 'track'
  let brushColor = colorSelect.value;
  let brushSize = +sizeSlider.value;
  let brushTool = toolSelect.value;
  let selectedFinger = +fingerSelect.value; // 8/12/16/20 or -1 for all four
  let smoothing = sensSlider.value / 100;   // 0.1-0.9, higher = smoother/laggier

  // per (hand, fingertip) drawing state, keyed "h-fingerIdx"
  const traceState = new Map();
  function getState(key){
    if(!traceState.has(key)) traceState.set(key, {lastX:null,lastY:null,smoothX:null,smoothY:null});
    return traceState.get(key);
  }

  let started = false;
  let gotFirstResult = false;
  let sending = false;

  modeSelect.onchange = e => { mode = e.target.value; traceState.clear(); };
  colorSelect.onchange = e => brushColor = e.target.value;
  toolSelect.onchange = e => brushTool = e.target.value;
  sizeSlider.oninput = e => brushSize = +e.target.value;
  fingerSelect.onchange = e => { selectedFinger = +e.target.value; traceState.clear(); };
  sensSlider.oninput = e => smoothing = e.target.value/100;
  document.getElementById('clearBtn').onclick = ()=> drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height);

  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17]
  ];
  const TIPS = new Set([4,8,12,16,20]);

  function resize(){
    const r = stage.getBoundingClientRect();
    if(r.width < 2 || r.height < 2) return;
    [drawCanvas, skelCanvas].forEach(c=>{ c.width = r.width; c.height = r.height; });
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  function strokeSegment(x1,y1,x2,y2){
    drawCtx.lineCap='round'; drawCtx.lineJoin='round';
    if(brushTool==='pen'){
      drawCtx.globalAlpha=1; drawCtx.shadowBlur=8; drawCtx.shadowColor=brushColor;
      drawCtx.strokeStyle=brushColor; drawCtx.lineWidth=brushSize;
      drawCtx.beginPath(); drawCtx.moveTo(x1,y1); drawCtx.lineTo(x2,y2); drawCtx.stroke();
    } else if(brushTool==='pencil'){
      drawCtx.shadowBlur=0; drawCtx.globalAlpha=0.55;
      drawCtx.strokeStyle=brushColor; drawCtx.lineWidth=Math.max(1,brushSize*0.4);
      const j=()=> (Math.random()-0.5)*1.6;
      drawCtx.beginPath(); drawCtx.moveTo(x1+j(),y1+j()); drawCtx.lineTo(x2+j(),y2+j()); drawCtx.stroke();
    } else if(brushTool==='marker'){
      drawCtx.shadowBlur=16; drawCtx.shadowColor=brushColor; drawCtx.globalAlpha=0.8;
      drawCtx.strokeStyle=brushColor; drawCtx.lineWidth=brushSize*2.2;
      drawCtx.beginPath(); drawCtx.moveTo(x1,y1); drawCtx.lineTo(x2,y2); drawCtx.stroke();
    }
    drawCtx.globalAlpha=1; drawCtx.shadowBlur=0;
  }

  function onResults(results){
    if(!gotFirstResult){ gotFirstResult = true; }
    skelCtx.clearRect(0,0,skelCanvas.width,skelCanvas.height);

    const hands_ = results.multiHandLandmarks || [];
    if(hands_.length===0){
      traceState.forEach(s=>{ s.lastX=null; s.lastY=null; s.smoothX=null; s.smoothY=null; });
      statusEl.textContent='TRACKING'; statusEl.className='up';
      debugEl.textContent = 'no hand detected';
      return;
    }

    const fingersToTrace = selectedFinger === -1 ? [8,12,16,20] : [selectedFinger];
    const seenKeys = new Set();

    hands_.forEach((lm, h) => {
      if(h>1) return; // track at most 2 hands
      const pts = lm.map(p => ({ x:(1-p.x)*skelCanvas.width, y:p.y*skelCanvas.height }));

      skelCtx.strokeStyle = 'rgba(255,255,255,0.85)';
      skelCtx.lineWidth = 3; skelCtx.shadowColor = '#fff'; skelCtx.shadowBlur = 8;
      CONNECTIONS.forEach(([a,b])=>{
        skelCtx.beginPath(); skelCtx.moveTo(pts[a].x,pts[a].y); skelCtx.lineTo(pts[b].x,pts[b].y); skelCtx.stroke();
      });
      pts.forEach((p,i)=>{
        skelCtx.beginPath();
        skelCtx.fillStyle = TIPS.has(i) ? '#ffffff' : '#9a9a9a';
        skelCtx.shadowBlur = TIPS.has(i) ? 10 : 4;
        skelCtx.arc(p.x,p.y, TIPS.has(i)?5:3.5, 0, Math.PI*2);
        skelCtx.fill();
      });
      skelCtx.shadowBlur = 0;

      fingersToTrace.forEach(fIdx=>{
        const key = h+'-'+fIdx;
        seenKeys.add(key);
        const state = getState(key);
        const rawX = pts[fIdx].x, rawY = pts[fIdx].y;
        if(state.smoothX===null){ state.smoothX=rawX; state.smoothY=rawY; }
        else {
          state.smoothX = state.smoothX*smoothing + rawX*(1-smoothing);
          state.smoothY = state.smoothY*smoothing + rawY*(1-smoothing);
        }
        if(mode==='draw'){
          if(state.lastX!==null) strokeSegment(state.lastX,state.lastY,state.smoothX,state.smoothY);
          state.lastX = state.smoothX; state.lastY = state.smoothY;
        }
      });
    });

    // break strokes for any tracked point that vanished this frame (hand left screen)
    traceState.forEach((s,key)=>{
      if(!seenKeys.has(key)){ s.lastX=null; s.lastY=null; s.smoothX=null; s.smoothY=null; }
    });

    statusEl.textContent = mode==='draw' ? 'DRAWING' : 'TRACKING';
    statusEl.className = 'tracing';
    debugEl.textContent = hands_.length + ' hand(s) · ' + mode + ' mode · ' + (selectedFinger===-1?'all fingertips':'1 fingertip') + ' per hand';
  }

  const hands = new Hands({locateFile:(f)=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`});
  hands.setOptions({ maxNumHands:2, modelComplexity:1, minDetectionConfidence:0.7, minTrackingConfidence:0.6 });
  hands.onResults(onResults);

  // must await each send() before the next — calling MediaPipe's WASM engine
  // concurrently crashes it ("memory access out of bounds").
  async function frameLoop(){
    if(!sending){
      sending = true;
      try{ await hands.send({image:video}); }
      catch(e){ debugEl.textContent = 'tracking error: ' + e.message; }
      sending = false;
    }
    requestAnimationFrame(frameLoop);
  }

  async function start(){
    if(started) return;
    started = true;
    startBtn.disabled = true;
    startText.textContent = 'Requesting camera permission…';

    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      startText.textContent = 'Camera API unavailable. If you opened this file directly, serve it over http://localhost instead (Live Server / python -m http.server) — camera access is blocked on file:// pages.';
      startBtn.disabled = false; started = false;
      return;
    }
    try{
      const stream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480}, audio:false});
      video.srcObject = stream;
      await video.play().catch(()=>{});
      startScreen.classList.add('hidden');
      statusEl.textContent = 'LOADING MODEL…'; statusEl.className='idle';
      resize();

      const modelTimeout = setTimeout(()=>{
        if(!gotFirstResult){
          debugEl.textContent = 'still loading hand-tracking model — check your internet connection (first load downloads a few MB).';
        }
      }, 6000);

      frameLoop();
      setTimeout(()=>clearTimeout(modelTimeout), 7000);
    }catch(err){
      startText.textContent = 'Camera access failed: ' + err.name + ' — ' + err.message + '. Check your browser/OS camera permission for this site and try again.';
      startBtn.disabled = false; started = false;
    }
  }
  startBtn.onclick = start;
})();