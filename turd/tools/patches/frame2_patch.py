# Border pass 2: corner reticles mirror the panel on both sides, radar cards share a height,
# and the bottom scroll fade sits inside the panel instead of spilling over its edge.
# Usage: python3 frame2_patch.py <web root>
import sys; from lib import P
R=sys.argv[1]
ix=P(R+"/index.html")
ix.rep("""  #status{padding-left:calc(var(--rail) + var(--rail-x) + 26px)}
}""","""  #status{padding-left:calc(var(--rail) + var(--rail-x) + 26px)}
  /* reticles sit 10px off every panel corner (stage padding: rail+40 left, rail+28 right, 56 bottom) */
  .reticle.tr,.reticle.br{right:calc(var(--rail) + 18px)}
  .reticle.bl,.reticle.br{bottom:46px}
  .panel .radar-wrap{align-items:stretch}
}
@media(min-width:761px) and (max-width:1100px){.reticle.tr,.reticle.br{right:14px}.panel .radar-wrap{align-items:start}}""")
ix.save()
ut=P(R+"/src/sections/util.js")
ut.rep('top.style.top=(T+1)+"px"; bot.style.top=(T+H-47)+"px";',
       'top.style.top=(T+1)+"px"; bot.style.top=(T+H-1-bot.offsetHeight)+"px";')
ut.save()
