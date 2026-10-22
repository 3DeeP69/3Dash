import sys; sys.path.insert(0,sys.path[0]); from lib import P
root=sys.argv[1]; i=P(root+'/index.html')
i.rep('''</style>
<!-- section modules''','''/* ---- frame cleanup: every HUD line has its own lane, nothing crosses text or another edge ----
   arcs stay above the status text, the rail floats inside the visor bezel, the quality
   readout clears the corner reticle, and the bezel sits outside every panel. */
.arc svg{height:46px;filter:drop-shadow(0 0 10px rgba(var(--accent-rgb),.6))}
.arc.bot svg{height:34px}
.helmet-bezel{inset:6px;border-radius:44px;border-color:rgba(var(--accent-rgb),.22)}
.reticle{width:34px;height:34px;opacity:.55}
.reticle.tl,.reticle.tr{top:74px}.reticle.bl,.reticle.br{bottom:18px}
.reticle.tl,.reticle.bl{left:calc(var(--rail) + 30px)}
@media(min-width:761px){
  #perf{right:64px;bottom:14px}
  :root{--rail-x:16px}
  #rail{left:var(--rail-x)}
  #rail .nav{border-left:1px solid var(--glass-line);border-radius:26px}
  .navbtn.active::before{left:-11px}
  #stage{padding-left:calc(var(--rail) + var(--rail-x) + 24px)}
  #status{padding-left:calc(var(--rail) + var(--rail-x) + 26px)}
}
@media(max-width:760px){
  .arc svg{height:30px}.arc.bot{display:none}
  .reticle{display:none}
  .helmet-bezel{inset:4px;border-radius:28px}
}
</style>
<!-- section modules''')
i.save()
