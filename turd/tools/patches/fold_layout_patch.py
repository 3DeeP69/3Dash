import sys; sys.path.insert(0,sys.path[0]); from lib import P
root=sys.argv[1]
i=P(root+'/index.html')
i.rep('''</style>
<!-- section modules''','''/* Fold4 inner screen landscape (841x673) + short laptop windows: the 9-item rail is taller
   than the viewport, so compact it by height and let it scroll as a last resort */
#rail .nav{max-height:calc(100vh - 16px);overflow-y:auto;scrollbar-width:none}
#rail .nav::-webkit-scrollbar{display:none}
@media(min-width:761px) and (max-height:820px){#rail .nav{gap:4px;padding:12px 10px}.navbtn{min-height:56px;gap:3px}.navbtn .ico{font-size:21px}}
@media(min-width:761px) and (max-height:640px){.navbtn{min-height:46px}.navbtn .lbl{display:none}}
/* medium widths: the visor is centered for a wide screen; give the panel the room instead */
@media(min-width:761px) and (max-width:1100px){#stage{padding-right:24px}}
/* Fold4 cover screen (344px): nine dock icons fit only without labels; the active one keeps its label */
@media(max-width:420px){
  .navbtn{flex:1 1 0;min-width:0;padding:0}
  .navbtn .lbl{display:none}
  .navbtn.active .lbl{display:block;font-size:7px;letter-spacing:.3px}
  #rail .nav{gap:0;padding:6px 4px}
}
</style>
<!-- section modules''')
i.save()
