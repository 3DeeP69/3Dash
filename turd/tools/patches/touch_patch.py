import sys; sys.path.insert(0,sys.path[0]); from lib import P
root=sys.argv[1]; c=P(root+'/src/sections/sections.css')
marker='/* ===== touch targets (tidy-up thread) ===== */'
if marker in c.s: raise SystemExit("already applied")
c.s=c.s.rstrip('\n')+'''

'''+marker+'''
/* Fold4 / phones: text-style controls were 16-28px tall; give fingers ~40px without changing the desktop look */
@media (pointer:coarse){
  .t-link,.t-btn.sm,.hm-go,.lg-type,.lg-tabs button,.btn.sm{min-height:40px;display:inline-flex;align-items:center;justify-content:center}
  .hm-go{justify-content:flex-start}
  .lg-acts button{width:40px;height:40px}
}
@media (pointer:coarse) and (max-width:760px){
  .lg-item{grid-template-columns:36px 1fr}
  .lg-acts{grid-column:2;margin:-4px 0 0 -10px}
}
'''
c.save()
