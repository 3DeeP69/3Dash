//! T.U.R.D. for Windows: the Tauri v2 shell around web/ (bundled as dist/).
//!
//! * `entertainment` — native child web views + ad shield (from the Entertainment thread)
//! * `native`        — window.TURD_NATIVE: CORS-free http, Extras downloads/installs, misc
//! * `netwatch`      — who is on the home network (ARP sweep + NetBIOS / reverse-DNS names)
//! * `radar`         — Wi-Fi (WLAN API) and Bluetooth LE (WinRT advertisement watcher) scans
//! * `server`        — hosts the chat/assistant server (bundled Node sidecar) on this PC

mod entertainment;
mod native;
mod netwatch;
mod radar;
mod server;
#[cfg(debug_assertions)]
mod selftest;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(entertainment::EntState::default())
        .manage(native::NatState::default())
        .manage(server::ServerState::default())
        .invoke_handler(tauri::generate_handler![
            entertainment::ent_open,
            entertainment::ent_bounds,
            entertainment::ent_show,
            entertainment::ent_hide,
            entertainment::ent_hide_all,
            entertainment::ent_nav,
            entertainment::ent_close,
            entertainment::ent_state,
            entertainment::ent_rules,
            native::nat_info,
            native::nat_open_external,
            native::nat_http,
            native::nat_fullscreen,
            native::nat_extras_info,
            native::nat_extras_dirs,
            native::nat_extras_pick_dir,
            native::nat_extras_list,
            native::nat_extras_download,
            native::nat_extras_cancel,
            native::nat_extras_remove,
            native::nat_extras_open,
            native::nat_extras_read_text,
            native::nat_extras_read_range,
            native::nat_extras_unzip,
            native::nat_is_installed,
            native::nat_launch,
            native::nat_winget,
            native::nat_spawn,
            native::nat_kill,
            native::nat_net_info,
            native::nat_wake_on_lan,
            native::nat_port_scan,
            netwatch::nat_netwatch_request,
            netwatch::nat_netwatch_scan,
            radar::nat_radar_permissions,
            radar::nat_radar_request,
            radar::nat_wifi_scan,
            radar::nat_ble_scan,
            radar::nat_bt_batteries,
            server::nat_server_status,
            server::nat_server_start,
            server::nat_server_stop,
            server::nat_server_autostart,
            server::nat_server_firewall,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // chat server: on by default so the PC is the home base for the Fold4 and friends
            server::boot(&handle);
            // "Hey T.U.R.D." wake word: the app's own page gets the microphone without a prompt
            #[cfg(windows)]
            grant_app_mic(&handle);
            #[cfg(debug_assertions)]
            if let Ok(base) = std::env::var("TURD_SELFTEST") {
                selftest::spawn(handle.clone(), base);
            }

            let open = MenuItem::with_id(app, "open", "Open T.U.R.D.", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "Chat server: starting…", false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit (stops the chat server)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &status, &PredefinedMenuItem::separator(app)?, &quit])?;
            server::set_tray_item(&handle, status);
            TrayIconBuilder::with_id("turd")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("T.U.R.D.")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => {
                        server::shutdown(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the window while this PC hosts chat keeps the server up in the tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && server::is_running(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building T.U.R.D.")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                server::shutdown(app);
            }
        });
}

fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Auto-allow the microphone for the app's own origin only (offline Vosk wake word in
/// web/src/voice/). Other sites (Entertainment child web views) keep the normal prompt.
#[cfg(windows)]
fn grant_app_mic<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{take_pwstr, PermissionRequestedEventHandler};
    use windows::core::PWSTR;
    let Some(wv) = app.get_webview("main") else { return };
    let _ = wv.with_webview(|pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        let mut token = 0i64;
        let _ = core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let uri = {
                    let mut p = PWSTR::null();
                    args.Uri(&mut p)?;
                    take_pwstr(p)
                };
                let ours = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"].iter().any(|o| uri.starts_with(o));
                if ours && kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            })),
            &mut token,
        );
    });
}
