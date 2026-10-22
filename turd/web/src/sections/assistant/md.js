// ===========================================================================
// ASSISTANT · tiny safe markdown. Escapes everything first, then applies a
// small, predictable subset: paragraphs, **bold**, *italic*, `code`, fenced
// code, - / 1. lists, > quotes, # headings (as strong lines), links.
// Tolerates half-streamed input (an unclosed fence renders as open code).
// ===========================================================================
const esc = s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function inline(s){
  s=esc(s);
  const codes=[];
  s=s.replace(/`([^`\n]+)`/g,(_,c)=>{ codes.push(c); return `\u0000${codes.length-1}\u0000`; });
  s=s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s=s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g,'$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  s=s.replace(/\*\*([^*\n]+)\*\*/g,"<b>$1</b>").replace(/__([^_\n]+)__/g,"<b>$1</b>");
  s=s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g,"$1<i>$2</i>").replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g,"$1<i>$2</i>");
  s=s.replace(/~~([^~\n]+)~~/g,"<s>$1</s>");
  return s.replace(/\u0000(\d+)\u0000/g,(_,i)=>`<code>${codes[+i]}</code>`);
}

export function md(src){
  const lines=String(src||"").replace(/\r/g,"").split("\n");
  const out=[]; let i=0;
  while(i<lines.length){
    const ln=lines[i];
    const fence=ln.match(/^\s*```\s*([\w+-]*)/);
    if(fence){
      const body=[]; i++;
      while(i<lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="as-code"${fence[1]?` data-lang="${esc(fence[1])}"`:""}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    if(/^\s*$/.test(ln)){ i++; continue; }
    const h=ln.match(/^\s*(#{1,4})\s+(.*)$/);
    if(h){ out.push(`<p class="as-h">${inline(h[2])}</p>`); i++; continue; }
    if(/^\s*([-*•]|\d+[.)])\s+/.test(ln)){
      const ordered=/^\s*\d+[.)]/.test(ln), items=[];
      while(i<lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])){
        let item=lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/,""); i++;
        while(i<lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) item+=" "+lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered?`<ol>${items.join("")}</ol>`:`<ul>${items.join("")}</ul>`); continue;
    }
    if(/^\s*>/.test(ln)){
      const q=[]; while(i<lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/,""));
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`); continue;
    }
    const para=[ln]; i++;
    while(i<lines.length && !/^\s*$/.test(lines[i]) && !/^\s*(```|#{1,4}\s|>|[-*•]\s|\d+[.)]\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}

// plain text for speech / copy
export const plain = s=> String(s||"").replace(/```[\s\S]*?(```|$)/g," (code) ").replace(/`([^`]+)`/g,"$1")
  .replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/[*_~#>]+/g,"").replace(/\n{2,}/g,"\n").trim();
