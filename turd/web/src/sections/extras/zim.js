// ===========================================================================
// ZIM ENGINE: reads Kiwix .zim files directly, with random access, so a
// 100 GB Wikipedia opens instantly and only the bytes for the page you're
// reading are touched. Implements the openZIM format (v5 + v6, old and new
// namespace layouts), zstd clusters (every Kiwix file since 2021), title
// search through the v0 title index or the X/listing/titleOrdered list.
// Spec: https://wiki.openzim.org/wiki/ZIM_file_format
// ===========================================================================
import { decompress as zstd } from "./vendor/fzstd.js";

const MAGIC = 72173914;
const td = new TextDecoder();

/* ------------------------------------------------------------ byte sources */
// Any object with { size, name, read(offset, length) → Promise<Uint8Array> } works.
export function fileSource(file){
  return { name:file.name, size:file.size,
    read:(o,n)=> file.slice(o, Math.min(o+n, file.size)).arrayBuffer().then(b=>new Uint8Array(b)) };
}
// HTTP(S) or app-local URL that honours Range requests (kiwix mirrors, Tauri asset://, Capacitor file server).
export async function urlSource(url, name, fetchFn=fetch){
  let size = 0;
  const r = await fetchFn(url, { headers:{ Range:"bytes=0-0" } });
  const cr = r.headers.get("content-range");
  if(cr && /\/(\d+)/.test(cr)) size = +RegExp.$1;
  else size = +(r.headers.get("content-length")||0);
  try{ await r.arrayBuffer(); }catch(e){}
  if(!size) throw new Error("server didn't report a file size");
  return { name:name||url.split("/").pop(), size,
    async read(o,n){ const e=Math.min(o+n, size)-1;
      const res = await fetchFn(url, { headers:{ Range:`bytes=${o}-${e}` } });
      if(res.status!==206 && o>0) throw new Error("server ignored the byte range");
      return new Uint8Array(await res.arrayBuffer()); } };
}

/* ------------------------------------------------------------ helpers */
const u16 = (b,o)=> b[o] | b[o+1]<<8;
const u32 = (b,o)=> (b[o] | b[o+1]<<8 | b[o+2]<<16 | b[o+3]<<24) >>> 0;
const u64 = (b,o)=> u32(b,o) + u32(b,o+4)*4294967296;
const cmp = (a,b)=> a<b?-1:a>b?1:0;   // JS string compare == UTF-16 order; close enough to libzim's byte order for BMP text
const enc = new TextEncoder();
const bcmp = (a,b)=>{ const x=enc.encode(a), y=enc.encode(b); const n=Math.min(x.length,y.length);
  for(let i=0;i<n;i++) if(x[i]!==y[i]) return x[i]-y[i]; return x.length-y.length; };

// ZIMs made before 2021 use xz clusters; the WASM decoder only loads if one shows up.
let xzLib = null;
async function unxz(raw){
  if(!xzLib){ const m = await import("./vendor/xzwasm.js"); xzLib = globalThis.xzwasm || (m && m.default); if(!xzLib) throw new Error("xz decoder unavailable"); }
  const stream = new xzLib.XzReadableStream(new Blob([raw]).stream());
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class LRU { constructor(n){ this.n=n; this.m=new Map(); }
  get(k){ const v=this.m.get(k); if(v!==undefined){ this.m.delete(k); this.m.set(k,v); } return v; }
  set(k,v){ this.m.delete(k); this.m.set(k,v); if(this.m.size>this.n) this.m.delete(this.m.keys().next().value); return v; } }

/* ------------------------------------------------------------ the archive */
// Directory lookups are thousands of tiny reads (8-byte pointers, ~100-byte dirents). File.slice / Range
// requests cost a few ms each, so small reads go through a page cache of 64 KB blocks.
const PAGE=65536;
function pageCache(src, max=192){
  if(src.cached) return src;
  const pages=new LRU(max), wait=new Map();
  const page=n=>{ const hit=pages.get(n); if(hit) return Promise.resolve(hit);
    if(wait.has(n)) return wait.get(n);
    const p=src.read(n*PAGE, Math.min(PAGE, src.size-n*PAGE)).then(b=>{ wait.delete(n); return pages.set(n,b); }, e=>{ wait.delete(n); throw e; });
    wait.set(n,p); return p; };
  return { ...src, cached:true, name:src.name, size:src.size,
    read: async(o,n)=>{
      n=Math.max(0, Math.min(n, src.size-o));
      if(n>PAGE) return src.read(o,n);
      const a=Math.floor(o/PAGE), b=Math.floor((o+n-1)/PAGE);
      if(a===b){ const pg=await page(a); return pg.subarray(o-a*PAGE, o-a*PAGE+n); }
      const [p1,p2]=await Promise.all([page(a),page(b)]), out=new Uint8Array(n), cut=PAGE-(o-a*PAGE);
      out.set(p1.subarray(o-a*PAGE)); out.set(p2.subarray(0,n-cut),cut); return out; } };
}

export class Zim {
  constructor(src){ this.src=pageCache(src); this.dirents=new LRU(4000); this.clusters=new LRU(12); this.inflight=new Map(); }

  static async open(src){
    const z = new Zim(src), h = await src.read(0, 80);
    if(h.length<80 || u32(h,0)!==MAGIC) throw new Error("not a ZIM file");
    z.h = { major:u16(h,4), minor:u16(h,6), entries:u32(h,24), clusterCount:u32(h,28),
      urlPtr:u64(h,32), titlePtr:u64(h,40), clusterPtr:u64(h,48), mimePtr:u64(h,56),
      main:u32(h,64), layout:u32(h,68), checksum:u64(h,72) };
    z.newNs = z.h.major>=6 && z.h.minor>=1;
    // MIME list: zero-terminated strings, ends with an empty one
    const mb = await src.read(z.h.mimePtr, Math.min(4096, z.h.urlPtr - z.h.mimePtr || 4096));
    z.mimes=[]; for(let p=0;;){ const e=mb.indexOf(0,p); if(e<=p) break; z.mimes.push(td.decode(mb.subarray(p,e))); p=e+1; }
    // cluster pointer table is small (8 B per cluster); keep it in memory
    const cp = await src.read(z.h.clusterPtr, z.h.clusterCount*8);
    z.cptr = new Float64Array(z.h.clusterCount);
    for(let i=0;i<z.h.clusterCount;i++) z.cptr[i]=u64(cp,i*8);
    z.hasTitleV0 = z.h.titlePtr>0 && z.h.titlePtr < src.size && z.h.titlePtr !== 0xffffffffffffffff;
    z.meta = {};
    for(const k of ["Title","Description","Language","Creator","Date","Name","Flavour"]){
      try{ const e=await z.find("M",k); if(e) z.meta[k]=td.decode(await z.data(e)); }catch(_){}
    }
    return z;
  }

  get size(){ return this.src.size; }
  get count(){ return this.h.entries; }
  get articleNs(){ return this.newNs ? "C" : "A"; }

  /* ---------- directory entries ---------- */
  async ptr(i){ const b=await this.src.read(this.h.urlPtr + i*8, 8); return u64(b,0); }
  async entry(i){
    const hit=this.dirents.get(i); if(hit) return hit;
    if(this.inflight.has(i)) return this.inflight.get(i);
    const p=(async()=>{
      const off=await this.ptr(i);
      let len=512, b;
      for(;;){ b=await this.src.read(off, len);
        const mime=u16(b,0), head = mime===0xffff ? 12 : 16;
        const z1=b.indexOf(0,head), z2=z1<0?-1:b.indexOf(0,z1+1);
        if(z2>=0 || off+len>=this.src.size){
          const ns=String.fromCharCode(b[3]), url=td.decode(b.subarray(head,z1)), title=td.decode(b.subarray(z1+1,z2<0?b.length:z2));
          const e={ i, ns, url, title:title||url, path:ns+"/"+url, mime: mime>=0xfffd ? null : this.mimes[mime] };
          if(mime===0xffff) e.redirect=u32(b,8); else if(mime<0xfffd){ e.cluster=u32(b,8); e.blob=u32(b,12); }
          return this.dirents.set(i,e);
        }
        len*=4;
      }
    })();
    this.inflight.set(i,p);
    try{ return await p; } finally{ this.inflight.delete(i); }
  }
  async follow(e, hops=10){ while(e && e.redirect!==undefined && hops--) e=await this.entry(e.redirect); return e; }

  // binary search the URL-ordered pointer list for ns/url
  async find(ns, url){
    const key=ns+"/"+url; let lo=0, hi=this.h.entries-1;
    while(lo<=hi){ const mid=(lo+hi)>>1, e=await this.entry(mid), c=bcmp(e.path,key);
      if(c===0) return e; if(c<0) lo=mid+1; else hi=mid-1; }
    return null;
  }
  // resolve "C/Foo" style paths (also tolerates links written for the old layout)
  async byPath(path){
    const m=/^([^/]+)\/(.*)$/.exec(path); if(!m) return null;
    let e=await this.find(m[1], m[2]);
    if(!e && this.newNs && m[1].length===1 && m[1]!=="C") e=await this.find("C", m[2]);
    if(!e && !this.newNs && m[1]==="C") e=await this.find("A", m[2]) || await this.find("I", m[2]) || await this.find("-", m[2]);
    return e;
  }
  async main(){
    if(this.h.main!==0xffffffff) return this.follow(await this.entry(this.h.main));
    const w = await this.find("W","mainPage"); return w ? this.follow(w) : null;
  }

  /* ---------- content ---------- */
  async cluster(n){
    const hit=this.clusters.get(n); if(hit) return hit;
    const start=this.cptr[n], end = n+1<this.h.clusterCount ? this.cptr[n+1] : this.h.checksum;
    const info=(await this.src.read(start,1))[0], comp=info&15, ext=!!(info&16), osz=ext?8:4;
    if(comp<=1){
      // uncompressed (usually images): read only the offsets + blobs we need
      return this.clusters.set(n, { raw:true, start:start+1, osz });
    }
    if(comp!==5 && comp!==4) throw new Error("unknown cluster compression "+comp);
    const raw = await this.src.read(start+1, end-start-1);
    const data = comp===5 ? zstd(raw) : await unxz(raw);
    return this.clusters.set(n, { data, osz });
  }
  async data(e){
    e = await this.follow(e);
    if(!e || e.cluster===undefined) throw new Error("no content");
    const c = await this.cluster(e.cluster), rd=(b,o)=> c.osz===8 ? u64(b,o) : u32(b,o);
    if(c.raw){
      const offs = await this.src.read(c.start + e.blob*c.osz, c.osz*2);
      const a=rd(offs,0), b=rd(offs,c.osz);
      return this.src.read(c.start + a, b-a);
    }
    const a=rd(c.data, e.blob*c.osz), b=rd(c.data, (e.blob+1)*c.osz);
    return c.data.subarray(a,b);
  }
  async text(e){ return td.decode(await this.data(e)); }

  /* ---------- title search ---------- */
  async titleIndex(){
    if(this._ti!==undefined) return this._ti;
    if(this.hasTitleV0){ this._ti={ kind:"v0", n:this.h.entries, at:async k=>u32(await this.src.read(this.h.titlePtr+k*4,4),0) }; return this._ti; }
    for(const name of ["listing/titleOrdered/v1","listing/titleOrdered/v0"]){
      const e=await this.find("X",name);
      if(e){ const b=await this.data(e); const arr=new Uint32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
        this._ti={ kind:name, n:arr.length, at:async k=>arr[k] }; return this._ti; }
    }
    return this._ti=null;
  }
  // prefix search over titles in the article namespace; tries the query as typed and with a capital first letter
  async search(q, limit=24){
    q=q.trim(); if(!q) return [];
    const ti=await this.titleIndex(); if(!ti) return [];
    const ns=this.articleNs, out=new Map();
    const variants=[...new Set([q, q[0].toUpperCase()+q.slice(1), q.replace(/\b\w/g,c=>c.toUpperCase())])];
    for(const v of variants){
      const key=ns+"/"+v;
      let lo=0, hi=ti.n;
      while(lo<hi){ const mid=(lo+hi)>>1, e=await this.entry(await ti.at(mid)); if(bcmp(e.ns+"/"+e.title,key)<0) lo=mid+1; else hi=mid; }
      for(let k=lo;k<ti.n && out.size<limit;k++){
        const e=await this.entry(await ti.at(k));
        if(e.ns!==ns || !e.title.startsWith(v)) break;
        const t=await this.follow(e);
        if(t && (!t.mime || /html/.test(t.mime)) && !out.has(t.i)) out.set(t.i,{ title:e.title, path:t.path });
      }
      if(out.size>=limit) break;
    }
    return [...out.values()];
  }
  // a random article (for "surprise me")
  async random(){
    const ti=await this.titleIndex();
    for(let tries=0;tries<40;tries++){
      const i = ti ? await ti.at(Math.floor(Math.random()*ti.n)) : Math.floor(Math.random()*this.h.entries);
      const e=await this.follow(await this.entry(i));
      if(e && e.ns===this.articleNs && /html/.test(e.mime||"")) return e;
    }
    return this.main();
  }
}
