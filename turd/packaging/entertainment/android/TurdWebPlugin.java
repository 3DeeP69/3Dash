package app.turd.hud.ent;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.os.Message;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * T.U.R.D. Entertainment — native in-app web views for Android.
 *
 * Real sites (YouTube, TikTok, …) run in native WebViews laid exactly over the
 * Entertainment viewer in the Capacitor page, with:
 *  - a network shield (shouldInterceptRequest answers blocked hosts/paths with an empty 204),
 *  - the shield page script injected at document-start (ad payload stripping, clean mode),
 *  - every link kept in the same view; intent:// and app-store hops refused,
 *  - a desktop-grade user agent without the "; wv" marker, so sites don't nag "open the app",
 *  - dark first frame and reveal-on-paint, so there is no white flash or site splash,
 *  - warm views pre-rendered off-screen for instant open,
 *  - fullscreen video and the hardware back button handled natively.
 *
 * JS side: web/src/sections/ent/bridge.js (Capacitor.registerPlugin("TurdWeb")).
 */
@CapacitorPlugin(name = "TurdWeb")
public class TurdWebPlugin extends Plugin {

    private static final int BG = 0xFF05070D;
    private static final String PAUSE_MEDIA =
        "try{document.querySelectorAll('video,audio').forEach(function(m){try{m.pause()}catch(e){}})}catch(e){}";
    private static final Pattern APP_FALLBACK = Pattern.compile("S\\.browser_fallback_url=([^;]+)");

    /** Block list shared by every view (replaced whenever JS sends rules). */
    private static volatile List<String> blockHosts = new ArrayList<>();
    private static volatile List<String> blockPaths = new ArrayList<>();

    private final Map<String, Entry> views = new LinkedHashMap<>();
    private FrameLayout layer;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private OnBackPressedCallback backCallback;

    private static final class Entry {
        String id, home, url = "", title = "";
        WebView web;
        boolean loading = true, painted = false, wantVisible = false, canBack = false, canForward = false;
        int x, y, w, h;
        final AtomicLong blocked = new AtomicLong();
    }

    /* ---------------------------------------------------------------- lifecycle */

    @Override
    public void load() {
        backCallback = new OnBackPressedCallback(false) {
            @Override public void handleOnBackPressed() { onBack(); }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), backCallback);
    }

    private FrameLayout layer() {
        if (layer == null) {
            Activity a = getActivity();
            ViewGroup content = a.findViewById(android.R.id.content);
            layer = new FrameLayout(a);
            layer.setClipChildren(true);
            content.addView(layer, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        return layer;
    }

    private void refreshBack() {
        boolean any = customView != null;
        for (Entry e : views.values()) any |= e.wantVisible;
        if (backCallback != null) backCallback.setEnabled(any);
    }

    /* ---------------------------------------------------------------- rules */

    private static void setRules(JSONObject rules) {
        if (rules == null) return;
        blockHosts = strings(rules.optJSONArray("hosts"));
        blockPaths = strings(rules.optJSONArray("paths"));
    }

    private static List<String> strings(JSONArray a) {
        List<String> out = new ArrayList<>();
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) {
            String s = a.optString(i, "");
            if (!s.isEmpty()) out.add(s.toLowerCase(Locale.ROOT));
        }
        return out;
    }

    /** Same matcher as isBlocked() in shield.js and Rules::blocks() in the Windows build. */
    static boolean blocks(Uri u) {
        String scheme = u.getScheme();
        if (scheme == null || !(scheme.startsWith("http") || scheme.startsWith("ws"))) return false;
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        for (String d : blockHosts) {
            if (host.equals(d) || host.endsWith("." + d)) return true;
        }
        String hp = host + (u.getEncodedPath() == null ? "" : u.getEncodedPath()) + (u.getEncodedQuery() == null ? "" : "?" + u.getEncodedQuery());
        for (String p : blockPaths) {
            if (p.indexOf('*') >= 0) {
                boolean all = true;
                for (String part : p.split("\\*")) if (!hp.contains(part)) { all = false; break; }
                if (all) return true;
            } else if (hp.contains(p)) return true;
        }
        return false;
    }

    /** Sign-in pages that must open as a real pop-up (they talk back to the page that opened them). */
    static boolean isAuth(String url) {
        Uri u = Uri.parse(url);
        String h = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        String p = u.getPath() == null ? "" : u.getPath();
        return h.equals("accounts.google.com") || h.equals("appleid.apple.com") || h.equals("login.live.com")
            || h.equals("login.microsoftonline.com") || h.equals("id.twitch.tv") || h.equals("accounts.snapchat.com")
            || (h.endsWith("facebook.com") && (p.contains("/dialog/oauth") || p.startsWith("/login")))
            || ((h.equals("twitter.com") || h.equals("x.com") || h.equals("api.twitter.com")) && p.contains("oauth"))
            || (h.equals("discord.com") && p.startsWith("/oauth2"));
    }

    /* ---------------------------------------------------------------- geometry */

    /** CSS px of the Capacitor page → physical px inside our overlay layer. */
    private void place(Entry e) {
        if (e.web == null) return;
        float d = getActivity().getResources().getDisplayMetrics().density;
        int[] page = new int[2], lay = new int[2];
        getBridge().getWebView().getLocationOnScreen(page);
        layer().getLocationOnScreen(lay);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.max(1, Math.round(e.w * d)), Math.max(1, Math.round(e.h * d)));
        lp.leftMargin = page[0] - lay[0] + Math.round(e.x * d);
        lp.topMargin = page[1] - lay[1] + Math.round(e.y * d);
        e.web.setLayoutParams(lp);
    }

    private void readRect(Entry e, PluginCall call) {
        if (call.getData().has("x")) {
            e.x = call.getDouble("x", 0.0).intValue();
            e.y = call.getDouble("y", 0.0).intValue();
            e.w = call.getDouble("w", 1.0).intValue();
            e.h = call.getDouble("h", 1.0).intValue();
        }
    }

    private void reveal(Entry e) {
        if (e.web == null) return;
        for (Entry o : views.values()) if (o != e && o.web != null && o.web.getVisibility() == View.VISIBLE) hideEntry(o);
        place(e);
        if (e.web.getVisibility() != View.VISIBLE) {
            e.web.setAlpha(0f);
            e.web.setVisibility(View.VISIBLE);
            e.web.animate().alpha(1f).setDuration(160).start();
        }
        e.web.requestFocus();
        refreshBack();
    }

    private void hideEntry(Entry e) {
        e.wantVisible = false;
        if (e.web != null) {
            e.web.evaluateJavascript(PAUSE_MEDIA, null);
            e.web.setVisibility(View.INVISIBLE);   // INVISIBLE keeps it laid out + pre-rendered (warm)
        }
        refreshBack();
    }

    /* ---------------------------------------------------------------- web view */

    private static String cleanUserAgent(String ua) {
        // "; wv" and "Version/4.0" mark an embedded WebView; sites answer with app nags or
        // "this browser isn't supported". Without them it reads as regular Chrome.
        return ua.replace("; wv)", ")").replaceAll("Version/\\d+\\.\\d+ ", "");
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView create(final Entry e, String script, boolean shield) {
        final Activity a = getActivity();
        WebView w = new WebView(a);
        w.setBackgroundColor(BG);
        w.setVisibility(View.INVISIBLE);
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Pop-ups: sign-in windows (Google, Apple, …) open as a real pop-up so "Log in with Google"
        // works; anything else loads right here in the same view (see onCreateWindow).
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(cleanUserAgent(s.getUserAgentString()));
        s.setOffscreenPreRaster(true);                // warm views are already painted when shown
        // Google refuses sign-in when it sees X-Requested-With: <package>; send it to no one.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            WebSettingsCompat.setRequestedWithHeaderOriginAllowList(s, Collections.<String>emptySet());
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);

        boolean docStart = false;
        if (shield && script != null && !script.isEmpty() && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, script, Collections.singleton("*"));
            docStart = true;
        }
        final boolean injectLate = shield && !docStart && script != null && !script.isEmpty();
        final String lateScript = script;

        w.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (shield && blocks(req.getUrl())) {
                    e.blocked.incrementAndGet();
                    Map<String, String> h = new HashMap<>();
                    h.put("Access-Control-Allow-Origin", "*");
                    return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", h, new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String sch = u.getScheme() == null ? "" : u.getScheme();
                if (sch.equals("http") || sch.equals("https") || sch.equals("about") || sch.equals("data") || sch.equals("blob")) return false;
                // "open in the app" — stay here, follow the web fallback if the link carries one
                Matcher m = APP_FALLBACK.matcher(u.toString());
                if (m.find()) view.loadUrl(Uri.decode(m.group(1)));
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                e.loading = true;
                e.url = url;
                if (injectLate) view.evaluateJavascript(lateScript, null);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                if (!e.painted) {
                    e.painted = true;
                    if (e.wantVisible) reveal(e);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                e.loading = false;
                e.url = url;
                if (!e.painted) {
                    e.painted = true;
                    if (e.wantVisible) reveal(e);
                }
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                e.url = url;
                e.canBack = view.canGoBack();
                e.canForward = view.canGoForward();
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            @Override public void onReceivedTitle(WebView view, String title) { e.title = title == null ? "" : title; }

            @Override public void onProgressChanged(WebView view, int p) { e.loading = p < 100; }

            @Override
            public void onPermissionRequest(PermissionRequest r) {
                // protected media (DRM) only; camera/mic stay denied
                for (String res : r.getResources()) {
                    if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(res)) {
                        r.grant(new String[] { PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID });
                        return;
                    }
                }
                r.deny();
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback cb) {
                if (customView != null) { cb.onCustomViewHidden(); return; }
                customView = view;
                customCallback = cb;
                ViewGroup decor = (ViewGroup) a.getWindow().getDecorView();
                view.setBackgroundColor(0xFF000000);
                decor.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                systemBars(false);
                refreshBack();
            }

            @Override
            public void onHideCustomView() { exitFullscreen(); }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                final WebView pop = new WebView(a);
                pop.setBackgroundColor(BG);
                WebSettings ps = pop.getSettings();
                ps.setJavaScriptEnabled(true);
                ps.setDomStorageEnabled(true);
                ps.setUserAgentString(view.getSettings().getUserAgentString());
                ps.setJavaScriptCanOpenWindowsAutomatically(true);
                if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
                    WebSettingsCompat.setRequestedWithHeaderOriginAllowList(ps, Collections.<String>emptySet());
                }
                CookieManager.getInstance().setAcceptThirdPartyCookies(pop, true);
                final Dialog[] dlg = new Dialog[1];
                pop.setWebViewClient(new WebViewClient() {
                    boolean decided = false;
                    private boolean decide(WebView v, String url) {
                        if (decided || url == null || url.isEmpty() || url.startsWith("about:")) return false;
                        decided = true;
                        if (isAuth(url)) {
                            Dialog d = new Dialog(a, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
                            d.setContentView(pop);
                            d.setOnDismissListener(x -> pop.destroy());
                            dlg[0] = d;
                            d.show();
                            return false;
                        }
                        // not a sign-in: same view, no pop-up
                        if (url.startsWith("http://") || url.startsWith("https://")) view.loadUrl(url);
                        v.post(v::destroy);
                        return true;
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return decide(v, r.getUrl().toString()); }
                    @Override public void onPageStarted(WebView v, String url, Bitmap f) { decide(v, url); }
                });
                pop.setWebChromeClient(new WebChromeClient() {
                    @Override public void onCloseWindow(WebView w) { if (dlg[0] != null) dlg[0].dismiss(); }
                });
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(pop);
                resultMsg.sendToTarget();
                return true;
            }
        });
        return w;
    }

    private void systemBars(boolean show) {
        Activity a = getActivity();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = a.getWindow().getInsetsController();
            if (c == null) return;
            if (show) c.show(WindowInsets.Type.systemBars());
            else {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            a.getWindow().getDecorView().setSystemUiVisibility(show ? View.SYSTEM_UI_FLAG_VISIBLE
                : View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    private void exitFullscreen() {
        if (customView == null) return;
        ((ViewGroup) getActivity().getWindow().getDecorView()).removeView(customView);
        customView = null;
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
        systemBars(true);
        refreshBack();
    }

    private void onBack() {
        if (customView != null) { exitFullscreen(); return; }
        for (Entry e : views.values()) {
            if (e.wantVisible && e.web != null) {
                if (e.web.canGoBack()) e.web.goBack();
                else {
                    JSObject o = new JSObject();
                    o.put("id", e.id);
                    notifyListeners("backAtRoot", o);
                }
                return;
            }
        }
    }

    /* ---------------------------------------------------------------- plugin methods */

    @PluginMethod
    public void open(final PluginCall call) {
        final String id = call.getString("id");
        final String url = call.getString("url");
        if (id == null || url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("id and an http(s) url are required");
            return;
        }
        try { setRules(call.getData().optJSONObject("rules")); } catch (Exception ignored) {}
        getActivity().runOnUiThread(() -> {
            Entry e = views.get(id);
            boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", false));
            if (e == null) {
                e = new Entry();
                e.id = id;
                e.home = url;
                readRect(e, call);
                e.wantVisible = visible;
                e.web = create(e, call.getString("script", ""), Boolean.TRUE.equals(call.getBoolean("shield", true)));
                layer().addView(e.web);
                place(e);
                views.put(id, e);
                e.web.loadUrl(url);
            } else {
                readRect(e, call);
                e.wantVisible = visible;
                if (!url.equals(e.url)) e.web.loadUrl(url);
                if (visible && e.painted) reveal(e);
            }
            refreshBack();
            call.resolve();
        });
    }

    @PluginMethod
    public void bounds(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Entry e = views.get(call.getString("id", ""));
            if (e != null) { readRect(e, call); place(e); }
            call.resolve();
        });
    }

    @PluginMethod
    public void show(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Entry e = views.get(call.getString("id", ""));
            if (e != null) {
                readRect(e, call);
                e.wantVisible = true;
                if (e.painted) reveal(e); else place(e);
            }
            refreshBack();
            call.resolve();
        });
    }

    @PluginMethod
    public void hide(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Entry e = views.get(call.getString("id", ""));
            if (e != null) hideEntry(e);
            call.resolve();
        });
    }

    @PluginMethod
    public void hideAll(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            exitFullscreen();
            for (Entry e : views.values()) hideEntry(e);
            call.resolve();
        });
    }

    @PluginMethod
    public void nav(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Entry e = views.get(call.getString("id", ""));
            if (e == null || e.web == null) { call.reject("no such view"); return; }
            String action = call.getString("action", "");
            switch (action) {
                case "back": if (e.web.canGoBack()) e.web.goBack(); break;
                case "forward": if (e.web.canGoForward()) e.web.goForward(); break;
                case "reload": e.web.reload(); break;
                case "home": e.web.loadUrl(e.home); break;
                case "go": {
                    String u = call.getString("url", "");
                    if (u.startsWith("http://") || u.startsWith("https://")) e.web.loadUrl(u);
                    break;
                }
                default: call.reject("unknown action"); return;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void close(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Entry e = views.remove(call.getString("id", ""));
            if (e != null && e.web != null) {
                layer().removeView(e.web);
                e.web.destroy();
            }
            refreshBack();
            call.resolve();
        });
    }

    @PluginMethod
    public void state(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject all = new JSObject();
            for (Entry e : views.values()) {
                JSObject o = new JSObject();
                o.put("url", e.url);
                o.put("title", e.title);
                o.put("loading", e.loading);
                o.put("blocked", e.blocked.get());
                o.put("canBack", e.canBack);
                o.put("canForward", e.canForward);
                o.put("visible", e.wantVisible);
                all.put(e.id, o);
            }
            JSObject r = new JSObject();
            r.put("views", all);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void rules(final PluginCall call) {
        setRules(call.getData().optJSONObject("rules"));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (Entry e : views.values()) if (e.web != null) e.web.destroy();
        views.clear();
    }
}
