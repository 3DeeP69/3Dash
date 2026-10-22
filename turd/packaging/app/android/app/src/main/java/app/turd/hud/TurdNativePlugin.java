package app.turd.hud;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * T.U.R.D. native layer for Android: CORS-free http, Wi-Fi + BLE radar scans,
 * and the Extras download / install hooks. JS side: web/src/native.js
 * (window.TURD_NATIVE). Every method resolves an object; lists come back as
 * {items:[...]}, maps as {map:{...}}.
 */
@CapacitorPlugin(
    name = "TurdNative",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "nearbyWifi", strings = { "android.permission.NEARBY_WIFI_DEVICES" }),
        @Permission(alias = "bluetooth", strings = { "android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT" }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }),
    }
)
public class TurdNativePlugin extends Plugin {

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, AtomicBoolean> active = new ConcurrentHashMap<>();
    private SharedPreferences meta;

    @Override
    public void load() {
        meta = getContext().getSharedPreferences("turd_extras", Context.MODE_PRIVATE);
        // Fold status: tell JS when charging flips or the battery moves 5%, so the PC card stays
        // current without polling. ACTION_BATTERY_CHANGED is sticky and only delivered while we live.
        batteryRx = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                int lvl = i.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
                int st = i.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
                boolean chg = st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL;
                if (lastChg != null && lastChg == chg && Math.abs(lvl - lastLvl) < 5) return;
                lastChg = chg;
                lastLvl = lvl;
                try { notifyListeners("device:status", JSObject.fromJSONObject(TurdStatus.snapshot(c))); } catch (Exception ignored) {}
            }
        };
        try { getContext().registerReceiver(batteryRx, new IntentFilter(Intent.ACTION_BATTERY_CHANGED)); } catch (Exception ignored) {}
    }

    private BroadcastReceiver batteryRx;
    private Boolean lastChg = null;
    private int lastLvl = -100;

    @Override
    protected void handleOnDestroy() {
        try { if (batteryRx != null) getContext().unregisterReceiver(batteryRx); } catch (Exception ignored) {}
        super.handleOnDestroy();
    }

    /* ================================================================ port scan */

    private static final int[] COMMON_PORTS = {21,22,23,25,53,80,110,111,135,139,143,443,445,515,548,554,631,993,995,1883,1900,3000,3306,3389,5000,5353,5432,5900,6379,7000,8000,8009,8080,8443,8787,8883,9000,32400};

    /** Bounded TCP connect scan of one host (Spy tools recon). {host, ports?[], timeoutMs?}. */
    @PluginMethod
    public void portScan(PluginCall call) {
        final String host = call.getString("host", "");
        if (host.isEmpty()) { call.reject("no host to scan"); return; }
        final int timeout = Math.max(100, Math.min(2000, call.getInt("timeoutMs", 500)));
        final List<Integer> ports = new ArrayList<>();
        JSArray pa = call.getArray("ports", null);
        try { if (pa != null) for (int i = 0; i < pa.length(); i++) { int p = pa.getInt(i); if (p >= 1 && p <= 65535) ports.add(p); } } catch (Exception ignored) {}
        if (ports.isEmpty()) for (int p : COMMON_PORTS) ports.add(p);
        io.execute(() -> {
            final List<Integer> open = java.util.Collections.synchronizedList(new ArrayList<>());
            ExecutorService pool = Executors.newFixedThreadPool(16);
            for (final int port : ports) pool.execute(() -> {
                try (java.net.Socket sk = new java.net.Socket()) {
                    sk.connect(new java.net.InetSocketAddress(host, port), timeout);
                    open.add(port);
                } catch (Exception ignored) {}
            });
            pool.shutdown();
            try { pool.awaitTermination(60, TimeUnit.SECONDS); } catch (Exception ignored) {}
            java.util.Collections.sort(open);
            JSArray items = new JSArray();
            for (int p : open) { JSObject o = new JSObject(); o.put("port", p); o.put("service", serviceName(p)); items.put(o); }
            JSObject res = new JSObject();
            res.put("host", host);
            res.put("items", items);
            call.resolve(res);
        });
    }

    private static String serviceName(int port) {
        switch (port) {
            case 21: return "ftp"; case 22: return "ssh"; case 23: return "telnet"; case 25: return "smtp";
            case 53: return "dns"; case 80: return "http"; case 110: return "pop3"; case 139: return "netbios";
            case 143: return "imap"; case 443: return "https"; case 445: return "smb"; case 554: return "rtsp";
            case 631: return "ipp"; case 993: return "imaps"; case 1883: return "mqtt"; case 3306: return "mysql";
            case 3389: return "rdp"; case 5432: return "postgres"; case 5900: return "vnc"; case 8080: return "http-proxy";
            case 8443: return "https-alt"; case 8787: return "turd"; case 32400: return "plex"; default: return "";
        }
    }

    /* ================================================================ network watch */

    @PluginMethod
    public void netwatchRequest(PluginCall call) {
        // a LAN sweep needs only INTERNET; say whether there is a Wi-Fi network to sweep
        JSObject o = new JSObject();
        boolean wifi = false;
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
            wifi = caps != null && (caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET));
        } catch (Exception ignored) {}
        o.put("granted", wifi);
        if (!wifi) o.put("reason", "Connect to your home Wi-Fi to see who is on it");
        call.resolve(o);
    }

    @PluginMethod
    public void netwatchScan(PluginCall call) {
        io.execute(() -> {
            try { call.resolve(JSObject.fromJSONObject(TurdNetwatch.scan(getContext()))); }
            catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        });
    }

    /* ================================================================ bluetooth batteries */

    /** Read-only battery level of ALREADY-CONNECTED Bluetooth devices (controller, earbuds, headset).
     *  No scan and no new permission: if BLUETOOTH_CONNECT isn't granted we return an empty list. */
    @PluginMethod
    public void btBatteries(PluginCall call) {
        JSArray out = new JSArray();
        try {
            if (Build.VERSION.SDK_INT >= 31 && ContextCompat.checkSelfPermission(getContext(), "android.permission.BLUETOOTH_CONNECT") != PackageManager.PERMISSION_GRANTED) {
                call.resolve(itemsOf(out)); return;
            }
            BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
            if (ad == null || !ad.isEnabled()) { call.resolve(itemsOf(out)); return; }
            java.util.Set<BluetoothDevice> bonded = ad.getBondedDevices();
            if (bonded == null) { call.resolve(itemsOf(out)); return; }
            java.lang.reflect.Method getLevel = BluetoothDevice.class.getMethod("getBatteryLevel");
            java.lang.reflect.Method isConn = BluetoothDevice.class.getMethod("isConnected");
            for (BluetoothDevice d : bonded) {
                try {
                    boolean connected = Boolean.TRUE.equals(isConn.invoke(d));
                    if (!connected) continue;
                    int lvl = (int) getLevel.invoke(d);            // -1 when the device doesn't report one
                    if (lvl < 0 || lvl > 100) continue;
                    JSObject o = new JSObject();
                    o.put("name", d.getName() == null ? "Bluetooth device" : d.getName());
                    o.put("kind", btKind(d));
                    o.put("level", lvl);
                    out.put(o);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        call.resolve(itemsOf(out));
    }

    private static String btKind(BluetoothDevice d) {
        try {
            int cls = d.getBluetoothClass().getDeviceClass();
            switch (cls) {
                case android.bluetooth.BluetoothClass.Device.AUDIO_VIDEO_WEARABLE_HEADSET:
                case android.bluetooth.BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE:
                    return "headset";
                case android.bluetooth.BluetoothClass.Device.AUDIO_VIDEO_HEADPHONES:
                    return "earbuds";
                case android.bluetooth.BluetoothClass.Device.TOY_CONTROLLER:
                    return "controller";
                default:
                    int major = d.getBluetoothClass().getMajorDeviceClass();
                    if (major == android.bluetooth.BluetoothClass.Device.Major.AUDIO_VIDEO) return "headset";
                    if (major == android.bluetooth.BluetoothClass.Device.Major.PERIPHERAL) return "controller";
                    return "other";
            }
        } catch (Exception e) { return "other"; }
    }

    private static JSObject itemsOf(JSArray a) { JSObject o = new JSObject(); o.put("items", a); return o; }

    /* ================================================================ device status */

    @PluginMethod
    public void deviceStatus(PluginCall call) {
        try { call.resolve(JSObject.fromJSONObject(TurdStatus.snapshot(getContext()))); }
        catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
    }

    /** {url, token, enabled, minutes}: background reports while the app is closed (JobScheduler, >=15 min). */
    @PluginMethod
    public void statusReporter(PluginCall call) {
        TurdStatus.configure(getContext(), call.getString("url", ""), call.getString("token", ""),
                Boolean.TRUE.equals(call.getBoolean("enabled", true)), call.getInt("minutes", 30));
        JSObject o = ok();
        o.put("id", TurdStatus.deviceId(getContext()));
        call.resolve(o);
    }

    /** Report right now (from native, so it works even while the WebView is throttled). */
    @PluginMethod
    public void statusReport(PluginCall call) {
        io.execute(() -> {
            int code = TurdStatus.post(getContext());
            JSObject o = new JSObject();
            o.put("ok", code >= 200 && code < 300);
            o.put("status", code);
            call.resolve(o);
        });
    }

    /* ================================================================ app */

    @PluginMethod
    public void info(PluginCall call) {
        JSObject o = new JSObject();
        o.put("platform", "android");
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            o.put("version", pi.versionName);
        } catch (Exception e) { o.put("version", ""); }
        o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        o.put("sdk", Build.VERSION.SDK_INT);
        File d = defaultDir();
        o.put("freeBytes", free(d));
        call.resolve(o);
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        Activity a = getActivity();
        try {
            Intent i;
            if (url.startsWith("intent:")) i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            else i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                a.startActivity(i);
            } catch (ActivityNotFoundException e) {
                // no Play Store / F-Droid client installed: open the web listing instead
                Uri u = Uri.parse(url);
                String web = null;
                if ("market".equals(u.getScheme())) web = "https://play.google.com/store/apps/details?" + (u.getQuery() == null ? "" : u.getQuery());
                else if (url.startsWith("intent:")) web = i.getStringExtra("browser_fallback_url");
                if (web == null) throw e;
                a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            call.resolve(ok());
        } catch (Exception e) {
            call.reject("cannot open " + url + ": " + e.getMessage());
        }
    }

    /* ================================================================ http */

    @PluginMethod
    public void http(final PluginCall call) {
        io.execute(() -> {
            try {
                String url = call.getString("url");
                String method = call.getString("method", "GET");
                int timeout = call.getInt("timeoutMs", 30000);
                boolean follow = call.getBoolean("follow", true);
                JSObject headers = call.getObject("headers", new JSObject());
                String body = call.getString("body", null);
                byte[] payload = body == null ? null : Base64.decode(body, Base64.DEFAULT);

                HttpURLConnection c = null;
                int hops = 0;
                while (true) {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setInstanceFollowRedirects(false);   // done by hand so http↔https hops work
                    c.setConnectTimeout(Math.min(timeout, 15000));
                    c.setReadTimeout(timeout);
                    c.setRequestMethod(method);
                    boolean ua = false;
                    for (java.util.Iterator<String> it = headers.keys(); it.hasNext(); ) {
                        String k = it.next();
                        if (k.equalsIgnoreCase("user-agent")) ua = true;
                        c.setRequestProperty(k, headers.getString(k));
                    }
                    if (!ua) c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") TURD/1.0");
                    if (payload != null && !method.equals("GET") && !method.equals("HEAD")) {
                        c.setDoOutput(true);
                        try (OutputStream os = c.getOutputStream()) { os.write(payload); }
                    }
                    int code = c.getResponseCode();
                    if (follow && code >= 300 && code < 400 && c.getHeaderField("Location") != null && hops++ < 10) {
                        url = new URL(new URL(url), c.getHeaderField("Location")).toString();
                        if (code == 303 || ((code == 301 || code == 302) && method.equals("POST"))) { method = "GET"; payload = null; }
                        c.disconnect();
                        continue;
                    }
                    break;
                }
                int code = c.getResponseCode();
                JSObject h = new JSObject();
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                    if (e.getKey() == null) continue;
                    h.put(e.getKey().toLowerCase(Locale.ROOT), String.join(", ", e.getValue()));
                }
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                byte[] bytes = in == null ? new byte[0] : readAll(in, 32 * 1024 * 1024);
                JSObject o = new JSObject();
                o.put("status", code);
                o.put("statusText", c.getResponseMessage() == null ? "" : c.getResponseMessage());
                o.put("url", url);
                o.put("headers", h);
                o.put("body", Base64.encodeToString(bytes, Base64.NO_WRAP));
                c.disconnect();
                call.resolve(o);
            } catch (Exception e) {
                call.reject("network error: " + e.getMessage());
            }
        });
    }

    /* ================================================================ radar */

    // Android 13+: "Nearby devices" alone lists Wi-Fi (declared neverForLocation), so a user
    // who picked "approximate" or no location still gets a full scan
    private String[] wifiAliases() { return Build.VERSION.SDK_INT >= 33 ? new String[] { "nearbyWifi" } : new String[] { "location" }; }
    private String[] bleAliases() { return Build.VERSION.SDK_INT >= 31 ? new String[] { "bluetooth" } : new String[] { "location" }; }

    private String stateOf(String[] aliases) {
        boolean prompt = false;
        for (String a : aliases) {
            PermissionState s = getPermissionState(a);
            if (s == PermissionState.DENIED) return "denied";
            if (s != PermissionState.GRANTED) prompt = true;
        }
        return prompt ? "prompt" : "granted";
    }

    private JSObject permObj() {
        JSObject o = new JSObject();
        o.put("wifi", stateOf(wifiAliases()));
        o.put("ble", stateOf(bleAliases()));
        o.put("locationOn", locationOn());
        BluetoothAdapter ad = adapter();
        o.put("bluetoothOn", ad != null && ad.isEnabled());
        return o;
    }

    @PluginMethod
    public void radarPermissions(PluginCall call) { call.resolve(permObj()); }

    @PluginMethod
    public void radarRequest(PluginCall call) {
        List<String> want = new ArrayList<>();
        for (String a : wifiAliases()) if (!want.contains(a)) want.add(a);
        for (String a : bleAliases()) if (!want.contains(a)) want.add(a);
        requestPermissionForAliases(want.toArray(new String[0]), call, "radarPermsDone");
    }

    @PermissionCallback
    private void radarPermsDone(PluginCall call) { call.resolve(permObj()); }

    private void openAppSettings() {
        try {
            getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {}
    }

    /* ================================================================ network */

    /** This device's Wi-Fi/LAN address, so the app can find the PC's server on the same network. */
    @PluginMethod
    public void netInfo(PluginCall call) {
        JSObject o = new JSObject();
        JSArray addrs = new JSArray();
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.Network n = cm.getActiveNetwork();
            android.net.NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            o.put("wifi", caps != null && (caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)));
            android.net.LinkProperties lp = n == null ? null : cm.getLinkProperties(n);
            if (lp != null) for (android.net.LinkAddress la : lp.getLinkAddresses()) {
                if (la.getAddress() instanceof java.net.Inet4Address && !la.getAddress().isLoopbackAddress()) {
                    addrs.put(new JSObject().put("ip", la.getAddress().getHostAddress()).put("prefix", la.getPrefixLength()));
                }
            }
        } catch (Exception ignored) {}
        o.put("addrs", addrs);
        call.resolve(o);
    }

    /** Wake-on-LAN: magic packet (6x 0xFF + 16x MAC) as UDP broadcast on ports 9 and 7. */
    @PluginMethod
    public void wakeOnLan(final PluginCall call) {
        final String mac = call.getString("mac", "");
        final String bcast = call.getString("broadcast", "");
        io.execute(() -> {
            try {
                String hex = mac.replaceAll("[^0-9A-Fa-f]", "");
                if (hex.length() != 12) throw new IllegalArgumentException("MAC address should look like AA:BB:CC:DD:EE:FF");
                byte[] m = new byte[6];
                for (int i = 0; i < 6; i++) m[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
                byte[] pkt = new byte[6 + 16 * 6];
                for (int i = 0; i < 6; i++) pkt[i] = (byte) 0xFF;
                for (int i = 6; i < pkt.length; i += 6) System.arraycopy(m, 0, pkt, i, 6);
                List<String> targets = new ArrayList<>();
                targets.add("255.255.255.255");
                if (!bcast.isEmpty()) targets.add(bcast);
                // the subnet's own broadcast address (some routers drop 255.255.255.255)
                try {
                    android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
                    android.net.LinkProperties lp = cm.getLinkProperties(cm.getActiveNetwork());
                    if (lp != null) for (android.net.LinkAddress la : lp.getLinkAddresses()) {
                        if (!(la.getAddress() instanceof java.net.Inet4Address)) continue;
                        byte[] a = la.getAddress().getAddress();
                        int ip = ((a[0] & 0xff) << 24) | ((a[1] & 0xff) << 16) | ((a[2] & 0xff) << 8) | (a[3] & 0xff);
                        int mask = la.getPrefixLength() == 0 ? 0 : -1 << (32 - la.getPrefixLength());
                        int b = ip | ~mask;
                        targets.add(((b >>> 24) & 0xff) + "." + ((b >>> 16) & 0xff) + "." + ((b >>> 8) & 0xff) + "." + (b & 0xff));
                    }
                } catch (Exception ignored) {}
                int sent = 0;
                try (java.net.DatagramSocket s = new java.net.DatagramSocket()) {
                    s.setBroadcast(true);
                    for (int round = 0; round < 3; round++) {
                        for (String tg : targets) for (int port : new int[] { 9, 7 }) {
                            try { s.send(new java.net.DatagramPacket(pkt, pkt.length, java.net.InetAddress.getByName(tg), port)); sent++; } catch (Exception ignored) {}
                        }
                        Thread.sleep(120);
                    }
                }
                if (sent == 0) throw new IOException("no network to send on (connect to your home Wi-Fi)");
                JSObject o = new JSObject();
                o.put("ok", true);
                o.put("sent", sent);
                call.resolve(o);
            } catch (Exception e) {
                call.reject("Wake failed: " + e.getMessage());
            }
        });
    }

    private boolean locationOn() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            return Build.VERSION.SDK_INT >= 28 ? lm.isLocationEnabled() : lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) { return false; }
    }

    @PluginMethod
    public void wifiScan(final PluginCall call) {
        if (!"granted".equals(stateOf(wifiAliases()))) { requestPermissionForAliases(wifiAliases(), call, "wifiPermsDone"); return; }
        doWifiScan(call);
    }

    @PermissionCallback
    private void wifiPermsDone(PluginCall call) {
        if (!"granted".equals(stateOf(wifiAliases()))) { openAppSettings(); call.reject(Build.VERSION.SDK_INT >= 33 ? "Wi-Fi scan needs \"Nearby devices\". Turn it on under Permissions in the screen that just opened." : "Wi-Fi scan needs Location. Turn it on under Permissions in the screen that just opened.", "PERMISSION"); return; }
        doWifiScan(call);
    }

    @SuppressLint("MissingPermission")
    private void doWifiScan(final PluginCall call) {
        final WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm == null) { call.reject("no Wi-Fi hardware"); return; }
        if (!wm.isWifiEnabled()) { call.reject("Wi-Fi is off. Turn it on to scan.", "WIFI_OFF"); return; }
        if (Build.VERSION.SDK_INT < 33 && !locationOn()) { call.reject("Android needs Location turned on to list Wi-Fi networks.", "LOCATION_OFF"); return; }
        final AtomicBoolean done = new AtomicBoolean(false);
        final Context ctx = getContext();
        final BroadcastReceiver[] holder = new BroadcastReceiver[1];
        final Runnable finish = () -> {
            if (!done.compareAndSet(false, true)) return;
            try { ctx.unregisterReceiver(holder[0]); } catch (Exception ignored) {}
            JSArray arr = new JSArray();
            try {
                for (android.net.wifi.ScanResult r : wm.getScanResults()) {
                    JSObject o = new JSObject();
                    String ssid = r.SSID;
                    o.put("ssid", ssid == null || ssid.isEmpty() ? "(hidden)" : ssid);
                    o.put("bssid", r.BSSID);
                    o.put("rssi", r.level);
                    o.put("freq", r.frequency);
                    o.put("channel", channel(r.frequency));
                    String cap = r.capabilities == null ? "" : r.capabilities;
                    o.put("secure", cap.contains("WPA") || cap.contains("WEP") || cap.contains("SAE") || cap.contains("EAP"));
                    o.put("security", cap);
                    arr.put(o);
                }
            } catch (SecurityException e) { call.reject("permission revoked", "PERMISSION"); return; }
            JSObject res = new JSObject();
            res.put("items", arr);
            call.resolve(res);
        };
        holder[0] = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) { finish.run(); }
        };
        ContextCompat.registerReceiver(ctx, holder[0], new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION), ContextCompat.RECEIVER_EXPORTED);
        boolean started;
        try { started = wm.startScan(); } catch (Exception e) { started = false; }
        // throttled (4 scans / 2 min) or refused: Android still hands back the last results
        main.postDelayed(finish, started ? 9000 : 300);
    }

    private static int channel(int f) {
        if (f == 2484) return 14;
        if (f >= 2412 && f <= 2472) return (f - 2407) / 5;
        if (f >= 5955 && f <= 7115) return (f - 5950) / 5;     // 6 GHz
        if (f >= 5000 && f <= 5900) return (f - 5000) / 5;
        return 0;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return bm == null ? null : bm.getAdapter();
    }

    @PluginMethod
    public void bleScan(final PluginCall call) {
        if (!"granted".equals(stateOf(bleAliases()))) { requestPermissionForAliases(bleAliases(), call, "blePermsDone"); return; }
        doBleScan(call);
    }

    @PermissionCallback
    private void blePermsDone(PluginCall call) {
        if (!"granted".equals(stateOf(bleAliases()))) { openAppSettings(); call.reject("Bluetooth scan needs \"Nearby devices\". Turn it on under Permissions in the screen that just opened.", "PERMISSION"); return; }
        doBleScan(call);
    }

    @SuppressLint("MissingPermission")
    private void doBleScan(final PluginCall call) {
        BluetoothAdapter ad = adapter();
        if (ad == null) { call.reject("no Bluetooth hardware"); return; }
        if (!ad.isEnabled()) {
            try { getActivity().startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)); } catch (Exception ignored) {}
            call.reject("Bluetooth is off. Turn it on to scan.", "BT_OFF");
            return;
        }
        if (Build.VERSION.SDK_INT < 31 && !locationOn()) { call.reject("Android needs Location turned on to scan Bluetooth.", "LOCATION_OFF"); return; }
        final BluetoothLeScanner sc = ad.getBluetoothLeScanner();
        if (sc == null) { call.reject("Bluetooth LE unavailable"); return; }
        final Map<String, JSObject> seen = new LinkedHashMap<>();
        final ScanCallback cb = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult r) {
                BluetoothDevice d = r.getDevice();
                String name = r.getScanRecord() != null ? r.getScanRecord().getDeviceName() : null;
                if (name == null) try { name = d.getName(); } catch (SecurityException ignored) {}
                JSObject o = new JSObject();
                o.put("id", d.getAddress());
                o.put("name", name == null || name.isEmpty() ? "Unknown BLE" : name);
                o.put("rssi", r.getRssi());
                if (Build.VERSION.SDK_INT >= 26) o.put("connectable", r.isConnectable());
                if (r.getScanRecord() != null && r.getScanRecord().getManufacturerSpecificData() != null
                    && r.getScanRecord().getManufacturerSpecificData().size() > 0)
                    o.put("vendor", vendor(r.getScanRecord().getManufacturerSpecificData().keyAt(0)));
                synchronized (seen) { seen.put(d.getAddress(), o); }
            }
            @Override public void onScanFailed(int err) {
                synchronized (seen) { if (seen.isEmpty()) seen.put("__err", new JSObject().put("err", err)); }
            }
        };
        ScanSettings set = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        try { sc.startScan(null, set, cb); } catch (SecurityException e) { call.reject("permission revoked", "PERMISSION"); return; }
        int ms = Math.max(1000, Math.min(30000, call.getInt("ms", 6000)));
        main.postDelayed(() -> {
            try { sc.stopScan(cb); } catch (Exception ignored) {}
            JSArray arr = new JSArray();
            synchronized (seen) {
                if (seen.containsKey("__err") && seen.size() == 1) { call.reject("scan failed (" + seen.get("__err").optInt("err") + ")"); return; }
                for (JSObject o : seen.values()) arr.put(o);
            }
            JSObject res = new JSObject();
            res.put("items", arr);
            call.resolve(res);
        }, ms);
    }

    private static String vendor(int id) {
        switch (id) {
            case 0x004C: return "Apple";
            case 0x0075: return "Samsung";
            case 0x00E0: return "Google";
            case 0x0006: return "Microsoft";
            case 0x0087: return "Garmin";
            case 0x0157: return "Huami";
            case 0x038F: return "Xiaomi";
            case 0x02E5: return "Espressif";
            case 0x0059: return "Nordic";
            case 0x00D2: return "Bose";
            case 0x012D: return "Sony";
            case 0x0171: return "Amazon";
            case 0x0499: return "Ruuvi";
            case 0x0310: return "Tile";
            default: return String.format(Locale.ROOT, "0x%04X", id);
        }
    }

    /* ================================================================ extras */

    private File defaultDir() {
        File d = getContext().getExternalFilesDir("extras");
        if (d == null) d = new File(getContext().getFilesDir(), "extras");
        d.mkdirs();
        return d;
    }

    private File dirFor(String dir) {
        if (dir == null || dir.isEmpty()) return defaultDir();
        File d = new File(dir);
        d.mkdirs();
        return d;
    }

    private static long free(File d) {
        try { return new StatFs(d.getAbsolutePath()).getAvailableBytes(); } catch (Exception e) { return -1; }
    }

    private static long total(File d) {
        try { return new StatFs(d.getAbsolutePath()).getTotalBytes(); } catch (Exception e) { return -1; }
    }

    @PluginMethod
    public void extrasInfo(PluginCall call) {
        File d = dirFor(call.getString("dir"));
        JSObject o = new JSObject();
        o.put("dir", d.getAbsolutePath());
        o.put("freeBytes", free(d));
        o.put("totalBytes", total(d));
        o.put("platform", "android");
        call.resolve(o);
    }

    @PluginMethod
    public void extrasDirs(PluginCall call) {
        JSArray arr = new JSArray();
        File[] all = getContext().getExternalFilesDirs("extras");
        for (int i = 0; i < all.length; i++) {
            File d = all[i];
            if (d == null) continue;
            d.mkdirs();
            boolean removable = false;
            try { removable = Environment.isExternalStorageRemovable(d); } catch (Exception ignored) {}
            JSObject o = new JSObject();
            o.put("path", d.getAbsolutePath());
            o.put("label", i == 0 ? "Phone storage" : removable ? "SD card / USB" : "Storage " + (i + 1));
            o.put("freeBytes", free(d));
            o.put("totalBytes", total(d));
            o.put("removable", removable);
            arr.put(o);
        }
        JSObject res = new JSObject();
        res.put("items", arr);
        call.resolve(res);
    }

    /** Android has no free-form folder picker for raw files; offer the app's storage volumes instead. */
    @PluginMethod
    public void extrasPickDir(PluginCall call) { extrasDirs(call); }

    private JSONObject metaOf(String id) {
        try { String s = meta.getString(id, null); return s == null ? null : new JSONObject(s); } catch (Exception e) { return null; }
    }

    private File fileOf(String id) {
        JSONObject m = metaOf(id);
        if (m != null) return new File(m.optString("path"));
        File f = new File(defaultDir(), safeName(id));
        return f;
    }

    private static String safeName(String n) {
        String s = n == null ? "file" : n.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (s.isEmpty() || s.equals(".") || s.equals("..")) s = "file";
        return s;
    }

    /**
     * Downloaded files. With {dir}: everything in that folder. Without: every file a
     * download recorded (whatever folder it went to) plus the default folder.
     * In-progress ".part" files are only included with {partial:true}.
     */
    @PluginMethod
    public void extrasList(PluginCall call) {
        boolean withPartial = call.getBoolean("partial", false);
        String dirArg = call.getString("dir");
        Map<String, String> byPath = new HashMap<>();
        for (Map.Entry<String, ?> e : meta.getAll().entrySet()) {
            try { byPath.put(new JSONObject(String.valueOf(e.getValue())).optString("path"), e.getKey()); } catch (Exception ignored) {}
        }
        List<File> files = new ArrayList<>();
        java.util.Set<String> seenPaths = new java.util.HashSet<>();
        List<File> dirs = new ArrayList<>();
        dirs.add(dirFor(dirArg));
        for (File d : dirs) {
            File[] fs = d.listFiles();
            if (fs != null) for (File f : fs) if (seenPaths.add(f.getAbsolutePath())) files.add(f);
        }
        if (dirArg == null || dirArg.isEmpty()) {
            for (String pth : byPath.keySet()) {
                for (File f : new File[] { new File(pth), new File(pth + ".part") }) if (f.exists() && seenPaths.add(f.getAbsolutePath())) files.add(f);
            }
        }
        JSArray arr = new JSArray();
        for (File f : files) {
            boolean partial = f.getName().endsWith(".part");
            if (partial && !withPartial) continue;
            String full = partial ? f.getAbsolutePath().substring(0, f.getAbsolutePath().length() - 5) : f.getAbsolutePath();
            String id = byPath.containsKey(full) ? byPath.get(full) : new File(full).getName();
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("name", new File(full).getName());
            o.put("size", f.isDirectory() ? dirSize(f) : f.length());
            o.put("path", f.getAbsolutePath());
            o.put("mtime", f.lastModified());
            o.put("partial", partial);
            o.put("dir", f.isDirectory());
            o.put("active", active.containsKey(id));
            arr.put(o);
        }
        JSObject res = new JSObject();
        res.put("items", arr);
        call.resolve(res);
    }

    private static long dirSize(File d) {
        long n = 0;
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) n += f.isDirectory() ? dirSize(f) : f.length();
        return n;
    }

    @PluginMethod
    public void extrasDownload(final PluginCall call) {
        final String id = call.getString("id");
        final String url = call.getString("url");
        if (id == null || url == null) { call.reject("id and url are required"); return; }
        if (active.containsKey(id)) { call.reject("already downloading " + id, "BUSY"); return; }
        String name = call.getString("name");
        if (name == null || name.isEmpty()) name = Uri.parse(url).getLastPathSegment();
        final File dest = new File(dirFor(call.getString("dir")), safeName(name));
        final String sha = call.getString("sha256", "");
        try {
            meta.edit().putString(id, new JSONObject().put("path", dest.getAbsolutePath()).put("url", url).put("sha256", sha).toString()).apply();
        } catch (Exception ignored) {}
        final AtomicBoolean stop = new AtomicBoolean(false);
        active.put(id, stop);
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            try { requestPermissionForAlias("notifications", call, "noopPerm"); } catch (Exception ignored) {}
        }
        TurdDownloadService.begin(getContext(), id, dest.getName());
        io.execute(() -> {
            try {
                long size = fetchResumable(id, url, dest, sha, stop);
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("path", dest.getAbsolutePath());
                o.put("size", size);
                o.put("verified", !sha.isEmpty());
                emit(id, size, size, "done", null);
                call.resolve(o);
            } catch (Exception e) {
                emit(id, -1, -1, stop.get() ? "cancelled" : "error", e.getMessage());
                call.reject(stop.get() ? "cancelled" : String.valueOf(e.getMessage()), stop.get() ? "CANCELLED" : "DOWNLOAD");
            } finally {
                active.remove(id);
                TurdDownloadService.end(getContext(), id);
            }
        });
    }

    @PermissionCallback
    private void noopPerm(PluginCall call) { /* download keeps running either way */ }

    private long lastEmit = 0;

    private void emit(String id, long received, long total, String state, String err) {
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("received", received);
        o.put("total", total);
        o.put("state", state);
        if (err != null) o.put("error", err);
        notifyListeners("extras:progress", o);
        if (total > 0 && received >= 0) TurdDownloadService.progress(getContext(), id, received, total);
    }

    /** Streams url → dest.part with HTTP Range resume, optional sha256, then renames. */
    private long fetchResumable(String id, String url, File dest, String sha, AtomicBoolean stop) throws Exception {
        File part = new File(dest.getAbsolutePath() + ".part");
        if (dest.exists() && !part.exists()) {
            if (sha.isEmpty() || sha.equalsIgnoreCase(hashFile(dest, null))) return dest.length();
            dest.delete();
        }
        MessageDigest md = sha.isEmpty() ? null : MessageDigest.getInstance("SHA-256");
        int attempt = 0;
        while (true) {
            long have = part.exists() ? part.length() : 0;
            HttpURLConnection c = null;
            try {
                c = open(url, have);
                int code = c.getResponseCode();
                if (code == 416 && have > 0) {   // part already complete
                    c.disconnect();
                    break;
                }
                if (code >= 400) throw new IOException("HTTP " + code);
                boolean resumed = code == 206 && have > 0;
                if (!resumed) { have = 0; if (md != null) md.reset(); }
                else if (md != null) { md.reset(); hashFile(part, md); }   // rebuild digest state over what we already have
                long len = c.getContentLengthLong();
                long total = len < 0 ? -1 : len + have;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part, resumed)) {
                    byte[] buf = new byte[256 * 1024];
                    long got = have;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (stop.get()) throw new IOException("cancelled");
                        out.write(buf, 0, n);
                        if (md != null) md.update(buf, 0, n);
                        got += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit > 400) { lastEmit = now; emit(id, got, total, "downloading", null); }
                    }
                    out.getFD().sync();
                    if (total > 0 && got < total) throw new IOException("connection dropped at " + got + "/" + total);
                }
                break;
            } catch (IOException e) {
                if (stop.get()) throw e;
                if (++attempt > 8) throw e;
                emit(id, part.length(), -1, "retrying", e.getMessage());
                Thread.sleep(Math.min(30000, 1000L << attempt));
            } finally {
                if (c != null) c.disconnect();
            }
        }
        if (md != null) {
            String got = hex(md.digest());
            if (attemptRehash(part, md, got, sha)) { /* ok */ }
            else { part.delete(); throw new IOException("sha256 mismatch: expected " + sha + ", got " + got); }
        }
        emit(id, part.length(), part.length(), "verifying", null);
        if (dest.exists()) dest.delete();
        if (!part.renameTo(dest)) throw new IOException("could not finalise " + dest);
        return dest.length();
    }

    /** The streamed digest misses bytes when a 416 skip happens; fall back to a full re-hash. */
    private boolean attemptRehash(File part, MessageDigest md, String got, String sha) throws Exception {
        if (got.equalsIgnoreCase(sha)) return true;
        return hashFile(part, null).equalsIgnoreCase(sha);
    }

    private static HttpURLConnection open(String url, long from) throws IOException {
        int hops = 0;
        while (true) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", "TURD-Extras/1.0 (Android)");
            if (from > 0) c.setRequestProperty("Range", "bytes=" + from + "-");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null && hops++ < 10) {
                url = new URL(new URL(url), c.getHeaderField("Location")).toString();
                c.disconnect();
                continue;
            }
            return c;
        }
    }

    private static String hashFile(File f, MessageDigest into) throws Exception {
        MessageDigest md = into != null ? into : MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[1024 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        return into != null ? "" : hex(md.digest());
    }

    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
        return s.toString();
    }

    @PluginMethod
    public void extrasCancel(PluginCall call) {
        AtomicBoolean s = active.get(call.getString("id", ""));
        if (s != null) s.set(true);
        call.resolve(ok());
    }

    @PluginMethod
    public void extrasRemove(PluginCall call) {
        String id = call.getString("id", "");
        AtomicBoolean s = active.get(id);
        if (s != null) s.set(true);
        File f = fileOf(id);
        deleteRec(f);
        deleteRec(new File(f.getAbsolutePath() + ".part"));
        String n = f.getName();
        if (n.toLowerCase(Locale.ROOT).endsWith(".zip")) deleteRec(new File(f.getParentFile(), n.substring(0, n.length() - 4)));
        meta.edit().remove(id).apply();
        call.resolve(ok());
    }

    private static void deleteRec(File f) {
        if (f.isDirectory()) { File[] fs = f.listFiles(); if (fs != null) for (File c : fs) deleteRec(c); }
        f.delete();
    }

    @PluginMethod
    public void extrasOpen(PluginCall call) {
        File f = fileOf(call.getString("id", ""));
        if (!f.exists()) { call.reject("not downloaded yet", "MISSING"); return; }
        Activity a = getActivity();
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            String ext = MimeTypeMap.getFileExtensionFromUrl(f.getName()).toLowerCase(Locale.ROOT);
            if (ext.isEmpty() && f.getName().contains(".")) ext = f.getName().substring(f.getName().lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
            if (ext.equals("apk")) {
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                    call.reject("Allow T.U.R.D. to install apps, then tap install again.", "INSTALL_PERMISSION");
                    return;
                }
                Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                a.startActivity(i);
            } else {
                String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime == null ? "*/*" : mime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                a.startActivity(Intent.createChooser(i, f.getName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            call.resolve(ok());
        } catch (Exception e) {
            call.reject("cannot open: " + e.getMessage());
        }
    }

    @PluginMethod
    public void extrasReadText(PluginCall call) {
        File f = fileOf(call.getString("id", ""));
        try (InputStream in = new FileInputStream(f)) {
            JSObject o = new JSObject();
            o.put("text", new String(readAll(in, 8 * 1024 * 1024), StandardCharsets.UTF_8));
            call.resolve(o);
        } catch (Exception e) {
            call.reject("cannot read: " + e.getMessage());
        }
    }

    /** Random access for in-place readers (ZIM): base64 of [offset, offset+length), 64-bit offsets. */
    @PluginMethod
    public void extrasReadRange(final PluginCall call) {
        final String id = call.getString("id", "");
        final long off = call.getData().optLong("offset", 0);
        final int len = (int) Math.max(0, Math.min(16L * 1024 * 1024, call.getData().optLong("length", 0)));
        io.execute(() -> {
            File f = fileOf(id);
            try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r")) {
                long size = raf.length();
                int n = (int) Math.max(0, Math.min(len, size - off));
                byte[] buf = new byte[n];
                raf.seek(off);
                raf.readFully(buf);
                JSObject o = new JSObject();
                o.put("data", Base64.encodeToString(buf, Base64.NO_WRAP));
                o.put("size", size);
                call.resolve(o);
            } catch (Exception e) {
                call.reject("read failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void extrasUnzip(final PluginCall call) {
        final String id = call.getString("id", "");
        io.execute(() -> {
            File f = fileOf(id);
            String n = f.getName();
            File out = new File(f.getParentFile(), n.toLowerCase(Locale.ROOT).endsWith(".zip") ? n.substring(0, n.length() - 4) : n + "_files");
            try (ZipInputStream z = new ZipInputStream(new FileInputStream(f))) {
                String root = out.getCanonicalPath() + File.separator;
                ZipEntry e;
                byte[] buf = new byte[256 * 1024];
                while ((e = z.getNextEntry()) != null) {
                    File t = new File(out, e.getName());
                    if (!t.getCanonicalPath().startsWith(root)) throw new IOException("unsafe path in zip: " + e.getName());
                    if (e.isDirectory()) { t.mkdirs(); continue; }
                    t.getParentFile().mkdirs();
                    try (FileOutputStream os = new FileOutputStream(t)) { int k; while ((k = z.read(buf)) > 0) os.write(buf, 0, k); }
                }
                JSObject o = new JSObject();
                o.put("dir", out.getAbsolutePath());
                call.resolve(o);
            } catch (Exception e) {
                call.reject("unzip failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void isInstalled(PluginCall call) {
        JSObject m = new JSObject();
        PackageManager pm = getContext().getPackageManager();
        try {
            JSONArray ids = call.getArray("ids", new JSArray());
            for (int i = 0; i < ids.length(); i++) {
                String p = ids.getString(i);
                try {
                    PackageInfo pi = pm.getPackageInfo(p, 0);
                    m.put(p, pi.versionName == null ? "installed" : pi.versionName);
                } catch (PackageManager.NameNotFoundException e) {
                    m.put(p, JSONObject.NULL);
                }
            }
        } catch (Exception ignored) {}
        JSObject res = new JSObject();
        res.put("map", m);
        call.resolve(res);
    }

    @PluginMethod
    public void launch(PluginCall call) {
        String pkg = call.getString("pkg", "");
        Intent i = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { call.reject(pkg + " is not installed", "MISSING"); return; }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(i);
        call.resolve(ok());
    }

    @PluginMethod
    public void winget(PluginCall call) { call.reject("winget is Windows-only", "UNSUPPORTED"); }

    @PluginMethod
    public void spawn(PluginCall call) { call.reject("spawn is Windows-only", "UNSUPPORTED"); }

    @PluginMethod
    public void kill(PluginCall call) { call.reject("kill is Windows-only", "UNSUPPORTED"); }

    /* ================================================================ util */

    private static JSObject ok() { JSObject o = new JSObject(); o.put("ok", true); return o; }

    private static byte[] readAll(InputStream in, int max) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            bo.write(buf, 0, n);
            if (bo.size() > max) throw new IOException("response larger than " + (max >> 20) + " MB");
        }
        in.close();
        return bo.toByteArray();
    }
}
