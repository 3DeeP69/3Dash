import sys
class P:
    def __init__(s,path): s.path=path; s.s=open(path,encoding='utf-8').read(); s.orig=s.s
    def rep(s,old,new,cnt=1):
        n=s.s.count(old)
        if n!=cnt: raise SystemExit(f"[{s.path}] expected {cnt} got {n}: {old[:90]!r}")
        s.s=s.s.replace(old,new)
    def save(s):
        if s.s!=s.orig: open(s.path,'w',encoding='utf-8').write(s.s); print("patched",s.path)
