package app.turd.hud;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * "Fold status on the PC": battery %, charging, free storage, last seen.
 * snapshot() reads it (no permissions needed), post() sends it to the chat server
 * on the PC (POST /api/devstatus, server/devstatus.js). While the app is closed,
 * {@link Job} reports every ~30 min through JobScheduler, which Android batches
 * with other work and only runs on a network, so it costs almost no battery.
 */
public final class TurdStatus {
    static final int JOB_ID = 0x7D2D;
    private static final String PREFS = "turd_status";

    private TurdStatus() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static String deviceId(Context c) {
        SharedPreferences p = prefs(c);
        String id = p.getString("id", null);
        if (id == null) { id = UUID.randomUUID().toString().substring(0, 12); p.edit().putString("id", id).apply(); }
        return id;
    }

    static String deviceName(Context c) {
        String n = null;
        try { n = Settings.Global.getString(c.getContentResolver(), "device_name"); } catch (Exception ignored) {}
        if (n == null || n.isEmpty()) n = Build.MODEL;
        return n;
    }

    static JSONObject snapshot(Context c) {
        JSONObject o = new JSONObject();
        try {
            Intent b = c.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level = b == null ? -1 : b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = b == null ? -1 : b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int status = b == null ? -1 : b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            int plug = b == null ? 0 : b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            int temp = b == null ? Integer.MIN_VALUE : b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
            o.put("id", deviceId(c));
            o.put("name", deviceName(c));
            o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
            o.put("battery", level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : JSONObject.NULL);
            o.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
            o.put("full", status == BatteryManager.BATTERY_STATUS_FULL);
            o.put("plug", plug == BatteryManager.BATTERY_PLUGGED_AC ? "ac" : plug == BatteryManager.BATTERY_PLUGGED_USB ? "usb"
                    : plug == BatteryManager.BATTERY_PLUGGED_WIRELESS ? "wireless" : plug != 0 ? "other" : "none");
            if (temp != Integer.MIN_VALUE) o.put("tempC", temp / 10.0);
            StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
            o.put("storageFreeGB", Math.round(fs.getAvailableBytes() / 1e8) / 10.0);
            o.put("storageTotalGB", Math.round(fs.getTotalBytes() / 1e8) / 10.0);
            o.put("ts", System.currentTimeMillis());
        } catch (Exception ignored) {}
        return o;
    }

    /** Remember where to report; enabled=false (or no token) cancels the background job. */
    static void configure(Context c, String url, String token, boolean enabled, int minutes) {
        prefs(c).edit().putString("url", url).putString("token", token).putBoolean("on", enabled).apply();
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        if (!enabled || url == null || url.isEmpty() || token == null || token.isEmpty()) { js.cancel(JOB_ID); return; }
        long every = Math.max(15, minutes) * 60_000L;
        JobInfo.Builder jb = new JobInfo.Builder(JOB_ID, new ComponentName(c, Job.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(false)
                .setPeriodic(every, every / 2);
        js.schedule(jb.build());
    }

    /** POST the snapshot. Returns the HTTP status (or -1). A 401 turns background reports off until the next sign-in. */
    static int post(Context c) {
        SharedPreferences p = prefs(c);
        String url = p.getString("url", ""), token = p.getString("token", "");
        if (url == null || url.isEmpty() || token == null || token.isEmpty()) return -1;
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(url.replaceAll("/+$", "") + "/api/devstatus").openConnection();
            h.setConnectTimeout(4000);
            h.setReadTimeout(5000);
            h.setRequestMethod("POST");
            h.setDoOutput(true);
            h.setRequestProperty("content-type", "application/json");
            h.setRequestProperty("authorization", "Bearer " + token);
            byte[] body = snapshot(c).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = h.getOutputStream()) { out.write(body); }
            int code = h.getResponseCode();
            if (code == 401 || code == 403) configure(c, url, "", false, 30);
            return code;
        } catch (Exception e) {
            return -1;
        } finally {
            if (h != null) h.disconnect();
        }
    }

    /** Background reporter (registered in AndroidManifest.xml with BIND_JOB_SERVICE). */
    public static class Job extends JobService {
        @Override
        public boolean onStartJob(JobParameters params) {
            final Context c = getApplicationContext();
            new Thread(() -> {
                post(c);
                jobFinished(params, false);
            }, "turd-status").start();
            return true;
        }

        @Override
        public boolean onStopJob(JobParameters params) { return false; }
    }
}
