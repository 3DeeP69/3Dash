import sys; sys.path.insert(0,sys.path[0]); from lib import P
root=sys.argv[1]
i=P(root+'/index.html')
i.rep('''</style>
<!-- section modules''','''/* the status bar sat under #stage (same z-index, earlier in the DOM), so the shown section's
   full-screen box swallowed taps on the wordmark; lift it (it stays pointer-events:none except its controls) */
#status{z-index:9}
/* status-bar session tools (Access log for admins, Lock for everyone): text-style, no pills */
#st-tools{display:inline-flex;gap:4px;margin-right:6px;pointer-events:auto}
.st-btn{background:none;border:0;color:var(--ink-dim);font:inherit;letter-spacing:inherit;text-transform:uppercase;cursor:pointer;padding:8px 6px;transition:color .2s,text-shadow .2s}
.st-btn:hover,.st-btn:focus-visible{outline:none;color:var(--ink);text-shadow:0 0 12px rgba(var(--accent-rgb),.8)}
#stAudit{color:#ff8a9c}#stAudit:hover{color:#fff;text-shadow:0 0 12px rgba(255,92,122,.8)}
@media(max-width:760px){ #st-tools{position:fixed;top:calc(36px + var(--sat,0px));left:16px;margin:0;font-size:9px} .st-btn{padding:6px 6px 6px 0} }
</style>
<!-- section modules''')
i.save()
