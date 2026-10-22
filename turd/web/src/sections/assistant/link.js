// ===========================================================================
// ASSISTANT · link to the uplink server. POSTs a turn, reads the SSE stream,
// and if the connection drops mid-answer it re-attaches to the same turn
// (GET /api/assistant/turn?from=<last seq>) with backoff — the server keeps
// generating meanwhile, so nothing is lost on a Wi-Fi → LTE hop.
// ===========================================================================
let up=null;
const uplink = async()=>{ if(up!==null) return up||null; try{ up=await import("../../uplink.js"); }catch(e){ up=false; } return up||null; };

export async function base(){ const u=await uplink(); return u && u.configured && u.configured() ? u.endpoint() : ""; }
async function token(ctx){ const u=await uplink(); return (u && u.token && u.token()) || ctx?.session?.token || ""; }
async function H(ctx, json=true){ const t=await token(ctx); return { ...(json?{"content-type":"application/json"}:{}), ...(t?{authorization:"Bearer "+t}:{}) }; }

export async function get(ctx, path){
  const b=await base(); if(!b) return { ok:false, offline:true };
  try{ const r=await fetch(b+path,{headers:await H(ctx,false), signal:AbortSignal.timeout(8000)}); const j=await r.json().catch(()=>({})); return { status:r.status, ...j, ok:r.ok && j.ok!==false }; }
  catch(e){ return { ok:false, offline:true }; }
}
export async function post(ctx, path, body){
  const b=await base(); if(!b) return { ok:false, offline:true };
  try{ const r=await fetch(b+path,{method:"POST",headers:await H(ctx),body:JSON.stringify(body||{}), signal:AbortSignal.timeout(30000)}); const j=await r.json().catch(()=>({})); return { status:r.status, ...j, ok:r.ok && j.ok!==false }; }
  catch(e){ return { ok:false, offline:true, error:e.message }; }
}
export async function setEndpoint(url){ const u=await uplink(); if(u?.setEndpoint) u.setEndpoint(url); }
export async function hasUplinkModule(){ return !!(await uplink()); }

/* ---- SSE reader: yields {seq,type,data} ---- */
async function* sse(res, signal){
  const rd=res.body.getReader(), dec=new TextDecoder(); let buf="";
  try{
    while(true){
      const {value, done}=await rd.read(); if(done) return;
      buf+=dec.decode(value,{stream:true});
      let i; while((i=buf.indexOf("\n\n"))>=0){
        const raw=buf.slice(0,i); buf=buf.slice(i+2);
        let ev={seq:0,type:"message",data:null};
        for(const ln of raw.split("\n")){
          if(ln.startsWith("id:")) ev.seq=+ln.slice(3).trim();
          else if(ln.startsWith("event:")) ev.type=ln.slice(6).trim();
          else if(ln.startsWith("data:")) { try{ ev.data=JSON.parse(ln.slice(5).trim()); }catch(e){} }
        }
        if(ev.data!=null) yield ev;
      }
    }
  } finally { try{ rd.cancel(); }catch(e){} }
}

// Run one turn. onEvent(type, data). Resolves with {ended:"done"|"fail"|"lost"|"http", status?, body?}.
// signal aborts the local read (use stop() to stop server generation).
export async function turn(ctx, body, onEvent, signal){
  const b=await base(); if(!b) return { ended:"offline" };
  let res;
  // give up on an unreachable server after 10s (until headers arrive), so the on-device brain can step in fast
  const conn=new AbortController(), t=setTimeout(()=>conn.abort(),10000), relay=()=>conn.abort();
  signal?.addEventListener("abort",relay);
  try{ res=await fetch(b+"/api/assistant/chat",{method:"POST",headers:await H(ctx),body:JSON.stringify(body),signal:conn.signal}); }
  catch(e){ signal?.removeEventListener("abort",relay); clearTimeout(t); return { ended: signal?.aborted?"aborted":"offline" }; }
  clearTimeout(t);
  if(!res.ok || !(res.headers.get("content-type")||"").includes("event-stream")){
    const j=await res.json().catch(()=>({})); return { ended:"http", status:res.status, body:j };
  }
  let seq=0, turnId=null, finished=false;
  const pump=async r=>{
    for await (const ev of sse(r, signal)){
      seq=Math.max(seq,ev.seq);
      if(ev.type==="turn") turnId=ev.data.turn;
      onEvent(ev.type, ev.data);
      if(ev.type==="done") { finished=true; return; }
    }
  };
  try{ await pump(res); }catch(e){ if(signal?.aborted) return { ended:"aborted" }; }
  if(finished) return { ended:"done" };
  if(!turnId) return { ended:"lost" };
  // connection dropped mid-answer: re-attach with backoff for up to ~2 minutes
  onEvent("link", { state:"reconnecting" });
  for(let attempt=0, wait=600; attempt<14 && !signal?.aborted; attempt++, wait=Math.min(wait*1.7,15000)){
    await new Promise(r=>setTimeout(r,wait));
    try{
      const r=await fetch(`${b}/api/assistant/turn?id=${encodeURIComponent(turnId)}&from=${seq}`,{headers:await H(ctx,false),signal});
      if(r.status===404) return { ended:"lost" };
      if(!r.ok) continue;
      onEvent("link", { state:"restored" });
      await pump(r);
      if(finished) return { ended:"done" };
    }catch(e){ if(signal?.aborted) return { ended:"aborted" }; }
  }
  return { ended:"lost" };
}
