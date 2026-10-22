//! Hosts the T.U.R.D. chat + assistant server on this PC.
//!
//! The server (turd/server: server.js + assistant.js, zero runtime deps besides the
//! bundled Anthropic SDK) ships as a single-file Node executable next to TURD.exe
//! (`turd-server.exe`, built by scripts/build-server-sea.mjs). It starts with the app
//! (setting: autostart, default on), keeps its data in %APPDATA%\app.turd.hud\server,
//! serves the web app on the LAN so phones can open it in a browser too, and is tied
//! to T.U.R.D. with a job object so it can never be left running as an orphan.

use std::io::{BufRead, BufReader};
use std::net::{TcpStream, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Wry};

use crate::native::{hidden, Res};

const DEFAULT_PORT: u16 = 8787;

#[derive(Default)]
pub struct ServerState {
    child: Mutex<Option<Child>>,
    port: Mutex<u16>,
    last_error: Mutex<String>,
    tray: Mutex<Option<MenuItem<Wry>>>,
}

/* ---------------------------------------------------------------- settings */

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let d = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&d);
    d.join("settings.json")
}

fn settings<R: Runtime>(app: &AppHandle<R>) -> Value {
    std::fs::read_to_string(settings_path(app)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}))
}

fn save_settings<R: Runtime>(app: &AppHandle<R>, v: &Value) {
    let _ = std::fs::write(settings_path(app), serde_json::to_vec_pretty(v).unwrap_or_default());
}

fn autostart<R: Runtime>(app: &AppHandle<R>) -> bool {
    settings(app).get("serverAutostart").and_then(|v| v.as_bool()).unwrap_or(true)
}

fn conf_port<R: Runtime>(app: &AppHandle<R>) -> u16 {
    settings(app).get("serverPort").and_then(|v| v.as_u64()).map(|p| p as u16).unwrap_or(DEFAULT_PORT)
}

/* ---------------------------------------------------------------- job object */

#[cfg(windows)]
fn job() -> Option<windows::Win32::Foundation::HANDLE> {
    use std::sync::OnceLock;
    use windows::Win32::System::JobObjects::*;
    static JOB: OnceLock<usize> = OnceLock::new();
    let h = *JOB.get_or_init(|| unsafe {
        let Ok(h) = CreateJobObjectW(None, None) else { return 0 };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let _ = SetInformationJobObject(
            h,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        h.0 as usize
    });
    if h == 0 { None } else { Some(windows::Win32::Foundation::HANDLE(h as *mut _)) }
}

/// Ties a child process to T.U.R.D.: when the app exits (or crashes) Windows ends it.
pub(crate) fn adopt(child: &Child) {
    #[cfg(windows)]
    unsafe {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::System::JobObjects::AssignProcessToJobObject;
        if let Some(j) = job() {
            let _ = AssignProcessToJobObject(j, windows::Win32::Foundation::HANDLE(child.as_raw_handle() as *mut _));
        }
    }
    #[cfg(not(windows))]
    let _ = child;
}

/* ---------------------------------------------------------------- lifecycle */

fn exe_path() -> PathBuf {
    let dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())).unwrap_or_default();
    dir.join(if cfg!(windows) { "turd-server.exe" } else { "turd-server" })
}

fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(400)).is_ok()
}

fn lan_ip() -> Option<String> {
    // no packets are sent: connecting a UDP socket only picks the outbound interface
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.0.1:9").or_else(|_| s.connect("10.0.0.1:9")).ok()?;
    let ip = s.local_addr().ok()?.ip();
    if ip.is_unspecified() || ip.is_loopback() { None } else { Some(ip.to_string()) }
}

/// MAC address of the adapter that carries the LAN address, for Wake-on-LAN from the phone.
pub(crate) fn host_mac() -> Option<String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::NetworkManagement::IpHelper::{GetAdaptersAddresses, GAA_FLAG_SKIP_DNS_SERVER, IP_ADAPTER_ADDRESSES_LH};
        use windows::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};
        let want: std::net::Ipv4Addr = lan_ip()?.parse().ok()?;
        let mut len: u32 = 32 * 1024;
        let mut buf = vec![0u8; len as usize];
        let mut r = GetAdaptersAddresses(AF_INET.0 as u32, GAA_FLAG_SKIP_DNS_SERVER, None, Some(buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH), &mut len);
        if r == 111 {
            // ERROR_BUFFER_OVERFLOW
            buf = vec![0u8; len as usize];
            r = GetAdaptersAddresses(AF_INET.0 as u32, GAA_FLAG_SKIP_DNS_SERVER, None, Some(buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH), &mut len);
        }
        if r != 0 {
            return None;
        }
        let mut a = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while !a.is_null() {
            let mut u = (*a).FirstUnicastAddress;
            while !u.is_null() {
                let sa = (*u).Address.lpSockaddr;
                if !sa.is_null() && (*sa).sa_family == AF_INET {
                    let sin = &*(sa as *const SOCKADDR_IN);
                    let ip = std::net::Ipv4Addr::from(u32::from_be(sin.sin_addr.S_un.S_addr));
                    let n = (*a).PhysicalAddressLength as usize;
                    if ip == want && n == 6 {
                        let m: [u8; 8] = (*a).PhysicalAddress;
                        let m = &m[..6];
                        return Some(m.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":"));
                    }
                }
                u = (*u).Next;
            }
            a = (*a).Next;
        }
        None
    }
    #[cfg(not(windows))]
    None
}

fn start<R: Runtime>(app: &AppHandle<R>, port: u16) -> Result<(), String> {
    let st = app.state::<ServerState>();
    let running_port = *st.port.lock().unwrap();
    if is_running(app) {
        if running_port == port {
            return Ok(()); // already ours, already on this port
        }
        stop(app); // moving to another port
        for _ in 0..20 {
            if !port_open(running_port) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    *st.port.lock().unwrap() = port;
    if port_open(port) {
        // something already serves this port (e.g. the turd-desktop server): use it
        *st.last_error.lock().unwrap() = String::new();
        update_tray(app);
        return Ok(());
    }
    let exe = exe_path();
    if !exe.exists() {
        let e = format!("chat server not bundled ({} missing)", exe.display());
        *st.last_error.lock().unwrap() = e.clone();
        return Err(e);
    }
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?.join("server");
    let _ = std::fs::create_dir_all(&data);
    let web = app.path().resource_dir().map(|d| d.join("web")).unwrap_or_default();
    let mut cmd = Command::new(&exe);
    // the phone learns these from /api/health so its "Wake PC" button knows what to wake
    cmd.env("TURD_HOST_MAC", host_mac().unwrap_or_default())
        .env("TURD_HOST_NAME", std::env::var("COMPUTERNAME").unwrap_or_default());
    cmd.env("PORT", port.to_string())
        .env("DATA_DIR", &data)
        .env("STATIC_DIR", if web.join("index.html").exists() { web.to_string_lossy().to_string() } else { String::new() })
        .current_dir(&data)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = hidden(&mut cmd).spawn().map_err(|e| format!("could not start chat server: {e}"))?;
    adopt(&child);
    for pipe in [child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>)]
        .into_iter()
        .flatten()
    {
        let app2 = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app2.emit("server:log", json!({ "line": line }));
                if line.contains("EADDRINUSE") {
                    *app2.state::<ServerState>().last_error.lock().unwrap() = format!("port {port} is already in use");
                }
            }
        });
    }
    *st.child.lock().unwrap() = Some(child);
    *st.last_error.lock().unwrap() = String::new();
    // ready within a second or two; the tray line updates once it answers
    let app2 = app.clone();
    std::thread::spawn(move || {
        for _ in 0..40 {
            if port_open(port) {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        update_tray(&app2);
        if let Err(e) = ensure_firewall(&app2, false) {
            *app2.state::<ServerState>().last_error.lock().unwrap() = e;
        }
    });
    Ok(())
}

/* ---------------------------------------------------------------- firewall */
// Bossman approved (2026-10-21): one admin prompt adds an inbound allow rule for the bundled
// chat server only, limited to devices on the local network (remoteip=localsubnet), so the
// Fold4 can reach chat. Asked once; "Allow phone access" in the app can ask again.

const FW_RULE: &str = "T.U.R.D. chat server";

fn firewall_ok() -> bool {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("netsh");
        cmd.args(["advfirewall", "firewall", "show", "rule", &format!("name={FW_RULE}")]).stdout(Stdio::piped()).stderr(Stdio::null());
        return hidden(&mut cmd).output().map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).contains(FW_RULE)).unwrap_or(false);
    }
    #[cfg(not(windows))]
    true
}

/// Shows the UAC prompt and waits for netsh to finish. Ok(true) = rule now present.
fn add_firewall_rule() -> Result<bool, String> {
    #[cfg(windows)]
    unsafe {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{WaitForSingleObject, INFINITE};
        use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
        use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
        let exe = exe_path();
        let args = format!(
            "advfirewall firewall add rule name=\"{FW_RULE}\" dir=in action=allow enable=yes profile=any protocol=TCP remoteip=localsubnet program=\"{}\"",
            exe.display()
        );
        let verb = HSTRING::from("runas");
        let file = HSTRING::from("netsh.exe");
        let params = HSTRING::from(args);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: PCWSTR(verb.as_ptr()),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        ShellExecuteExW(&mut info).map_err(|_| "the Windows admin prompt was cancelled, so phones on your Wi-Fi may not reach chat".to_string())?;
        if !info.hProcess.is_invalid() {
            WaitForSingleObject(info.hProcess, 30_000.min(INFINITE));
            let _ = CloseHandle(info.hProcess);
        }
        return Ok(firewall_ok());
    }
    #[cfg(not(windows))]
    Ok(true)
}

fn ensure_firewall<R: Runtime>(app: &AppHandle<R>, force: bool) -> Result<bool, String> {
    if firewall_ok() {
        return Ok(true);
    }
    let mut s = settings(app);
    if !force && s.get("firewallAsked").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Ok(false);
    }
    s["firewallAsked"] = json!(true);
    save_settings(app, &s);
    add_firewall_rule()
}

fn stop<R: Runtime>(app: &AppHandle<R>) {
    let st = app.state::<ServerState>();
    if let Some(mut c) = st.child.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
    update_tray(app);
}

pub fn boot<R: Runtime>(app: &AppHandle<R>) {
    if autostart(app) {
        let app = app.clone();
        std::thread::spawn(move || {
            let p = conf_port(&app);
            if let Err(e) = start(&app, p) {
                eprintln!("[server] {e}");
            }
            update_tray(&app);
        });
    }
}

pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    stop(app);
}

pub fn is_running<R: Runtime>(app: &AppHandle<R>) -> bool {
    let st = app.state::<ServerState>();
    let ours = st.child.lock().unwrap().as_mut().map(|c| c.try_wait().ok().flatten().is_none()).unwrap_or(false);
    ours
}

fn status_json<R: Runtime>(app: &AppHandle<R>) -> Value {
    let st = app.state::<ServerState>();
    let port = { let p = *st.port.lock().unwrap(); if p == 0 { conf_port(app) } else { p } };
    let ours = is_running(app);
    let up = port_open(port);
    let mut urls = vec![format!("http://127.0.0.1:{port}")];
    if let Some(ip) = lan_ip() {
        urls.push(format!("http://{ip}:{port}"));
    }
    json!({
        "running": up,
        "managed": ours,
        "external": up && !ours,
        "port": port,
        "urls": urls,
        "autostart": autostart(app),
        "bundled": exe_path().exists(),
        "mac": host_mac(),
        "firewall": firewall_ok(),
        "error": st.last_error.lock().unwrap().clone(),
    })
}

pub fn set_tray_item(app: &AppHandle<Wry>, item: MenuItem<Wry>) {
    *app.state::<ServerState>().tray.lock().unwrap() = Some(item);
    update_tray(app);
}

fn update_tray<R: Runtime>(app: &AppHandle<R>) {
    let s = status_json(app);
    let text = if s["running"].as_bool().unwrap_or(false) {
        format!("Chat server: {}", s["urls"].as_array().and_then(|u| u.last()).and_then(|u| u.as_str()).unwrap_or(""))
    } else {
        "Chat server: off".to_string()
    };
    if let Some(item) = app.state::<ServerState>().tray.lock().unwrap().as_ref() {
        let _ = item.set_text(text);
    }
}

/* ---------------------------------------------------------------- commands */

#[tauri::command]
pub async fn nat_server_status<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let _ = a;
    Ok(tokio::task::spawn_blocking(move || status_json(&app)).await.map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn nat_server_start<R: Runtime>(app: AppHandle<R>, _st: State<'_, ServerState>, a: Value) -> Res {
    let port = a.get("port").and_then(|v| v.as_u64()).map(|p| p as u16).unwrap_or_else(|| conf_port(&app));
    if port != conf_port(&app) {
        let mut s = settings(&app);
        s["serverPort"] = json!(port);
        save_settings(&app, &s);
    }
    let app2 = app.clone();
    tokio::task::spawn_blocking(move || start(&app2, port)).await.map_err(|e| e.to_string())??;
    for _ in 0..20 {
        if port_open(port) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Ok(status_json(&app))
}

#[tauri::command]
pub async fn nat_server_stop<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let _ = a;
    stop(&app);
    Ok(status_json(&app))
}

#[tauri::command]
pub async fn nat_server_autostart<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let on = a.get("on").and_then(|v| v.as_bool()).unwrap_or(true);
    let mut s = settings(&app);
    s["serverAutostart"] = json!(on);
    save_settings(&app, &s);
    Ok(status_json(&app))
}

#[tauri::command]
pub async fn nat_server_firewall<R: Runtime>(app: AppHandle<R>, a: Value) -> Res {
    let _ = a;
    let app2 = app.clone();
    let ok = tokio::task::spawn_blocking(move || ensure_firewall(&app2, true)).await.map_err(|e| e.to_string())??;
    let mut s = status_json(&app);
    s["firewall"] = json!(ok);
    Ok(s)
}
