# Crisp text on PC: no 3D transforms on text-bearing containers at rest.
# 3D-transformed layers are rasterised then resampled, which softens every glyph
# (measured 25-45% edge-sharpness loss at 100/125/150% Windows scaling).
# Usage: python3 crisp_patch.py <web root>
import sys; from lib import P
R=sys.argv[1]
ix=P(R+"/index.html")
ix.rep("transform:perspective(1700px) rotateX(2.2deg);transform-origin:center top;padding:28px 32px}",
       "padding:28px 32px}")
ix.save()
cs=P(R+"/src/sections/sections.css")
cs.rep("""/* helmet curvature: outer columns turn toward you */
@media(min-width:1000px){
  .t-l{transform:perspective(1600px) rotateY(3deg);transform-origin:right center}
  .t-r{transform:perspective(1600px) rotateY(-3deg);transform-origin:left center}
""","""/* helmet curvature: outer columns are lit like glass turning toward you
   (shading only: a real 3D turn resamples the text and blurs it on PC) */
@media(min-width:1000px){
""")
cs.rep(""".hm-wx{transform:perspective(1400px) rotateY(11deg);transform-origin:right center}
.hm-pj{transform:perspective(1400px) rotateY(-11deg);transform-origin:left center}
.hm-today{transform:perspective(1400px) translateZ(30px)}
""",""".hm-wx::after,.hm-pj::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1}
.hm-wx::after{background:linear-gradient(90deg,rgba(255,255,255,.07),transparent 38%,rgba(0,0,0,.22))}
.hm-pj::after{background:linear-gradient(270deg,rgba(255,255,255,.07),transparent 38%,rgba(0,0,0,.22))}
""")
cs.rep("""/* Home tiles pivot on their OUTER edge, so the turn recedes instead of growing past the panel */
.hm-wx{transform-origin:left center}
.hm-pj{transform-origin:right center}
""","")
cs.save()
hm=P(R+"/src/sections/home.js")
for b in ['perspective(1400px) rotateY(11deg)','perspective(1400px) rotateY(-11deg)']:
    hm.rep(f' data-base="{b}"','',2)
hm.rep(' data-base="perspective(1400px) translateZ(30px)"','')
hm.save()
