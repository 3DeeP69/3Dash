//! Radar for Windows: Wi-Fi networks via the native WLAN API and Bluetooth LE
//! advertisers via the WinRT advertisement watcher. Discovery only; nothing connects.

use serde_json::{json, Value};

use crate::native::Res;

/// Windows 11 24H2+ only lists Wi-Fi networks to desktop apps the user lets use
/// location (Settings > Privacy & security > Location). BLE needs nothing.
#[tauri::command]
pub async fn nat_radar_permissions(a: Value) -> Res {
    let _ = a;
    let wifi = tokio::task::spawn_blocking(|| location::status(false)).await.map_err(|e| e.to_string())?;
    Ok(json!({ "wifi": wifi, "ble": "granted", "locationOn": wifi == "granted", "bluetoothOn": true }))
}

#[tauri::command]
pub async fn nat_radar_request(a: Value) -> Res {
    let _ = a;
    let wifi = tokio::task::spawn_blocking(|| location::status(true)).await.map_err(|e| e.to_string())?;
    Ok(json!({ "wifi": wifi, "ble": "granted", "locationOn": wifi == "granted", "bluetoothOn": true }))
}

#[cfg(windows)]
pub(crate) mod location {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};

    /// "granted" | "denied" | "prompt". With ask=true this shows Windows' own
    /// "Let T.U.R.D. access your location?" prompt (and lists the app in Settings).
    pub fn status(ask: bool) -> &'static str {
        let r = if ask {
            Geolocator::RequestAccessAsync().and_then(|op| op.join())
        } else {
            return "prompt";
        };
        match r {
            Ok(s) if s == GeolocationAccessStatus::Allowed => "granted",
            Ok(s) if s == GeolocationAccessStatus::Denied => "denied",
            Ok(_) => "prompt",
            Err(_) => "prompt",
        }
    }
}

#[cfg(not(windows))]
pub(crate) mod location {
    pub fn status(_ask: bool) -> &'static str { "granted" }
}

#[tauri::command]
pub async fn nat_wifi_scan(a: Value) -> Res {
    let _ = a;
    let mut r = tokio::task::spawn_blocking(wifi::scan).await.map_err(|e| e.to_string())?;
    if matches!(&r, Err(e) if e == wifi::DENIED) {
        // first time on 24H2+: ask for location, then try once more
        let st = tokio::task::spawn_blocking(|| location::status(true)).await.map_err(|e| e.to_string())?;
        if st == "granted" {
            r = tokio::task::spawn_blocking(wifi::scan).await.map_err(|e| e.to_string())?;
        }
        if r.is_err() {
            let _ = crate::native::shell_open("ms-settings:privacy-location");
            return Err("Windows blocks Wi-Fi lists for apps without location access. In the Settings page that just opened, turn on Location services and \"Let desktop apps access your location\", then scan again.".into());
        }
    }
    Ok(json!({ "items": r? }))
}

#[tauri::command]
pub async fn nat_ble_scan(a: Value) -> Res {
    let ms = a.get("ms").and_then(|v| v.as_u64()).unwrap_or(6000).clamp(1000, 30000);
    let items = tokio::task::spawn_blocking(move || ble::scan(ms)).await.map_err(|e| e.to_string())??;
    Ok(json!({ "items": items }))
}

pub(crate) fn channel(mhz: u32) -> u32 {
    match mhz {
        2484 => 14,
        2412..=2472 => (mhz - 2407) / 5,
        5955..=7115 => (mhz - 5950) / 5,
        5000..=5900 => (mhz - 5000) / 5,
        _ => 0,
    }
}

#[cfg(windows)]
mod wifi {
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, HANDLE, WIN32_ERROR};
    use windows::Win32::NetworkManagement::WiFi::*;

    pub const DENIED: &str = "denied";

    pub fn scan() -> Result<Vec<Value>, String> {
        unsafe {
            let mut ver = 0u32;
            let mut h = HANDLE::default();
            let r = WlanOpenHandle(2, None, &mut ver, &mut h);
            if r != 0 {
                return Err("Wi-Fi service (WLAN AutoConfig) is not running or there is no Wi-Fi adapter".into());
            }
            let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
            if WlanEnumInterfaces(h, None, &mut list) != 0 || list.is_null() {
                WlanCloseHandle(h, None);
                return Err("no Wi-Fi adapter found".into());
            }
            let n = (*list).dwNumberOfItems as usize;
            let ifaces = std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr(), n);
            for i in ifaces {
                let _ = WlanScan(h, &i.InterfaceGuid, None, None, None);
            }
            // a fresh scan takes ~2-4 s; the list call returns cached results meanwhile
            std::thread::sleep(std::time::Duration::from_millis(4000));
            let mut seen: HashMap<String, Value> = HashMap::new();
            let mut denied = false;
            for i in ifaces {
                let mut bl: *mut WLAN_BSS_LIST = std::ptr::null_mut();
                let r = WlanGetNetworkBssList(h, &i.InterfaceGuid, None, dot11_BSS_type_any, false, None, &mut bl);
                if WIN32_ERROR(r) == ERROR_ACCESS_DENIED {
                    denied = true;
                    continue;
                }
                if r != 0 || bl.is_null() {
                    continue;
                }
                let m = (*bl).dwNumberOfItems as usize;
                let entries = std::slice::from_raw_parts((*bl).wlanBssEntries.as_ptr(), m);
                for e in entries {
                    let len = (e.dot11Ssid.uSSIDLength as usize).min(32);
                    let ssid = String::from_utf8_lossy(&e.dot11Ssid.ucSSID[..len]).to_string();
                    let b = e.dot11Bssid;
                    let bssid = format!("{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}", b[0], b[1], b[2], b[3], b[4], b[5]);
                    let mhz = e.ulChCenterFrequency / 1000;
                    seen.insert(
                        bssid.clone(),
                        json!({
                            "ssid": if ssid.is_empty() { "(hidden)".to_string() } else { ssid },
                            "bssid": bssid,
                            "rssi": e.lRssi,
                            "freq": mhz,
                            "channel": super::channel(mhz),
                            "secure": e.usCapabilityInformation & 0x0010 != 0,
                        }),
                    );
                }
                WlanFreeMemory(bl as *const _);
            }
            WlanFreeMemory(list as *const _);
            WlanCloseHandle(h, None);
            if seen.is_empty() && denied {
                return Err(DENIED.into());
            }
            let mut v: Vec<Value> = seen.into_values().collect();
            v.sort_by_key(|x| -x["rssi"].as_i64().unwrap_or(-100));
            Ok(v)
        }
    }
}

#[cfg(windows)]
mod ble {
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use windows::Devices::Bluetooth::Advertisement::*;
    use windows::Foundation::TypedEventHandler;

    pub fn scan(ms: u64) -> Result<Vec<Value>, String> {
        let seen: Arc<Mutex<HashMap<u64, Value>>> = Arc::default();
        let w = BluetoothLEAdvertisementWatcher::new().map_err(|e| e.message().to_string())?;
        let _ = w.SetScanningMode(BluetoothLEScanningMode::Active);
        let s2 = seen.clone();
        w.Received(&TypedEventHandler::new(move |_, args: windows::core::Ref<BluetoothLEAdvertisementReceivedEventArgs>| {
            if let Some(a) = args.as_ref() {
                let addr = a.BluetoothAddress().unwrap_or(0);
                let rssi = a.RawSignalStrengthInDBm().unwrap_or(-100);
                let adv = a.Advertisement().ok();
                let name = adv.as_ref().and_then(|x| x.LocalName().ok()).map(|h| h.to_string()).unwrap_or_default();
                let vendor = adv
                    .as_ref()
                    .and_then(|x| x.ManufacturerData().ok())
                    .and_then(|l| l.GetAt(0).ok())
                    .and_then(|m| m.CompanyId().ok())
                    .map(vendor);
                let id = format!(
                    "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                    (addr >> 40) & 0xff, (addr >> 32) & 0xff, (addr >> 24) & 0xff, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff
                );
                let mut m = s2.lock().unwrap();
                let prev_name = m.get(&addr).and_then(|v| v["name"].as_str().map(String::from)).filter(|n| n != "Unknown BLE");
                let mut v = json!({
                    "id": id,
                    "name": if !name.is_empty() { name } else { prev_name.unwrap_or_else(|| "Unknown BLE".into()) },
                    "rssi": rssi,
                });
                if let Some(vd) = vendor {
                    v["vendor"] = Value::String(vd);
                }
                m.insert(addr, v);
            }
            Ok(())
        }))
        .map_err(|e| e.message().to_string())?;
        w.Start().map_err(|e| format!("Bluetooth is off or unavailable ({})", e.message()))?;
        std::thread::sleep(std::time::Duration::from_millis(ms));
        let _ = w.Stop();
        if let Ok(st) = w.Status() {
            if st == BluetoothLEAdvertisementWatcherStatus::Aborted {
                return Err("Bluetooth is off. Turn it on in Settings > Bluetooth & devices.".into());
            }
        }
        let mut v: Vec<Value> = seen.lock().unwrap().values().cloned().collect();
        v.sort_by_key(|x| -x["rssi"].as_i64().unwrap_or(-100));
        Ok(v)
    }

    fn vendor(id: u16) -> String {
        match id {
            0x004C => "Apple".into(),
            0x0075 => "Samsung".into(),
            0x00E0 => "Google".into(),
            0x0006 => "Microsoft".into(),
            0x0087 => "Garmin".into(),
            0x0157 => "Huami".into(),
            0x038F => "Xiaomi".into(),
            0x02E5 => "Espressif".into(),
            0x0059 => "Nordic".into(),
            0x00D2 => "Bose".into(),
            0x012D => "Sony".into(),
            0x0171 => "Amazon".into(),
            0x0499 => "Ruuvi".into(),
            0x0310 => "Tile".into(),
            x => format!("0x{x:04X}"),
        }
    }
}

#[cfg(not(windows))]
mod wifi {
    pub const DENIED: &str = "denied";
    pub fn scan() -> Result<Vec<serde_json::Value>, String> {
        Err("Wi-Fi scan is implemented for Windows".into())
    }
}

#[cfg(not(windows))]
mod ble {
    pub fn scan(_ms: u64) -> Result<Vec<serde_json::Value>, String> {
        Err("Bluetooth scan is implemented for Windows".into())
    }
}

/* ---------------------------------------------------------------- bluetooth batteries */
// Read-only battery level of already-paired Bluetooth devices (controller, earbuds, headset)
// via the GATT Battery Service (0x180F / characteristic 0x2A19). No scan, no pairing, no prompt.

#[tauri::command]
pub async fn nat_bt_batteries(a: Value) -> Res {
    let _ = a;
    tokio::task::spawn_blocking(|| bt::batteries().unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
        .map(|items| json!({ "items": items }))
}

#[cfg(windows)]
mod bt {
    use serde_json::{json, Value};
    use windows::Devices::Bluetooth::GenericAttributeProfile::{GattCharacteristicProperties, GattCommunicationStatus};
    use windows::Devices::Bluetooth::{BluetoothCacheMode, BluetoothConnectionStatus, BluetoothLEDevice};
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Storage::Streams::DataReader;

    const BATTERY_SERVICE: u16 = 0x180F;
    const BATTERY_LEVEL: u16 = 0x2A19;

    fn kind_of(name: &str, appearance: u16) -> &'static str {
        // GATT "appearance" categories (0x03C1 = HID gamepad, 0x0940s = audio), else name hints
        let a = appearance >> 6;
        match a {
            0x0F => "controller",        // generic HID
            0x25 => "earbuds",           // earbuds
            0x24 | 0x23 => "headset",    // headset / headphones
            _ => {
                let n = name.to_ascii_lowercase();
                if n.contains("controller") || n.contains("gamepad") || n.contains("xbox") || n.contains("dualsense") || n.contains("dualshock") {
                    "controller"
                } else if n.contains("buds") || n.contains("airpods") || n.contains("earbud") {
                    "earbuds"
                } else if n.contains("headset") || n.contains("headphone") || n.contains("headphones") {
                    "headset"
                } else {
                    "other"
                }
            }
        }
    }

    fn level_for(id: &windows::core::HSTRING) -> Option<(String, &'static str, u8)> {
        unsafe {
            let dev = BluetoothLEDevice::FromIdAsync(id).ok()?.join().ok()?;
            if dev.ConnectionStatus().ok()? != BluetoothConnectionStatus::Connected {
                return None; // only devices that are actually connected right now
            }
            let name = dev.Name().map(|s| s.to_string()).unwrap_or_default();
            let appearance = dev.Appearance().ok().and_then(|ap| ap.RawValue().ok()).unwrap_or(0);
            let services = dev
                .GetGattServicesForUuidWithCacheModeAsync(uuid16(BATTERY_SERVICE), BluetoothCacheMode::Cached)
                .ok()?
                .join()
                .ok()?;
            if services.Status().ok()? != GattCommunicationStatus::Success {
                return None;
            }
            for svc in services.Services().ok()? {
                let chars = svc
                    .GetCharacteristicsForUuidWithCacheModeAsync(uuid16(BATTERY_LEVEL), BluetoothCacheMode::Uncached)
                    .ok()?
                    .join()
                    .ok()?;
                if chars.Status().ok()? != GattCommunicationStatus::Success {
                    continue;
                }
                for ch in chars.Characteristics().ok()? {
                    let props = ch.CharacteristicProperties().ok()?;
                    if (props & GattCharacteristicProperties::Read) == GattCharacteristicProperties(0) {
                        continue;
                    }
                    let res = ch.ReadValueWithCacheModeAsync(BluetoothCacheMode::Uncached).ok()?.join().ok()?;
                    if res.Status().ok()? != GattCommunicationStatus::Success {
                        continue;
                    }
                    let buf = res.Value().ok()?;
                    let reader = DataReader::FromBuffer(&buf).ok()?;
                    if reader.UnconsumedBufferLength().ok()? >= 1 {
                        let lvl = reader.ReadByte().ok()?;
                        if lvl <= 100 {
                            return Some((name.clone(), kind_of(&name, appearance), lvl));
                        }
                    }
                }
            }
            None
        }
    }

    fn uuid16(short: u16) -> windows::core::GUID {
        // Bluetooth base UUID 0000xxxx-0000-1000-8000-00805F9B34FB
        windows::core::GUID::from_values(short as u32, 0x0000, 0x1000, [0x80, 0x00, 0x00, 0x80, 0x5F, 0x9B, 0x34, 0xFB])
    }

    pub fn batteries() -> Result<Vec<Value>, String> {
        unsafe {
            let selector = BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected)
                .map_err(|e| e.message().to_string())?;
            let found = DeviceInformation::FindAllAsyncAqsFilter(&selector)
                .map_err(|e| e.message().to_string())?
                .join()
                .map_err(|e| e.message().to_string())?;
            let mut out = Vec::new();
            for di in found {
                let id = match di.Id() {
                    Ok(id) => id,
                    Err(_) => continue,
                };
                if let Some((name, kind, level)) = level_for(&id) {
                    out.push(json!({
                        "name": if name.is_empty() { "Bluetooth device".into() } else { name },
                        "kind": kind,
                        "level": level,
                    }));
                }
            }
            Ok(out)
        }
    }
}

#[cfg(not(windows))]
mod bt {
    use serde_json::Value;
    pub fn batteries() -> Result<Vec<Value>, String> {
        Ok(Vec::new())
    }
}
