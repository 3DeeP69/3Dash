# Extras: its inner scroller hard-cut the kit cards at the panel bottom; fade them out instead.
import sys; from lib import P
R=sys.argv[1]
ix=P(R+"/index.html")
ix.rep("""@media(min-width:761px) and (max-width:1100px){.reticle.tr,.reticle.br{right:14px}.panel .radar-wrap{align-items:start}}""",
"""@media(min-width:761px) and (max-width:1100px){.reticle.tr,.reticle.br{right:14px}.panel .radar-wrap{align-items:start}}
/* inner scrollers end in a soft fade, never a hard line through a card's border */
.xx-body{-webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 40px),transparent)}""")
ix.save()
