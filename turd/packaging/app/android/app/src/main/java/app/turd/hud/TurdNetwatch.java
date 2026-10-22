package app.turd.hud;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.RouteInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.FileReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.ConnectException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Home network watch on the Fold: which devices are on this Wi-Fi. Android 10+ hides the
 * ARP table from apps, so liveness comes from a ping (unprivileged ICMP) plus quick TCP
 * probes, where "connection refused" also proves a host is there. Names come from NetBIOS
 * node status (which also reveals Windows PCs' MACs) and reverse DNS from the router.
 * 24 threads, short timeouts: about 10-20 s for a /24.
 */
final class TurdNetwatch {
    private static final int[] PORTS = {80, 443, 62078, 8009, 445, 22, 7000, 8080};

    private TurdNetwatch() {}

    static JSONObject scan(Context ctx) throws Exception {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        Network n = cm.getActiveNetwork();
        LinkProperties lp = n == null ? null : cm.getLinkProperties(n);
        if (lp == null) throw new IllegalStateException("Not connected to Wi-Fi");
        Inet4Address me = null;
        int prefix = 24;
        for (LinkAddress la : lp.getLinkAddresses()) {
            if (la.getAddress() instanceof Inet4Address && !la.getAddress().isLoopbackAddress()) {
                me = (Inet4Address) la.getAddress();
                prefix = la.getPrefixLength();
                break;
            }
        }
        if (me == null) throw new IllegalStateException("Not connected to Wi-Fi");
        String gw = null;
        for (RouteInfo r : lp.getRoutes()) {
            if (r.isDefaultRoute() && r.getGateway() instanceof Inet4Address) { gw = r.getGateway().getHostAddress(); break; }
        }
        byte[] b = me.getAddress();
        final String base = (b[0] & 255) + "." + (b[1] & 255) + "." + (b[2] & 255) + ".";
        final String self = me.getHostAddress();
        final List<JSONObject> found = java.util.Collections.synchronizedList(new ArrayList<>());
        ExecutorService pool = Executors.newFixedThreadPool(24);
        final String gwf = gw;
        for (int i = 1; i < 255; i++) {
            final String ip = base + i;
            if (ip.equals(self)) continue;
            pool.execute(() -> {
                try {
                    JSONObject row = probe(ip);
                    if (row != null) { row.put("gateway", ip.equals(gwf)); found.add(row); }
                } catch (Exception ignored) {}
            });
        }
        pool.shutdown();
        pool.awaitTermination(60, TimeUnit.SECONDS);
        pool.shutdownNow();

        // some phones (older Android, custom ROMs) still expose the neighbour table
        Map<String, String> arp = readArp();
        JSONArray items = new JSONArray();
        List<JSONObject> rows = new ArrayList<>(found);
        rows.sort((x, y) -> Integer.compare(last(x.optString("ip")), last(y.optString("ip"))));
        for (JSONObject r : rows) {
            if (r.optString("mac").isEmpty() && arp.containsKey(r.optString("ip"))) r.put("mac", arp.get(r.optString("ip")));
            items.put(r);
        }
        JSONObject meRow = new JSONObject();
        meRow.put("ip", self).put("mac", "").put("vendor", "").put("hostname", TurdStatus.deviceName(ctx)).put("gateway", false).put("self", true);
        items.put(meRow);
        JSONObject o = new JSONObject();
        o.put("items", items);
        o.put("subnet", base + "0/24");
        o.put("prefix", prefix);
        o.put("gateway", gw == null ? JSONObject.NULL : gw);
        o.put("macs", !arp.isEmpty());
        return o;
    }

    private static int last(String ip) {
        try { return Integer.parseInt(ip.substring(ip.lastIndexOf('.') + 1)); } catch (Exception e) { return 0; }
    }

    private static JSONObject probe(String ip) throws Exception {
        InetAddress a = InetAddress.getByName(ip);
        long t0 = System.nanoTime();
        boolean alive = false;
        try { alive = a.isReachable(350); } catch (Exception ignored) {}
        if (!alive) {
            for (int p : PORTS) {
                try (Socket s = new Socket()) {
                    s.connect(new InetSocketAddress(a, p), 180);
                    alive = true;
                } catch (ConnectException refused) {
                    alive = true;               // RST: something is there, the port is just closed
                } catch (Exception ignored) {}
                if (alive) break;
            }
        }
        String[] nb = netbios(a, 300);
        if (!alive && nb == null) return null;
        long rtt = (System.nanoTime() - t0) / 1_000_000;
        String name = nb != null ? nb[0] : "";
        if (name.isEmpty()) {
            try {
                String h = a.getCanonicalHostName();
                if (h != null && !h.equals(ip)) name = h.replaceAll("\\.$", "");
            } catch (Exception ignored) {}
        }
        JSONObject o = new JSONObject();
        o.put("ip", ip).put("mac", nb != null ? nb[1] : "").put("vendor", "").put("hostname", name).put("self", false).put("rttMs", rtt);
        return o;
    }

    /** NetBIOS node status (NBSTAT, UDP 137): {name, mac} or null. */
    static String[] netbios(InetAddress a, int timeoutMs) {
        try (DatagramSocket s = new DatagramSocket()) {
            s.setSoTimeout(timeoutMs);
            byte[] q = new byte[50];
            q[0] = 0x7D; q[1] = 0x2D; q[5] = 1; q[12] = 0x20; q[13] = 'C'; q[14] = 'K';
            for (int i = 15; i < 45; i++) q[i] = 'A';
            q[46] = 0; q[47] = 0x21; q[48] = 0; q[49] = 1;
            s.send(new DatagramPacket(q, q.length, a, 137));
            byte[] buf = new byte[1024];
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            s.receive(p);
            int n = p.getLength();
            if (n < 57) return null;
            int count = buf[56] & 255;
            String name = "";
            for (int i = 0; i < count; i++) {
                int o = 57 + i * 18;
                if (o + 18 > n) break;
                if (buf[o + 15] == 0 && (buf[o + 16] & 0x80) == 0) { name = new String(buf, o, 15, "US-ASCII").trim(); break; }
            }
            int o = 57 + count * 18;
            String mac = "";
            if (o + 6 <= n) {
                StringBuilder sb = new StringBuilder();
                boolean zero = true;
                for (int i = 0; i < 6; i++) { if (i > 0) sb.append(':'); sb.append(String.format("%02X", buf[o + i] & 255)); if (buf[o + i] != 0) zero = false; }
                if (!zero) mac = sb.toString();
            }
            return new String[]{name, mac};
        } catch (Exception e) {
            return null;
        }
    }

    private static Map<String, String> readArp() {
        Map<String, String> m = new HashMap<>();
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/net/arp"))) {
            String line = r.readLine();
            while ((line = r.readLine()) != null) {
                String[] f = line.trim().split("\\s+");
                if (f.length >= 4 && !f[3].equals("00:00:00:00:00:00")) m.put(f[0], f[3].toUpperCase());
            }
        } catch (Exception ignored) {}
        return m;
    }
}
