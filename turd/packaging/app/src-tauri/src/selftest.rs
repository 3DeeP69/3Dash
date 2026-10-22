//! Debug-build self test of the native commands, run against a local test server:
//!   TURD_SELFTEST=http://127.0.0.1:PORT ./turd     (see tests/native-selftest.mjs)
//! Prints one "SELFTEST <name> ok|FAIL <detail>" line per check, then exits.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};

use crate::native::*;
use crate::server::*;

pub fn spawn<R: Runtime>(app: AppHandle<R>, base: String) {
    tauri::async_runtime::spawn(async move {
        let mut fails = 0;
        let mut check = |name: &str, ok: bool, detail: String| {
            if !ok {
                fails += 1;
            }
            println!("SELFTEST {name} {} {detail}", if ok { "ok" } else { "FAIL" });
        };
        let dir = std::env::temp_dir().join("turd-selftest");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().to_string();
        let big = reqwest::get(format!("{base}/big.bin")).await.unwrap().bytes().await.unwrap();
        let sha = hex::encode(Sha256::digest(&big));

        // http
        let r = nat_http(json!({ "url": format!("{base}/hello"), "method": "GET" })).await;
        check("http", r.as_ref().map(|v| v["status"] == 200 && v["body"] == "aGVsbG8=").unwrap_or(false), format!("{r:?}").chars().take(160).collect());

        // plain download + sha256
        let r = nat_extras_download(app.clone(), app.state(), json!({ "id": "a", "url": format!("{base}/big.bin"), "name": "a.bin", "sha256": sha, "dir": d })).await;
        let got = std::fs::read(dir.join("a.bin")).unwrap_or_default();
        check("download", r.is_ok() && got == big, format!("{r:?}"));

        // server drops the connection half way: must resume with Range and still verify
        let r = nat_extras_download(app.clone(), app.state(), json!({ "id": "b", "url": format!("{base}/flaky.bin"), "name": "b.bin", "sha256": sha, "dir": d })).await;
        let hits: Value = serde_json::from_str(&reqwest::get(format!("{base}/stats")).await.unwrap().text().await.unwrap()).unwrap();
        let got = std::fs::read(dir.join("b.bin")).unwrap_or_default();
        check("resume-after-drop", r.is_ok() && got == big && hits["ranges"].as_u64().unwrap_or(0) >= 1, format!("{r:?} {hits}"));

        // wrong hash must reject and not leave a finished file
        let r = nat_extras_download(app.clone(), app.state(), json!({ "id": "c", "url": format!("{base}/big.bin"), "name": "c.bin", "sha256": "00".repeat(32), "dir": d })).await;
        check("sha-mismatch-rejects", r.is_err() && !dir.join("c.bin").exists() && !dir.join("c.bin.part").exists(), format!("{r:?}"));

        // cancel keeps the .part, a second download resumes from it
        let app2 = app.clone();
        let d2 = d.clone();
        let base2 = base.clone();
        let sha2 = sha.clone();
        let h = tauri::async_runtime::spawn(async move {
            nat_extras_download(app2.clone(), app2.state(), json!({ "id": "e", "url": format!("{base2}/slow.bin"), "name": "e.bin", "sha256": sha2, "dir": d2 })).await
        });
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        let _ = nat_extras_cancel(app.state(), json!({ "id": "e" })).await;
        let r1 = h.await.unwrap();
        let part = std::fs::metadata(dir.join("e.bin.part")).map(|m| m.len()).unwrap_or(0);
        let r2 = nat_extras_download(app.clone(), app.state(), json!({ "id": "e", "url": format!("{base}/big.bin"), "name": "e.bin", "sha256": sha, "dir": d })).await;
        let got = std::fs::read(dir.join("e.bin")).unwrap_or_default();
        check("cancel-then-resume", r1.is_err() && part > 0 && (part as usize) < big.len() && r2.is_ok() && got == big, format!("part={part} r1={r1:?} r2={r2:?}"));

        // list (no dir: everything downloads recorded) + readRange + readText
        let l = nat_extras_list(app.clone(), app.state(), json!({})).await.unwrap();
        let ids: Vec<String> = l["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap_or("").to_string()).collect();
        check("list", ["a", "b", "e"].iter().all(|i| ids.contains(&i.to_string())) && !ids.contains(&"c".to_string()), format!("{ids:?}"));
        let off: u64 = 5_000_003;
        let rr = nat_extras_read_range(app.clone(), json!({ "id": "a", "offset": off, "length": 65536 })).await.unwrap();
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, rr["data"].as_str().unwrap()).unwrap();
        check("readRange", bytes == big[off as usize..off as usize + 65536], format!("len={}", bytes.len()));

        // unzip (zip-slip safe) + remove
        let r = nat_extras_download(app.clone(), app.state(), json!({ "id": "z", "url": format!("{base}/pack.zip"), "name": "pack.zip", "dir": d })).await;
        let u = nat_extras_unzip(app.clone(), json!({ "id": "z" })).await;
        let inner = std::fs::read_to_string(dir.join("pack").join("inner").join("hello.txt")).unwrap_or_default();
        check("unzip", r.is_ok() && u.is_ok() && inner == "hello from zip", format!("{u:?}"));
        let _ = nat_extras_remove(app.clone(), app.state(), json!({ "id": "z" })).await;
        check("remove", !dir.join("pack.zip").exists() && !dir.join("pack").exists(), String::new());

        // host the chat server (sidecar next to the exe), then stop it
        let s = nat_server_start(app.clone(), app.state(), json!({ "port": 8797 })).await;
        let health = reqwest::get("http://127.0.0.1:8797/api/health").await.ok();
        let hok = match health { Some(h) => h.text().await.unwrap_or_default().contains("\"ok\":true"), None => false };
        check("server-start", s.as_ref().map(|v| v["running"] == true).unwrap_or(false) && hok, format!("{s:?}"));
        let st = nat_server_stop(app.clone(), json!({})).await;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        check("server-stop", st.is_ok() && reqwest::get("http://127.0.0.1:8797/api/health").await.is_err(), String::new());

        println!("SELFTEST DONE {}", if fails == 0 { "PASS" } else { "FAIL" });
        app.exit(if fails == 0 { 0 } else { 1 });
    });
}
