package app.turd.hud;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Keeps T.U.R.D. alive while Extras downloads run (some are 100+ GB), with one
 * progress notification. The downloads themselves run in TurdNativePlugin; this
 * service only holds the process in the foreground and a partial wake lock.
 */
public class TurdDownloadService extends Service {

    private static final String CH = "turd_downloads";
    private static final int NID = 4711;
    private static final Map<String, long[]> jobs = new ConcurrentHashMap<>();
    private static final Map<String, String> names = new ConcurrentHashMap<>();
    private static long lastNotify = 0;
    private PowerManager.WakeLock wake;

    static void begin(Context c, String id, String name) {
        jobs.put(id, new long[] { 0, -1 });
        names.put(id, name);
        try { ContextCompat.startForegroundService(c, new Intent(c, TurdDownloadService.class)); } catch (Exception ignored) {}
    }

    static void progress(Context c, String id, long got, long total) {
        long[] j = jobs.get(id);
        if (j == null) return;
        j[0] = got; j[1] = total;
        long now = System.currentTimeMillis();
        if (now - lastNotify < 1500) return;
        lastNotify = now;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.notify(NID, build(c)); } catch (Exception ignored) {}
    }

    static void end(Context c, String id) {
        jobs.remove(id);
        names.remove(id);
        if (jobs.isEmpty()) c.stopService(new Intent(c, TurdDownloadService.class));
        else progress(c, jobs.keySet().iterator().next(), -1, -1);
    }

    private static Notification build(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            nm.createNotificationChannel(new NotificationChannel(CH, "Downloads", NotificationManager.IMPORTANCE_LOW));
        }
        long got = 0, total = 0;
        boolean unknown = false;
        for (long[] j : jobs.values()) { got += Math.max(0, j[0]); if (j[1] > 0) total += j[1]; else unknown = true; }
        String title = jobs.size() == 1 ? "Downloading " + names.values().iterator().next() : "Downloading " + jobs.size() + " files";
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(total > 0 ? fmt(got) + " of " + fmt(total) : fmt(got))
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setContentIntent(pi);
        if (total > 0 && !unknown) b.setProgress(1000, (int) (got * 1000 / total), false);
        else b.setProgress(0, 0, true);
        return b.build();
    }

    private static String fmt(long b) {
        if (b >= 1L << 30) return String.format(java.util.Locale.ROOT, "%.1f GB", b / (double) (1L << 30));
        if (b >= 1L << 20) return String.format(java.util.Locale.ROOT, "%.0f MB", b / (double) (1L << 20));
        return (b >> 10) + " KB";
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = build(this);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NID, n);
        if (wake == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "turd:downloads");
            wake.setReferenceCounted(false);
            wake.acquire(12 * 60 * 60 * 1000L);
        }
        if (jobs.isEmpty()) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
