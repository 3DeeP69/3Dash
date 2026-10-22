//! window.TURD_NATIVE for Windows (JS side: web/src/native.js).
//!
//! Every command takes one JSON object `a` and resolves JSON; lists come back as
//! `{items:[...]}` and maps as `{map:{...}}`, the same shapes the Android plugin uses.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures_util::StreamExt;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::io::AsyncWriteExt;

pub type Res = Result<Value, String>;

#[derive(Default)]
pub struct NatState {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
    children: Mutex<HashMap<u32, Child>>,
    meta_lock: Mutex<()>,
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn s(a: &Value, k: &str) -> String {
    a.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn ok() -> Value {
    json!({ "ok": true })
}

/* ================================================================ app */

#[tauri::command]
pub async fn nat_info<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let _ = a;
    let dir = default_dir(&app);
    Ok(json!({
        "platform": "windows",
        "version": app.package_info().version.to_string(),
        "device": std::env::var("COMPUTERNAME").unwrap_or_default(),
        "freeBytes": free_bytes(&dir),
    }))
}

#[tauri::command]
pub async fn nat_open_external(a: Value) -> Res {
    let url = s(&a, "url");
    if url.is_empty() {
        return Err("url required".into());
    }
    shell_open(&url)?;
    Ok(ok())
}

/// ShellExecute "open": URLs go to the default browser / store, files to their app,
/// .exe / .msi launch (with the usual UAC prompt when the installer needs it).
pub(crate) fn shell_open(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let r = ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(target), None, None, SW_SHOWNORMAL);
        if (r.0 as isize) <= 32 {
            return Err(format!("could not open {target} (code {})", r.0 as isize));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn nat_fullscreen<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let w = app.get_window("main").ok_or("no window")?;
    let on = match a.get("on").and_then(|v| v.as_bool()) {
        Some(v) => v,
        None => !w.is_fullscreen().unwrap_or(false),
    };
    w.set_fullscreen(on).map_err(|e| e.to_string())?;
    Ok(json!({ "fullscreen": on }))
}

/* ================================================================ http */

fn client() -> &'static reqwest::Client {
    static C: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) TURD/1.0")
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("http client")
    })
}

#[tauri::command]
pub async fn nat_http(a: Value) -> Res {
    let url = s(&a, "url");
    let method = reqwest::Method::from_bytes(s(&a, "method").to_uppercase().as_bytes()).unwrap_or(reqwest::Method::GET);
    let timeout = a.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(30000);
    let follow = a.get("follow").and_then(|v| v.as_bool()).unwrap_or(true);
    let c = if follow {
        client().clone()
    } else {
        reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?
    };
    let mut rq = c.request(method, &url).timeout(Duration::from_millis(timeout));
    if let Some(h) = a.get("headers").and_then(|v| v.as_object()) {
        for (k, v) in h {
            if let Some(v) = v.as_str() {
                rq = rq.header(k.as_str(), v);
            }
        }
    }
    if let Some(b) = a.get("body").and_then(|v| v.as_str()) {
        rq = rq.body(B64.decode(b).map_err(|e| e.to_string())?);
    }
    let r = rq.send().await.map_err(|e| format!("network error: {e}"))?;
    let status = r.status();
    let final_url = r.url().to_string();
    let mut headers = Map::new();
    for (k, v) in r.headers() {
        let v = v.to_str().unwrap_or("").to_string();
        let key = k.as_str().to_string();
        let joined = match headers.get(&key).and_then(|x| x.as_str()) {
            Some(prev) => format!("{prev}, {v}"),
            None => v,
        };
        headers.insert(key, Value::String(joined));
    }
    let body = r.bytes().await.map_err(|e| format!("network error: {e}"))?;
    if body.len() > 64 * 1024 * 1024 {
        return Err("response larger than 64 MB".into());
    }
    Ok(json!({
        "status": status.as_u16(),
        "statusText": status.canonical_reason().unwrap_or(""),
        "url": final_url,
        "headers": headers,
        "body": B64.encode(&body),
    }))
}

/* ================================================================ extras: storage */

/// Default library folder: Documents\T.U.R.D. Extras (visible, survives uninstall).
pub(crate) fn default_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_local_data_dir())
        .unwrap_or_else(|_| std::env::temp_dir());
    let d = base.join("T.U.R.D. Extras");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn dir_for<R: Runtime>(app: &AppHandle<R>, a: &Value) -> PathBuf {
    let d = s(a, "dir");
    if d.is_empty() {
        return default_dir(app);
    }
    let p = PathBuf::from(d);
    let _ = std::fs::create_dir_all(&p);
    p
}

pub(crate) fn free_bytes(p: &Path) -> i64 {
    disk(p).0
}

fn disk(p: &Path) -> (i64, i64) {
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut free = 0u64;
        let mut total = 0u64;
        if GetDiskFreeSpaceExW(&HSTRING::from(p.as_os_str()), Some(&mut free), Some(&mut total), None).is_ok() {
            return (free as i64, total as i64);
        }
        (-1, -1)
    }
    #[cfg(not(windows))]
    {
        let _ = p;
        (-1, -1)
    }
}

fn meta_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let d = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&d);
    d.join("extras-meta.json")
}

fn meta_all<R: Runtime>(app: &AppHandle<R>) -> Map<String, Value> {
    std::fs::read_to_string(meta_path(app))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn meta_put<R: Runtime>(app: &AppHandle<R>, st: &NatState, id: &str, v: Option<Value>) {
    let _g = st.meta_lock.lock().unwrap();
    let mut m = meta_all(app);
    match v {
        Some(v) => {
            m.insert(id.to_string(), v);
        }
        None => {
            m.remove(id);
        }
    }
    let _ = std::fs::write(meta_path(app), serde_json::to_vec_pretty(&Value::Object(m)).unwrap_or_default());
}

fn file_of<R: Runtime>(app: &AppHandle<R>, id: &str) -> PathBuf {
    if let Some(p) = meta_all(app).get(id).and_then(|m| m.get("path")).and_then(|p| p.as_str()) {
        return PathBuf::from(p);
    }
    default_dir(app).join(safe_name(id))
}

fn safe_name(n: &str) -> String {
    let s: String = n
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || (c as u32) < 32 { '_' } else { c })
        .collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() || s == ".." { "file".into() } else { s }
}

fn part_of(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

#[tauri::command]
pub async fn nat_extras_info<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let d = dir_for(&app, &a);
    let (free, total) = disk(&d);
    Ok(json!({ "dir": d, "freeBytes": free, "totalBytes": total, "platform": "windows" }))
}

#[tauri::command]
pub async fn nat_extras_dirs<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let _ = a;
    let def = default_dir(&app);
    let (f, t) = disk(&def);
    #[allow(unused_mut)]
    let mut items = vec![json!({ "path": def, "label": "Documents", "freeBytes": f, "totalBytes": t, "removable": false })];
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
        let mask = GetLogicalDrives();
        for i in 0..26u32 {
            if mask & (1 << i) == 0 {
                continue;
            }
            let root = format!("{}:\\", (b'A' + i as u8) as char);
            let kind = GetDriveTypeW(&HSTRING::from(root.as_str()));
            // 2 = removable, 3 = fixed, 4 = network
            if !(2..=4).contains(&kind) {
                continue;
            }
            let (f, t) = disk(Path::new(&root));
            if t <= 0 {
                continue;
            }
            let label = match kind { 2 => "USB / SD", 4 => "Network drive", _ => "Drive" };
            items.push(json!({
                "path": format!("{root}T.U.R.D. Extras"),
                "label": format!("{label} {}", &root[..2]),
                "freeBytes": f, "totalBytes": t, "removable": kind == 2,
            }));
        }
    }
    Ok(json!({ "items": items }))
}

#[tauri::command]
pub async fn nat_extras_pick_dir<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let _ = a;
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().set_title("Where should Extras be stored?").blocking_pick_folder();
    Ok(match picked.and_then(|p| p.into_path().ok()) {
        Some(p) => {
            let (f, t) = disk(&p);
            json!({ "path": p, "freeBytes": f, "totalBytes": t })
        }
        None => json!({ "path": null }),
    })
}

fn dir_size(p: &Path) -> u64 {
    std::fs::read_dir(p)
        .map(|rd| {
            rd.flatten()
                .map(|e| {
                    let m = e.metadata();
                    match m {
                        Ok(m) if m.is_dir() => dir_size(&e.path()),
                        Ok(m) => m.len(),
                        _ => 0,
                    }
                })
                .sum()
        })
        .unwrap_or(0)
}

/// Downloaded files. With {dir}: everything in that folder. Without: every file a
/// download recorded (whatever folder it went to) plus the default folder.
/// In-progress ".part" files are only included with {partial:true}.
#[tauri::command]
pub async fn nat_extras_list<R: Runtime>(app: AppHandle<R>, st: State<'_, NatState>, a: Value) -> Res {
    let with_partial = a.get("partial").and_then(|v| v.as_bool()).unwrap_or(false);
    let d = dir_for(&app, &a);
    let by_path: HashMap<String, String> = meta_all(&app)
        .into_iter()
        .filter_map(|(id, m)| m.get("path").and_then(|p| p.as_str()).map(|p| (p.to_string(), id)))
        .collect();
    let active = st.active.lock().unwrap().keys().cloned().collect::<Vec<_>>();
    let mut paths: Vec<PathBuf> = vec![];
    if let Ok(rd) = std::fs::read_dir(&d) {
        paths.extend(rd.flatten().map(|e| e.path()));
    }
    if s(&a, "dir").is_empty() {
        for p in by_path.keys() {
            for cand in [PathBuf::from(p), part_of(Path::new(p))] {
                if cand.exists() && !paths.contains(&cand) {
                    paths.push(cand);
                }
            }
        }
    }
    let mut items = vec![];
    for p in paths {
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let partial = name.ends_with(".part");
        if partial && !with_partial {
            continue;
        }
        let full = if partial { p.with_file_name(&name[..name.len() - 5]) } else { p.clone() };
        let full_s = full.to_string_lossy().to_string();
        let id = by_path.get(&full_s).cloned().unwrap_or_else(|| full.file_name().unwrap_or_default().to_string_lossy().to_string());
        let m = std::fs::metadata(&p).ok();
        let is_dir = m.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let mtime = m
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        items.push(json!({
            "id": id, "name": full.file_name().unwrap_or_default().to_string_lossy(),
            "size": if is_dir { dir_size(&p) } else { m.map(|m| m.len()).unwrap_or(0) },
            "path": p, "mtime": mtime, "partial": partial, "dir": is_dir,
            "active": active.contains(&id),
        }));
    }
    Ok(json!({ "items": items }))
}

/* ================================================================ extras: download */

fn emit<R: Runtime>(app: &AppHandle<R>, id: &str, received: i64, total: i64, state: &str, err: Option<String>) {
    let mut v = json!({ "id": id, "received": received, "total": total, "state": state });
    if let Some(e) = err {
        v["error"] = Value::String(e);
    }
    let _ = app.emit("extras:progress", v);
}

fn hash_file(p: &Path, h: &mut Sha256) -> std::io::Result<()> {
    let mut f = std::fs::File::open(p)?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        h.update(&buf[..n]);
    }
}

fn sha_of(p: &Path) -> std::io::Result<String> {
    let mut h = Sha256::new();
    hash_file(p, &mut h)?;
    Ok(hex::encode(h.finalize()))
}

#[tauri::command]
pub async fn nat_extras_download<R: Runtime>(app: AppHandle<R>, st: State<'_, NatState>, a: Value) -> Res {
    let id = s(&a, "id");
    let url = s(&a, "url");
    if id.is_empty() || url.is_empty() {
        return Err("id and url are required".into());
    }
    let mut name = s(&a, "name");
    if name.is_empty() {
        name = url.split('?').next().unwrap_or("").rsplit('/').next().unwrap_or("file").to_string();
    }
    let dest = dir_for(&app, &a).join(safe_name(&name));
    let sha = s(&a, "sha256").to_lowercase();
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut act = st.active.lock().unwrap();
        if act.contains_key(&id) {
            return Err(format!("already downloading {id}"));
        }
        act.insert(id.clone(), stop.clone());
    }
    meta_put(&app, &st, &id, Some(json!({ "path": dest, "url": url, "sha256": sha })));
    let r = fetch_resumable(&app, &id, &url, &dest, &sha, &stop).await;
    st.active.lock().unwrap().remove(&id);
    match r {
        Ok(size) => {
            emit(&app, &id, size as i64, size as i64, "done", None);
            Ok(json!({ "id": id, "path": dest, "size": size, "verified": !sha.is_empty() }))
        }
        Err(e) => {
            let cancelled = stop.load(Ordering::Relaxed);
            emit(&app, &id, -1, -1, if cancelled { "cancelled" } else { "error" }, Some(e.clone()));
            Err(if cancelled { "cancelled".into() } else { e })
        }
    }
}

/// url → dest.part with HTTP Range resume (after a drop or an app restart), optional
/// sha256, then rename. A finished file whose hash matches is returned as is.
async fn fetch_resumable<R: Runtime>(app: &AppHandle<R>, id: &str, url: &str, dest: &Path, sha: &str, stop: &AtomicBool) -> Result<u64, String> {
    let part = part_of(dest);
    if dest.exists() && !part.exists() {
        let d = dest.to_path_buf();
        let good = sha.is_empty() || tokio::task::spawn_blocking(move || sha_of(&d)).await.ok().and_then(|r| r.ok()).as_deref() == Some(sha);
        if good {
            return Ok(std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0));
        }
        let _ = std::fs::remove_file(dest);
    }
    let mut attempt = 0u32;
    let mut last = Instant::now() - Duration::from_secs(1);
    loop {
        let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        let mut rq = client().get(url).header("User-Agent", "TURD-Extras/1.0 (Windows)");
        if have > 0 {
            rq = rq.header("Range", format!("bytes={have}-"));
        }
        let res: Result<(), String> = async {
            let r = rq.send().await.map_err(|e| e.to_string())?;
            let code = r.status().as_u16();
            if code == 416 && have > 0 {
                return Ok(()); // .part already complete
            }
            if code >= 400 {
                return Err(format!("HTTP {code}"));
            }
            let resumed = code == 206 && have > 0;
            let start = if resumed { have } else { 0 };
            let total = r.content_length().map(|l| (l + start) as i64).unwrap_or(-1);
            let mut f = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .append(resumed)
                .truncate(!resumed)
                .open(&part)
                .await
                .map_err(|e| e.to_string())?;
            let mut got = start;
            let mut stream = r.bytes_stream();
            while let Some(chunk) = stream.next().await {
                if stop.load(Ordering::Relaxed) {
                    return Err("cancelled".into());
                }
                let chunk = chunk.map_err(|e| e.to_string())?;
                f.write_all(&chunk).await.map_err(|e| e.to_string())?;
                got += chunk.len() as u64;
                if last.elapsed() > Duration::from_millis(400) {
                    last = Instant::now();
                    emit(app, id, got as i64, total, "downloading", None);
                }
            }
            f.flush().await.map_err(|e| e.to_string())?;
            f.sync_all().await.map_err(|e| e.to_string())?;
            if total > 0 && (got as i64) < total {
                return Err(format!("connection dropped at {got}/{total}"));
            }
            Ok(())
        }
        .await;
        match res {
            Ok(()) => break,
            Err(e) => {
                if stop.load(Ordering::Relaxed) {
                    return Err(e);
                }
                attempt += 1;
                if attempt > 8 {
                    return Err(e);
                }
                emit(app, id, std::fs::metadata(&part).map(|m| m.len() as i64).unwrap_or(0), -1, "retrying", Some(e));
                tokio::time::sleep(Duration::from_millis((1000u64 << attempt).min(30000))).await;
            }
        }
    }
    if !sha.is_empty() {
        let size = std::fs::metadata(&part).map(|m| m.len() as i64).unwrap_or(0);
        emit(app, id, size, size, "verifying", None);
        let p = part.clone();
        let got = tokio::task::spawn_blocking(move || sha_of(&p)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
        if got != sha {
            let _ = std::fs::remove_file(&part);
            return Err(format!("sha256 mismatch: expected {sha}, got {got}"));
        }
    }
    let _ = std::fs::remove_file(dest);
    std::fs::rename(&part, dest).map_err(|e| format!("could not finalise {}: {e}", dest.display()))?;
    Ok(std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0))
}

#[tauri::command]
pub async fn nat_extras_cancel(st: State<'_, NatState>, a: Value) -> Res {
    if let Some(s) = st.active.lock().unwrap().get(&s(&a, "id")) {
        s.store(true, Ordering::Relaxed);
    }
    Ok(ok())
}

#[tauri::command]
pub async fn nat_extras_remove<R: Runtime>(app: AppHandle<R>, st: State<'_, NatState>, a: Value) -> Res {
    let id = s(&a, "id");
    if let Some(s) = st.active.lock().unwrap().get(&id) {
        s.store(true, Ordering::Relaxed);
    }
    let f = file_of(&app, &id);
    tokio::time::sleep(Duration::from_millis(300)).await; // let a running download release the file
    let rm = |p: &Path| {
        if p.is_dir() {
            let _ = std::fs::remove_dir_all(p);
        } else {
            let _ = std::fs::remove_file(p);
        }
    };
    rm(&f);
    rm(&part_of(&f));
    if f.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false) {
        rm(&f.with_extension(""));
    }
    meta_put(&app, &st, &id, None);
    Ok(ok())
}

#[tauri::command]
pub async fn nat_extras_open<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let f = file_of(&app, &s(&a, "id"));
    if !f.exists() {
        return Err("not downloaded yet".into());
    }
    shell_open(&f.to_string_lossy())?;
    Ok(ok())
}

#[tauri::command]
pub async fn nat_extras_read_text<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let f = file_of(&app, &s(&a, "id"));
    let len = std::fs::metadata(&f).map(|m| m.len()).map_err(|e| e.to_string())?;
    if len > 8 * 1024 * 1024 {
        return Err("file larger than 8 MB; use readRange".into());
    }
    let t = std::fs::read(&f).map_err(|e| e.to_string())?;
    Ok(json!({ "text": String::from_utf8_lossy(&t) }))
}

/// Random access for in-place readers (ZIM): [offset, offset+length), ≤16 MB per call.
#[tauri::command]
pub async fn nat_extras_read_range<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let f = file_of(&app, &s(&a, "id"));
    let off = a.get("offset").and_then(|v| v.as_f64()).unwrap_or(0.0).max(0.0) as u64;
    let len = a.get("length").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(0.0, 16.0 * 1024.0 * 1024.0) as u64;
    tokio::task::spawn_blocking(move || {
        let mut fh = std::fs::File::open(&f).map_err(|e| e.to_string())?;
        let size = fh.metadata().map(|m| m.len()).unwrap_or(0);
        let n = len.min(size.saturating_sub(off)) as usize;
        let mut buf = vec![0u8; n];
        fh.seek(SeekFrom::Start(off)).map_err(|e| e.to_string())?;
        fh.read_exact(&mut buf).map_err(|e| e.to_string())?;
        Ok(json!({ "data": B64.encode(&buf), "size": size }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn nat_extras_unzip<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let f = file_of(&app, &s(&a, "id"));
    tokio::task::spawn_blocking(move || {
        let out = if f.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false) {
            f.with_extension("")
        } else {
            let mut s = f.as_os_str().to_owned();
            s.push("_files");
            PathBuf::from(s)
        };
        let file = std::fs::File::open(&f).map_err(|e| e.to_string())?;
        let mut z = zip::ZipArchive::new(file).map_err(|e| format!("unzip failed: {e}"))?;
        for i in 0..z.len() {
            let mut e = z.by_index(i).map_err(|e| e.to_string())?;
            // enclosed_name() rejects absolute paths and ../ (zip-slip)
            let Some(rel) = e.enclosed_name() else { return Err(format!("unsafe path in zip: {}", e.name())) };
            let t = out.join(rel);
            if e.is_dir() {
                std::fs::create_dir_all(&t).map_err(|e| e.to_string())?;
                continue;
            }
            if let Some(p) = t.parent() {
                std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut w = std::fs::File::create(&t).map_err(|e| e.to_string())?;
            std::io::copy(&mut e, &mut w).map_err(|e| e.to_string())?;
        }
        Ok(json!({ "dir": out }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ================================================================ extras: installs */

fn winget_exe() -> Option<PathBuf> {
    // App Execution Alias for the App Installer package
    if let Ok(la) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(la).join("Microsoft\\WindowsApps\\winget.exe");
        if p.exists() {
            return Some(p);
        }
    }
    let ok = hidden(Command::new("winget").arg("--version").stdout(Stdio::null()).stderr(Stdio::null())).status().map(|s| s.success()).unwrap_or(false);
    if ok { Some(PathBuf::from("winget")) } else { None }
}

/// {id: version | null}. Uses `winget list --id X -e`; null when winget is missing or unsure.
#[tauri::command]
pub async fn nat_is_installed(a: Value) -> Res {
    let ids: Vec<String> = a.get("ids").and_then(|v| v.as_array()).map(|v| v.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let exe = winget_exe();
    let mut map = Map::new();
    for id in ids {
        let mut val = Value::Null;
        if let Some(exe) = &exe {
            let id2 = id.clone();
            let exe2 = exe.clone();
            let out = tokio::task::spawn_blocking(move || {
                hidden(Command::new(&exe2).args(["list", "--id", &id2, "-e", "--accept-source-agreements", "--disable-interactivity"])).output()
            })
            .await
            .ok()
            .and_then(|r| r.ok());
            if let Some(o) = out {
                if o.status.success() {
                    let text = String::from_utf8_lossy(&o.stdout);
                    // table row: Name  Id  Version  [Available]  Source
                    let ver = text
                        .lines()
                        .find(|l| l.split_whitespace().any(|w| w.eq_ignore_ascii_case(&id)))
                        .and_then(|l| {
                            let w: Vec<&str> = l.split_whitespace().collect();
                            let i = w.iter().position(|x| x.eq_ignore_ascii_case(&id))?;
                            w.get(i + 1).map(|v| v.to_string())
                        });
                    val = Value::String(ver.unwrap_or_else(|| "installed".into()));
                }
            }
        }
        map.insert(id, val);
    }
    Ok(json!({ "map": map }))
}

#[tauri::command]
pub async fn nat_launch(a: Value) -> Res {
    shell_open(&s(&a, "pkg"))?;
    Ok(ok())
}

/// Silent winget install; output lines stream as extras:progress {id, line, state:"installing"}.
#[tauri::command]
pub async fn nat_winget<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let id = s(&a, "id");
    let exe = winget_exe().ok_or("winget is not available on this PC")?;
    let mut child = tokio::process::Command::new(exe);
    child
        .args(["install", "--id", &id, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    child.creation_flags(CREATE_NO_WINDOW);
    let mut ch = child.spawn().map_err(|e| e.to_string())?;
    let out = ch.stdout.take();
    let mut last_line = String::new();
    if let Some(out) = out {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(out).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            // winget draws progress bars with \r; keep the last frame of each line
            let l = l.rsplit('\r').next().unwrap_or("").trim().to_string();
            if !l.is_empty() {
                let _ = app.emit("extras:progress", json!({ "id": id, "line": l, "state": "installing" }));
                last_line = l;
            }
        }
    }
    let st = ch.wait().await.map_err(|e| e.to_string())?;
    let code = st.code().unwrap_or(-1);
    // 0 = installed; -1978335189 (0x8A15002B) = already installed / no upgrade available
    let okk = code == 0 || code == -1978335189;
    let _ = app.emit("extras:progress", json!({ "id": id, "state": if okk { "done" } else { "error" }, "code": code }));
    let mut r = json!({ "ok": okk, "code": code });
    if !okk {
        r["err"] = Value::String(if last_line.is_empty() { format!("winget exited with {code}") } else { last_line });
    }
    Ok(r)
}

#[tauri::command]
pub async fn nat_spawn(st: State<'_, NatState>, a: Value) -> Res {
    let path = s(&a, "path");
    let args: Vec<String> = a.get("args").and_then(|v| v.as_array()).map(|v| v.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let mut cmd = Command::new(&path);
    cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(p) = Path::new(&path).parent() {
        cmd.current_dir(p);
    }
    let child = hidden(&mut cmd).spawn().map_err(|e| format!("could not start {path}: {e}"))?;
    let pid = child.id();
    crate::server::adopt(&child); // dies with T.U.R.D. (job object)
    st.children.lock().unwrap().insert(pid, child);
    Ok(json!({ "pid": pid }))
}

#[tauri::command]
pub async fn nat_kill(st: State<'_, NatState>, a: Value) -> Res {
    let pid = a.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if let Some(mut c) = st.children.lock().unwrap().remove(&pid) {
        let _ = c.kill();
        let _ = c.wait();
        return Ok(ok());
    }
    Err(format!("no process {pid} started by T.U.R.D."))
}

/* ================================================================ network */

#[tauri::command]
pub async fn nat_net_info(a: Value) -> Res {
    let _ = a;
    let ip = {
        let s = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        s.connect("192.168.0.1:9").or_else(|_| s.connect("10.0.0.1:9")).ok();
        s.local_addr().ok().map(|a| a.ip().to_string())
    };
    let addrs: Vec<Value> = ip.into_iter().filter(|i| i != "0.0.0.0").map(|ip| json!({ "ip": ip, "prefix": 24 })).collect();
    Ok(json!({ "wifi": !addrs.is_empty(), "addrs": addrs, "mac": crate::server::host_mac() }))
}

/// Wake-on-LAN magic packet (6x 0xFF + 16x MAC), UDP broadcast on ports 9 and 7.
#[tauri::command]
pub async fn nat_wake_on_lan(a: Value) -> Res {
    let hex: String = s(&a, "mac").chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 12 {
        return Err("MAC address should look like AA:BB:CC:DD:EE:FF".into());
    }
    let mac: Vec<u8> = (0..6).map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0)).collect();
    let mut pkt = vec![0xFFu8; 6];
    for _ in 0..16 {
        pkt.extend_from_slice(&mac);
    }
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    sock.set_broadcast(true).map_err(|e| e.to_string())?;
    let mut targets = vec!["255.255.255.255".to_string()];
    let b = s(&a, "broadcast");
    if !b.is_empty() {
        targets.push(b);
    }
    let mut sent = 0;
    for _ in 0..3 {
        for t in &targets {
            for port in [9u16, 7] {
                if sock.send_to(&pkt, (t.as_str(), port)).is_ok() {
                    sent += 1;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    if sent == 0 {
        return Err("no network to send on".into());
    }
    Ok(json!({ "ok": true, "sent": sent }))
}

/// Bounded TCP port scan of one host on the local network, for the Spy tools recon view.
/// Defaults to common service ports; `ports` overrides. Connect scan only, short timeout,
/// small concurrency so it stays light on a low-end PC. Returns the open ports with a guessed
/// service name. Meant for your own network.
#[tauri::command]
pub async fn nat_port_scan(a: Value) -> Res {
    let host = s(&a, "host");
    if host.is_empty() {
        return Err("no host to scan".into());
    }
    let ip: std::net::IpAddr = host.parse().map_err(|_| "host must be an IP address on your network".to_string())?;
    let ports: Vec<u16> = a
        .get("ports")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_u64()).filter(|p| *p >= 1 && *p <= 65535).map(|p| p as u16).collect())
        .filter(|v: &Vec<u16>| !v.is_empty())
        .unwrap_or_else(|| COMMON_PORTS.iter().map(|(p, _)| *p).collect());
    let timeout = Duration::from_millis(a.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(500).clamp(100, 2000));

    let open = tokio::task::spawn_blocking(move || {
        use std::sync::atomic::AtomicUsize;
        let next = Arc::new(AtomicUsize::new(0));
        let ports = Arc::new(ports);
        let found = Arc::new(Mutex::new(Vec::<u16>::new()));
        let mut handles = Vec::new();
        for _ in 0..16 {
            let (next, ports, found) = (next.clone(), ports.clone(), found.clone());
            handles.push(std::thread::spawn(move || loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(port) = ports.get(i).copied() else { break };
                if std::net::TcpStream::connect_timeout(&std::net::SocketAddr::new(ip, port), timeout).is_ok() {
                    found.lock().unwrap().push(port);
                }
            }));
        }
        for h in handles {
            let _ = h.join();
        }
        let mut v = Arc::try_unwrap(found).unwrap().into_inner().unwrap();
        v.sort_unstable();
        v
    })
    .await
    .map_err(|e| e.to_string())?;

    let items: Vec<Value> = open
        .into_iter()
        .map(|p| json!({ "port": p, "service": service_name(p) }))
        .collect();
    Ok(json!({ "host": host, "items": items }))
}

const COMMON_PORTS: &[(u16, &str)] = &[
    (21, "ftp"), (22, "ssh"), (23, "telnet"), (25, "smtp"), (53, "dns"), (80, "http"),
    (110, "pop3"), (111, "rpc"), (135, "msrpc"), (139, "netbios"), (143, "imap"), (443, "https"),
    (445, "smb"), (515, "printer"), (548, "afp"), (554, "rtsp"), (631, "ipp"), (993, "imaps"),
    (995, "pop3s"), (1883, "mqtt"), (1900, "ssdp"), (3000, "http-alt"), (3306, "mysql"),
    (3389, "rdp"), (5000, "upnp"), (5353, "mdns"), (5432, "postgres"), (5900, "vnc"),
    (6379, "redis"), (7000, "http-alt"), (8000, "http-alt"), (8009, "ajp"), (8080, "http-proxy"),
    (8443, "https-alt"), (8787, "turd"), (8883, "mqtts"), (9000, "http-alt"), (32400, "plex"),
];

fn service_name(port: u16) -> &'static str {
    COMMON_PORTS.iter().find(|(p, _)| *p == port).map(|(_, n)| *n).unwrap_or("")
}
