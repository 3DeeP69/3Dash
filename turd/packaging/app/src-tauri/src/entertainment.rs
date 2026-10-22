//! T.U.R.D. Entertainment — native in-app web views for Windows (Tauri v2 + WebView2).
//!
//! Each app (YouTube, TikTok, …) gets its own child webview laid exactly over the
//! Entertainment viewer area of the main window, so real sites run inside T.U.R.D.
//! with no X-Frame-Options limits, logged in, full speed.
//!
//! * Network shield: every request goes through WebView2's WebResourceRequested
//!   hook; anything on the block list is answered with an empty 204 locally.
//! * Page shield: the document-start script from `web/src/sections/ent/shield.js`
//!   is injected into every page (ad payload stripping, clean mode, same-view links).
//! * No splash / white flash: views are dark from the first frame and are only
//!   revealed once the page has painted. Warm views load hidden in the background.
//! * Links never leave: `window.open` / target=_blank load in the same view and
//!   app-store / app-scheme redirects are refused.
//! * Fullscreen video takes over the whole window and hands it back on exit.
//!
//! Wire-up (src-tauri/src/lib.rs):
//! ```ignore
//! mod entertainment;
//! tauri::Builder::default()
//!     .manage(entertainment::EntState::default())
//!     .invoke_handler(tauri::generate_handler![
//!         entertainment::ent_open, entertainment::ent_bounds, entertainment::ent_show,
//!         entertainment::ent_hide, entertainment::ent_hide_all, entertainment::ent_nav,
//!         entertainment::ent_close, entertainment::ent_state, entertainment::ent_rules,
//!     ])
//! ```
//! Cargo: `tauri = { version = "2", features = ["unstable"] }` (child webviews), and on
//! Windows `webview2-com = "0.39"` + `windows = "0.62"` (same versions wry uses).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, State, Url, Webview, WebviewUrl,
    Window,
};

/* ------------------------------------------------------------------ rules */

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct Rules {
    #[serde(default)]
    pub hosts: Vec<String>,
    #[serde(default)]
    pub paths: Vec<String>,
}

impl Rules {
    /// Same matcher as `isBlocked()` in shield.js: host suffix, or host+path substring
    /// (`*` in a path rule means "and also contains").
    pub fn blocks(&self, uri: &str) -> bool {
        let Ok(u) = Url::parse(uri) else { return false };
        if !matches!(u.scheme(), "http" | "https" | "ws" | "wss") {
            return false;
        }
        let host = u.host_str().unwrap_or("").to_ascii_lowercase();
        if self.hosts.iter().any(|d| {
            host == *d || (host.len() > d.len() && host.ends_with(d.as_str()) && host.as_bytes()[host.len() - d.len() - 1] == b'.')
        }) {
            return true;
        }
        let hp = format!("{}{}{}", host, u.path(), u.query().map(|q| format!("?{q}")).unwrap_or_default());
        self.paths.iter().any(|p| {
            if p.contains('*') {
                p.split('*').all(|part| hp.contains(part))
            } else {
                hp.contains(p.as_str())
            }
        })
    }
}

/* ------------------------------------------------------------------ state */

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

struct View {
    label: String,
    home: String,
    url: String,
    title: String,
    loading: bool,
    painted: bool,
    want_visible: bool,
    bounds: Rect,
    blocked: Arc<AtomicU64>,
    fullscreen: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct EntState {
    views: Mutex<HashMap<String, View>>,
    rules: Arc<RwLock<Rules>>,
}

#[derive(Serialize)]
pub struct ViewState {
    url: String,
    title: String,
    loading: bool,
    blocked: u64,
    visible: bool,
}

#[derive(Serialize)]
pub struct AllState {
    views: HashMap<String, ViewState>,
}

#[derive(Deserialize)]
pub struct OpenReq {
    id: String,
    url: String,
    #[serde(default)]
    script: String,
    #[serde(default)]
    visible: bool,
    #[serde(default = "yes")]
    shield: bool,
    #[serde(default)]
    rules: Option<Rules>,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
fn yes() -> bool {
    true
}

const PAUSE_MEDIA: &str =
    "try{document.querySelectorAll('video,audio').forEach(function(m){try{m.pause()}catch(e){}})}catch(e){}";

fn label_for(id: &str) -> String {
    let clean: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    format!("ent-{clean}")
}

fn place<R: Runtime>(wv: &Webview<R>, r: Rect) {
    let _ = wv.set_position(LogicalPosition::new(r.x, r.y));
    let _ = wv.set_size(LogicalSize::new(r.w.max(1.0), r.h.max(1.0)));
}

/// Pages may only go to the web. App-store and app-scheme hops ("open in the TikTok app")
/// are refused so everything stays inside T.U.R.D.
fn allowed_nav(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data")
}

/// Sign-in pages ("Log in with Google" etc.) that talk back to the page that opened them.
fn is_auth(url: &Url) -> bool {
    let h = url.host_str().unwrap_or("").to_ascii_lowercase();
    let p = url.path();
    matches!(h.as_str(), "accounts.google.com" | "appleid.apple.com" | "login.live.com" | "login.microsoftonline.com" | "id.twitch.tv" | "accounts.snapchat.com")
        || (h.ends_with("facebook.com") && (p.contains("/dialog/oauth") || p.starts_with("/login")))
        || (matches!(h.as_str(), "twitter.com" | "x.com" | "api.twitter.com") && p.contains("oauth"))
        || (h == "discord.com" && p.starts_with("/oauth2"))
}

/* ------------------------------------------------------------------ commands */

#[tauri::command]
pub async fn ent_open<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    state: State<'_, EntState>,
    req: OpenReq,
) -> Result<(), String> {
    let target: Url = req.url.parse().map_err(|e| format!("bad url: {e}"))?;
    if !matches!(target.scheme(), "http" | "https") {
        return Err("only http(s) sites can be opened".into());
    }
    if let Some(r) = req.rules.clone() {
        *state.rules.write().unwrap() = r;
    }
    let bounds = Rect { x: req.x, y: req.y, w: req.w, h: req.h };
    let label = label_for(&req.id);

    // Already open: just go there.
    if let Some(wv) = app.get_webview(&label) {
        {
            let mut views = state.views.lock().unwrap();
            if let Some(v) = views.get_mut(&req.id) {
                v.want_visible = req.visible;
                v.bounds = bounds;
            }
        }
        if req.url != current_url(&state, &req.id) {
            wv.navigate(target).map_err(|e| e.to_string())?;
        }
        if req.visible {
            place(&wv, bounds);
            let _ = wv.show();
        }
        return Ok(());
    }

    let blocked = Arc::new(AtomicU64::new(0));
    let fullscreen = Arc::new(AtomicBool::new(false));
    state.views.lock().unwrap().insert(
        req.id.clone(),
        View {
            label: label.clone(),
            home: req.url.clone(),
            url: req.url.clone(),
            title: String::new(),
            loading: true,
            painted: false,
            want_visible: req.visible,
            bounds,
            blocked: blocked.clone(),
            fullscreen: fullscreen.clone(),
        },
    );

    let id_nav = req.id.clone();
    let id_load = req.id.clone();
    let id_title = req.id.clone();
    let app_nw = app.clone();
    let label_nw = label.clone();

    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
        .background_color(tauri::webview::Color(5, 7, 13, 255))
        .on_navigation(move |url| {
            let ok = allowed_nav(url);
            if !ok {
                eprintln!("[ent:{id_nav}] refused app hop to {url}");
            }
            ok
        })
        // window.open / target=_blank → same view, never a popup window. Sign-in pages are the
        // exception: they must stay a real pop-up so they can report back to the page.
        .on_new_window(move |url, _features| {
            if is_auth(&url) {
                return NewWindowResponse::Allow;
            }
            if url.scheme() == "http" || url.scheme() == "https" {
                let app = app_nw.clone();
                let label = label_nw.clone();
                std::thread::spawn(move || {
                    if let Some(wv) = app.get_webview(&label) {
                        let _ = wv.navigate(url);
                    }
                });
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed(move |wv, title| {
            let st = wv.app_handle().state::<EntState>();
            if let Some(v) = st.views.lock().unwrap().get_mut(&id_title) {
                v.title = title;
            };
        })
        .on_page_load(move |wv, payload| {
            let st = wv.app_handle().state::<EntState>();
            let mut reveal = None;
            if let Some(v) = st.views.lock().unwrap().get_mut(&id_load) {
                v.url = payload.url().to_string();
                match payload.event() {
                    PageLoadEvent::Started => v.loading = true,
                    PageLoadEvent::Finished => {
                        v.loading = false;
                        if !v.painted {
                            v.painted = true;
                            if v.want_visible {
                                reveal = Some(v.bounds);
                            }
                        }
                    }
                }
            }
            if let Some(b) = reveal {
                place(&wv, b);
                let _ = wv.show();
            }
        });
    if req.shield && !req.script.is_empty() {
        builder = builder.initialization_script(&req.script);
    }

    // Created hidden; revealed on first paint (or by the safety timer below).
    let wv = window
        .add_child(builder, LogicalPosition::new(bounds.x, bounds.y), LogicalSize::new(bounds.w.max(1.0), bounds.h.max(1.0)))
        .map_err(|e| e.to_string())?;
    let _ = wv.hide();

    #[cfg(windows)]
    if req.shield {
        win::install(&wv, state.rules.clone(), blocked, fullscreen, window.clone(), req.id.clone());
    }
    #[cfg(not(windows))]
    let _ = (blocked, fullscreen);

    // A slow page still appears after 2.5 s instead of leaving a blank viewer.
    let app2 = app.clone();
    let id2 = req.id.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2500));
        let st = app2.state::<EntState>();
        let mut reveal = None;
        if let Some(v) = st.views.lock().unwrap().get_mut(&id2) {
            if !v.painted {
                v.painted = true;
                if v.want_visible {
                    reveal = Some((v.label.clone(), v.bounds));
                }
            }
        }
        if let Some((label, b)) = reveal {
            if let Some(wv) = app2.get_webview(&label) {
                place(&wv, b);
                let _ = wv.show();
            }
        }
    });
    Ok(())
}

fn current_url(state: &EntState, id: &str) -> String {
    state.views.lock().unwrap().get(id).map(|v| v.url.clone()).unwrap_or_default()
}

fn with_view<R: Runtime>(app: &AppHandle<R>, state: &EntState, id: &str) -> Option<Webview<R>> {
    let label = state.views.lock().unwrap().get(id).map(|v| v.label.clone())?;
    app.get_webview(&label)
}

#[tauri::command]
pub fn ent_bounds<R: Runtime>(app: AppHandle<R>, state: State<'_, EntState>, id: String, x: f64, y: f64, w: f64, h: f64) {
    let r = Rect { x, y, w, h };
    let fs = {
        let mut views = state.views.lock().unwrap();
        match views.get_mut(&id) {
            Some(v) => {
                v.bounds = r;
                v.fullscreen.load(Ordering::Relaxed)
            }
            None => return,
        }
    };
    if !fs {
        if let Some(wv) = with_view(&app, &state, &id) {
            place(&wv, r);
        }
    }
}

#[tauri::command]
pub fn ent_show<R: Runtime>(app: AppHandle<R>, state: State<'_, EntState>, id: String, x: f64, y: f64, w: f64, h: f64) {
    let r = Rect { x, y, w, h };
    let painted = {
        let mut views = state.views.lock().unwrap();
        let Some(v) = views.get_mut(&id) else { return };
        v.want_visible = true;
        v.bounds = r;
        v.painted
    };
    // hide every other app first: one visible view at a time
    let others: Vec<String> = state.views.lock().unwrap().iter().filter(|(k, _)| **k != id).map(|(_, v)| v.label.clone()).collect();
    for l in others {
        if let Some(o) = app.get_webview(&l) {
            let _ = o.hide();
        }
    }
    if let Some(wv) = with_view(&app, &state, &id) {
        place(&wv, r);
        if painted {
            let _ = wv.show();
            let _ = wv.set_focus();
        }
    }
}

fn hide_one<R: Runtime>(app: &AppHandle<R>, state: &EntState, id: &str) {
    if let Some(v) = state.views.lock().unwrap().get_mut(id) {
        v.want_visible = false;
    }
    if let Some(wv) = with_view(app, state, id) {
        let _ = wv.eval(PAUSE_MEDIA);
        let _ = wv.hide();
    }
}

#[tauri::command]
pub fn ent_hide<R: Runtime>(app: AppHandle<R>, state: State<'_, EntState>, id: String) {
    hide_one(&app, &state, &id);
}

#[tauri::command]
pub fn ent_hide_all<R: Runtime>(app: AppHandle<R>, state: State<'_, EntState>) {
    let ids: Vec<String> = state.views.lock().unwrap().keys().cloned().collect();
    for id in ids {
        hide_one(&app, &state, &id);
    }
}

#[tauri::command]
pub fn ent_nav<R: Runtime>(app: AppHandle<R>, state: State<'_, EntState>, id: String, action: String, url: Option<String>) -> Result<(), String> {
    let wv = with_view(&app, &state, &id).ok_or("no such view")?;
    match action.as_str() {
        "back" => wv.eval("history.back()").map_err(|e| e.to_string()),
        "forward" => wv.eval("history.forward()").map_err(|e| e.to_string()),
        "reload" => wv.reload().map_err(|e| e.to_string()),
        "home" | "go" => {
            let dest = if action == "home" {
                state.views.lock().unwrap().get(&id).map(|v| v.home.clone()).unwrap_or_default()
            } else {
                url.unwrap_or_default()
            };
            let u: Url = dest.parse().map_err(|e| format!("bad url: {e}"))?;
            wv.navigate(u).map_err(|e| e.to_string())
        }
        _ => Err("unknown action".into()),
    }
}

#[tauri::command]
pub fn ent_close<R: Runtime>(app: AppHandle<R>, state: State<'_, EntState>, id: String) {
    if let Some(wv) = with_view(&app, &state, &id) {
        let _ = wv.close();
    }
    state.views.lock().unwrap().remove(&id);
}

#[tauri::command]
pub fn ent_state(state: State<'_, EntState>) -> AllState {
    let views = state.views.lock().unwrap();
    AllState {
        views: views
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    ViewState {
                        url: v.url.clone(),
                        title: v.title.clone(),
                        loading: v.loading,
                        blocked: v.blocked.load(Ordering::Relaxed),
                        visible: v.want_visible,
                    },
                )
            })
            .collect(),
    }
}

#[tauri::command]
pub fn ent_rules(state: State<'_, EntState>, rules: Rules) {
    *state.rules.write().unwrap() = rules;
}

/* ------------------------------------------------------------------ Windows: WebView2 hooks */

#[cfg(windows)]
mod win {
    use super::*;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{take_pwstr, ContainsFullScreenElementChangedEventHandler, WebResourceRequestedEventHandler};
    use windows::core::{Interface, HSTRING, PWSTR};
    use windows::core::BOOL;

    pub fn install<R: Runtime>(
        wv: &Webview<R>,
        rules: Arc<RwLock<Rules>>,
        blocked: Arc<AtomicU64>,
        fullscreen: Arc<AtomicBool>,
        window: Window<R>,
        id: String,
    ) {
        let app = wv.app_handle().clone();
        let _ = wv.with_webview(move |pw| unsafe {
            let Ok(core) = pw.controller().CoreWebView2() else { return };
            let env = pw.environment();

            // 1) network shield — every request, every frame, workers included
            let filter = HSTRING::from("*");
            match core.cast::<ICoreWebView2_22>() {
                Ok(c22) => {
                    let _ = c22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                        &filter,
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                    );
                }
                Err(_) => {
                    let _ = core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
                }
            }
            let mut token = 0i64;
            let _ = core.add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let uri = {
                        let mut p = PWSTR::null();
                        args.Request()?.Uri(&mut p)?;
                        take_pwstr(p)
                    };
                    if rules.read().map(|r| r.blocks(&uri)).unwrap_or(false) {
                        blocked.fetch_add(1, Ordering::Relaxed);
                        let resp = env.CreateWebResourceResponse(
                            None,
                            204,
                            &HSTRING::from("No Content"),
                            &HSTRING::from("Access-Control-Allow-Origin: *"),
                        )?;
                        args.SetResponse(&resp)?;
                    }
                    Ok(())
                })),
                &mut token,
            );

            // 2) fullscreen video takes the whole window
            let mut token2 = 0i64;
            let _ = core.add_ContainsFullScreenElementChanged(
                &ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                    let Some(sender) = sender else { return Ok(()) };
                    let mut on = BOOL(0);
                    sender.ContainsFullScreenElement(&mut on)?;
                    let on = on.as_bool();
                    fullscreen.store(on, Ordering::Relaxed);
                    let (app, window, id) = (app.clone(), window.clone(), id.clone());
                    std::thread::spawn(move || {
                        let st = app.state::<EntState>();
                        let (label, bounds) = match st.views.lock().unwrap().get(&id) {
                            Some(v) => (v.label.clone(), v.bounds),
                            None => return,
                        };
                        let Some(wv) = app.get_webview(&label) else { return };
                        let _ = window.set_fullscreen(on);
                        if on {
                            std::thread::sleep(std::time::Duration::from_millis(120));
                            if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                                let s = size.to_logical::<f64>(scale);
                                place(&wv, Rect { x: 0.0, y: 0.0, w: s.width, h: s.height });
                            }
                        } else {
                            place(&wv, bounds);
                        }
                    });
                    Ok(())
                })),
                &mut token2,
            );
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matcher() {
        let r = Rules {
            hosts: vec!["doubleclick.net".into(), "ads.tiktok.com".into()],
            paths: vec!["youtube.com/pagead/".into(), "googlevideo.com/initplayback?*&oad".into()],
        };
        assert!(r.blocks("https://ad.doubleclick.net/x"));
        assert!(r.blocks("https://doubleclick.net/"));
        assert!(!r.blocks("https://notdoubleclick.net/"));
        assert!(r.blocks("https://www.youtube.com/pagead/viewthroughconversion/1"));
        assert!(!r.blocks("https://www.youtube.com/watch?v=abc"));
        assert!(r.blocks("https://rr1.googlevideo.com/initplayback?source=youtube&oad=1"));
        assert!(!r.blocks("https://www.tiktok.com/foryou"));
        assert!(r.blocks("https://ads.tiktok.com/i18n/pixel"));
        assert!(!r.blocks("intent://foo"));
    }
}
