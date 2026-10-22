// ===========================================================================
// Animated HUD weather glyphs — inline SVG, themed by currentColor + --accent.
// Animation lives in sections.css (.wi-*) so LOW quality can switch it off.
// ===========================================================================
const sun = (cx=32,cy=32,r=10)=>`<g class="wi-sun"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffd36b" stroke="#ffb02e" stroke-width="2"/>
  <g class="wi-rays" stroke="#ffcf5c" stroke-width="2.4" stroke-linecap="round" style="transform-origin:${cx}px ${cy}px">${
  [0,45,90,135,180,225,270,315].map(a=>{ const r1=r+5,r2=r+10,t=a*Math.PI/180;
    return `<line x1="${cx+Math.cos(t)*r1}" y1="${cy+Math.sin(t)*r1}" x2="${cx+Math.cos(t)*r2}" y2="${cy+Math.sin(t)*r2}"/>`; }).join("")}</g></g>`;
const moon = (cx=30,cy=28)=>`<g class="wi-moon"><path d="M${cx+8} ${cy-13}a14 14 0 1 0 9 20a11 11 0 1 1 -9 -20z" fill="#dfe8ff" stroke="#9fb4ff" stroke-width="1.6"/>
  <circle class="wi-twinkle" cx="50" cy="12" r="1.4" fill="#fff"/><circle class="wi-twinkle t2" cx="12" cy="44" r="1.1" fill="#fff"/></g>`;
const cloud = (dx=0,dy=0,op=1,cls="")=>`<path class="wi-cloud ${cls}" transform="translate(${dx} ${dy})" opacity="${op}"
  d="M20 46h26a10 10 0 0 0 0-20a14 14 0 0 0-26.5-3.5A10 10 0 0 0 20 46z" fill="rgba(220,235,255,.92)" stroke="var(--accent,#6ad6ff)" stroke-width="1.6"/>`;
const drops = n=>Array.from({length:n},(_,i)=>`<line class="wi-drop" style="animation-delay:${i*.22}s" x1="${22+i*8}" y1="50" x2="${19+i*8}" y2="58"
  stroke="var(--accent,#6ad6ff)" stroke-width="2.4" stroke-linecap="round"/>`).join("");
const flakes = n=>Array.from({length:n},(_,i)=>`<circle class="wi-flake" style="animation-delay:${i*.35}s" cx="${22+i*9}" cy="54" r="2.2" fill="#fff"/>`).join("");

export function wxIcon(kind, isDay=true, size=64){
  let body="";
  switch(kind){
    case "clear":  body = isDay ? sun() : moon(); break;
    case "partly": body = (isDay ? sun(24,24,8) : moon(22,20)) + cloud(6,4); break;
    case "cloud":  body = cloud(-6,-6,.55,"c2") + cloud(4,2); break;
    case "fog":    body = cloud(0,-6) + [48,54,60].map((y,i)=>`<line class="wi-fog" style="animation-delay:${i*.4}s" x1="12" y1="${y}" x2="52" y2="${y}" stroke="#cfe0ff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>`).join(""); break;
    case "rain":   body = cloud(0,-6) + drops(4); break;
    case "snow":   body = cloud(0,-6) + flakes(4); break;
    case "storm":  body = cloud(-4,-10,.6,"c2") + cloud(0,-6) + `<path class="wi-bolt" d="M34 42l-8 12h7l-4 10 11-14h-7l5-8z" fill="#ffe14d" stroke="#ffb02e" stroke-width="1"/>` + drops(2); break;
    default:       body = cloud();
  }
  return `<svg class="wi wi-${kind}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}
