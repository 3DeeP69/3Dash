package app.turd.hud;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(app.turd.hud.ent.TurdWebPlugin.class);
        registerPlugin(TurdNativePlugin.class);
        super.onCreate(savedInstanceState);

        // the helmet visor owns the whole screen: edge to edge, system bars hidden
        // until swiped in (they slide back out on their own)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        immersive();

        WebView wv = getBridge().getWebView();
        wv.setBackgroundColor(0xFF03060D);
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = wv.getSettings();
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);                       // system font scaling would break the HUD layout
        if (Build.VERSION.SDK_INT >= 26) wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
    }

    private void immersive() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();               // e.g. after a permission dialog or unfolding the Fold4
    }
}
