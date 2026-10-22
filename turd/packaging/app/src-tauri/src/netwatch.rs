//! Home network watch: who is on this Wi-Fi/LAN. ARP sweep of the local /24 (SendARP, which
//! also fills Windows' neighbour cache), names from NetBIOS node status (UDP 137) and reverse
//! DNS. Kept light for the low-end PC: 24 worker threads, ~1 s ARP timeout, ~10-15 s total.
//! Vendor names are filled in by web/src/native.js from the bundled offline OUI table.

use std::net::{Ipv4Addr, UdpSocket};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::native::Res;

/// (local ip, prefix, own mac, gateway) of the adapter that carries the LAN address.
fn lan() -> Option<(Ipv4Addr, u8, String, Option<Ipv4Addr>)> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.0.1:9").or_else(|_| s.connect("10.0.0.1:9")).ok()?;
    let ip = match s.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(v) if !v.is_unspecified() && !v.is_loopback() => v,
        _ => return None,
    };
    #[cfg(windows)]
    unsafe {
        use windows::Win32::NetworkManagement::IpHelper::{GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_DNS_SERVER, IP_ADAPTER_ADDRESSES_LH};
        use windows::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};
        let flags = GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_INCLUDE_GATEWAYS;
        let mut len: u32 = 32 * 1024;
        let mut buf = vec![0u8; len as usize];
        let mut r = GetAdaptersAddresses(AF_INET.0 as u32, flags, None, Some(buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH), &mut len);
        if r == 111 {
            buf = vec![0u8; len as usize];
            r = GetAdaptersAddresses(AF_INET.0 as u32, flags, None, Some(buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH), &mut len);
        }
        if r == 0 {
            let v4 = |sa: *const windows::Win32::Networking::WinSock::SOCKADDR| -> Option<Ipv4Addr> {
                if sa.is_null() || (*sa).sa_family != AF_INET {
                    return None;
                }
                let sin = &*(sa as *const SOCKADDR_IN);
                Some(Ipv4Addr::from(u32::from_be(sin.sin_addr.S_un.S_addr)))
            };
            let mut a = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
            while !a.is_null() {
                let mut u = (*a).FirstUnicastAddress;
                while !u.is_null() {
                    if v4((*u).Address.lpSockaddr) == Some(ip) {
                        let prefix = (*u).OnLinkPrefixLength;
                        let n = ((*a).PhysicalAddressLength as usize).min(8);
                        let m: [u8; 8] = (*a).PhysicalAddress;
                        let mac = fmt_mac(&m[..n]);
                        let g = (*a).FirstGatewayAddress;
                        let gw = if g.is_null() { None } else { v4((*g).Address.lpSockaddr) };
                        return Some((ip, prefix, mac, gw));
                    }
                    u = (*u).Next;
                }
                a = (*a).Next;
            }
        }
    }
    Some((ip, 24, String::new(), None))
}

fn fmt_mac(m: &[u8]) -> String {
    if m.len() != 6 || m.iter().all(|b| *b == 0) {
        return String::new();
    }
    m.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

#[cfg(windows)]
fn arp(ip: Ipv4Addr, src: Ipv4Addr) -> Option<String> {
    use windows::Win32::NetworkManagement::IpHelper::SendARP;
    let mut mac = [0u8; 8];
    let mut len: u32 = 8;
    let r = unsafe { SendARP(u32::from_ne_bytes(ip.octets()), u32::from_ne_bytes(src.octets()), mac.as_mut_ptr() as *mut _, &mut len) };
    if r == 0 && len >= 6 {
        let m = fmt_mac(&mac[..6]);
        if !m.is_empty() {
            return Some(m);
        }
    }
    None
}
#[cfg(not(windows))]
fn arp(_ip: Ipv4Addr, _src: Ipv4Addr) -> Option<String> {
    None
}

/// NetBIOS node status (NBSTAT) query: Windows PCs, NAS boxes and Samba answer with their name.
pub(crate) fn netbios(ip: Ipv4Addr, timeout: Duration) -> Option<(String, String)> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.set_read_timeout(Some(timeout)).ok()?;
    let mut q = vec![0x7D, 0x2D, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x20, b'C', b'K'];
    q.extend(std::iter::repeat(b'A').take(30));
    q.extend_from_slice(&[0, 0, 0x21, 0, 1]);
    s.send_to(&q, (ip, 137)).ok()?;
    let mut buf = [0u8; 1024];
    let (n, _) = s.recv_from(&mut buf).ok()?;
    let b = &buf[..n];
    // header 12 + name 34 + type/class 4 + ttl 4 + rdlength 2 = 56, then the name count
    if b.len() < 57 {
        return None;
    }
    let count = b[56] as usize;
    let mut name = String::new();
    for i in 0..count {
        let o = 57 + i * 18;
        if o + 18 > b.len() {
            break;
        }
        let suffix = b[o + 15];
        let group = b[o + 16] & 0x80 != 0;
        if suffix == 0 && !group {
            name = String::from_utf8_lossy(&b[o..o + 15]).trim().to_string();
            break;
        }
    }
    let o = 57 + count * 18;
    let mac = if o + 6 <= b.len() { fmt_mac(&b[o..o + 6]) } else { String::new() };
    if name.is_empty() && mac.is_empty() {
        None
    } else {
        Some((name, mac))
    }
}

#[cfg(windows)]
fn rdns(ip: Ipv4Addr) -> Option<String> {
    use windows::Win32::Networking::WinSock::{GetNameInfoW, AF_INET, IN_ADDR, IN_ADDR_0, NI_NAMEREQD, SOCKADDR, SOCKADDR_IN, socklen_t};
    let sin = SOCKADDR_IN {
        sin_family: AF_INET,
        sin_port: 0,
        sin_addr: IN_ADDR { S_un: IN_ADDR_0 { S_addr: u32::from_ne_bytes(ip.octets()) } },
        sin_zero: [0; 8],
    };
    let mut host = [0u16; 256];
    let r = unsafe { GetNameInfoW(&sin as *const _ as *const SOCKADDR, socklen_t(std::mem::size_of::<SOCKADDR_IN>() as i32), Some(&mut host), None, NI_NAMEREQD as i32) };
    if r != 0 {
        return None;
    }
    let n = host.iter().position(|c| *c == 0).unwrap_or(host.len());
    let h = String::from_utf16_lossy(&host[..n]);
    if h.is_empty() || h == ip.to_string() {
        None
    } else {
        Some(h.trim_end_matches('.').to_string())
    }
}
#[cfg(not(windows))]
fn rdns(_ip: Ipv4Addr) -> Option<String> {
    None
}

fn scan() -> Result<Value, String> {
    let (me, prefix, my_mac, gw) = lan().ok_or("not connected to a network")?;
    // always the /24 around us (a bigger subnet would be thousands of hosts on a low-end PC)
    let base = u32::from(me) & 0xFFFF_FF00;
    let hosts: Vec<Ipv4Addr> = (1..255u32).map(|i| Ipv4Addr::from(base | i)).filter(|ip| *ip != me).collect();
    let next = Arc::new(AtomicUsize::new(0));
    let found = Arc::new(Mutex::new(Vec::<Value>::new()));
    let hosts = Arc::new(hosts);
    let mut ws = Vec::new();
    for _ in 0..24 {
        let (next, found, hosts) = (next.clone(), found.clone(), hosts.clone());
        ws.push(std::thread::spawn(move || loop {
            let i = next.fetch_add(1, Ordering::Relaxed);
            let Some(ip) = hosts.get(i).copied() else { break };
            let mac = arp(ip, me);
            if mac.is_none() && cfg!(windows) {
                continue; // no ARP answer: nothing at this address
            }
            let nb = netbios(ip, Duration::from_millis(350));
            let mut name = nb.as_ref().map(|n| n.0.clone()).unwrap_or_default();
            if name.is_empty() {
                name = rdns(ip).unwrap_or_default();
            }
            let mac = mac.or_else(|| nb.map(|n| n.1).filter(|m| !m.is_empty())).unwrap_or_default();
            if mac.is_empty() && name.is_empty() {
                continue;
            }
            found.lock().unwrap().push(json!({
                "ip": ip.to_string(), "mac": mac, "vendor": "", "hostname": name,
                "gateway": Some(ip) == gw, "self": false,
            }));
        }));
    }
    for w in ws {
        let _ = w.join();
    }
    let mut items = std::mem::take(&mut *found.lock().unwrap());
    items.push(json!({
        "ip": me.to_string(), "mac": my_mac, "vendor": "",
        "hostname": std::env::var("COMPUTERNAME").unwrap_or_default(), "gateway": false, "self": true,
    }));
    items.sort_by_key(|v| v["ip"].as_str().and_then(|s| s.parse::<Ipv4Addr>().ok()).map(u32::from).unwrap_or(0));
    Ok(json!({
        "items": items,
        "subnet": format!("{}/24", Ipv4Addr::from(base)),
        "prefix": prefix,
        "gateway": gw.map(|g| g.to_string()),
        "macs": cfg!(windows),
    }))
}

#[tauri::command]
pub async fn nat_netwatch_request(a: Value) -> Res {
    let _ = a;
    // a LAN sweep needs no Windows permission; report whether there is a network to sweep
    let l = lan();
    Ok(json!({ "granted": l.is_some(), "network": l.map(|l| l.0.to_string()) }))
}

#[tauri::command]
pub async fn nat_netwatch_scan(a: Value) -> Res {
    let _ = a;
    tokio::task::spawn_blocking(scan).await.map_err(|e| e.to_string())?
}
