B=http://127.0.0.1:8799
TOK=$(curl -s $B/api/login -H 'content-type: application/json' -d '{"user":"admin","pw":"admin"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
ctl(){ curl -s 127.0.0.1:9911/__ctl -d "$1" >/dev/null; }
chat(){ curl -sN $B/api/assistant/chat -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d "$1"; }
texts(){ grep -A1 '^event: \(text\|tier\|fail\|done\|action\|notice\)' | grep -v '^--' | paste - - | sed 's/^event: //' | node -e '
let out="",o=[];require("readline").createInterface({input:process.stdin}).on("line",l=>{const [t,...r]=l.split("\t");const d=JSON.parse(r.join("\t").replace(/^data: /,""));if(t==="text")out+=d.t;else o.push(t+" "+JSON.stringify(d));}).on("close",()=>{console.log(o.join("\n"));console.log("TEXT: "+out)})'; }
