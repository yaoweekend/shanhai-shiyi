package com.wuqijiangye.shanhai;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLConnection;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 山海拾遗 · WebView 容器。
 *
 * 设计约束（对应规格 §15）：
 *  ① 严格不联网：页面从内部虚拟域名加载，由本类直接从 APK 的 assets 返回，
 *     请求不会离开设备。不引入任何需要网络的 SDK/依赖。
 *  ② 零第三方依赖：不使用 AndroidX（本地 WebView 缓存里没有 androidx.webkit，
 *     照抄 AndroidX 方案会导致构建时必须联网拉依赖）。资源拦截自己实现。
 *  ③ 横屏 + 沉浸式全屏：血条与按钮不被状态栏/导航栏切掉。
 *  ④ 老内核降级：WebView 能力不足时，页面内的启动自检会显示提示页而不是白屏。
 */
public class MainActivity extends Activity {

    // 内部虚拟域名：只被本 Activity 拦截，不对应任何真实主机
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ENTRY_URL = "https://" + ASSET_HOST + "/assets/index.html";

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 横屏（manifest 里已锁定，这里再兜一层）
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(0xFF0B0A0E);
        setContentView(root);

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage：断点续局/图鉴/试炼进度靠它
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);           // 不需要读设备文件
        s.setAllowContentAccess(false);
        s.setLoadsImagesAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(true); // 音频仍然必须由用户手势解锁
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        web.setBackgroundColor(0xFF0B0A0E);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.i("ShanhaiWeb", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        // debug / devultimate 变体：允许 adb 通过 Chrome DevTools Protocol 连进来。
        // release 正式包这段被关掉，不产生任何行为。
        if (BuildConfig.DEBUG || BuildConfig.DEV_ULTIMATE) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        if (BuildConfig.DEBUG) {
            pageReadyProbe();
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // 本地资源一律自己喂；其余（理论上不该出现）走系统，但因为没有任何外部引用，不会发生
                if (request != null && request.getUrl() != null
                        && ASSET_HOST.equals(request.getUrl().getHost())) {
                    return serveFromAssets(request.getUrl().getPath());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 不允许离开本地页面（严格不联网）
                return request != null && request.getUrl() != null
                        && !ASSET_HOST.equals(request.getUrl().getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                goImmersive();
            }
        });

        // devultimate 变体：入口 URL 带上 ?dev=...，让页面开局进入
        // "四把武器满级 + 四合一终极融合 + 主动技能"状态；测试包还会带上 tune
        // （调参面板，规格 specs/shanhai-dev-tune.md）。
        //
        // ⚠️ 参数值**从 assets/dev-ultimate.flag 读**，不再写死 'ultimate'：
        //    打正式包时构建脚本会把这个文件删掉，而 BuildConfig.DEV_ULTIMATE 为 false，
        //    所以正式包的 URL 里没有任何 dev 参数，行为与发布版逐值一致；
        //    以后想只开 终极 不开 面板，改构建参数即可，不用动 Java。
        String entry = ENTRY_URL;
        if (BuildConfig.DEV_ULTIMATE) {
            String devParams = readAssetText("dev-ultimate.flag");
            if (devParams.isEmpty()) devParams = "ultimate";
            entry = ENTRY_URL + "?dev=" + devParams;
        }
        web.loadUrl(entry);
        goImmersive();
    }

    /** 读 assets 里的一个小文本文件（用于 dev 开关标记）。读不到返回空串。 */
    private String readAssetText(String name) {
        try (InputStream in = getAssets().open(name)) {
            byte[] buf = new byte[256];
            int n = in.read(buf);
            if (n <= 0) return "";
            return new String(buf, 0, n, StandardCharsets.UTF_8).trim().replace("\n", "").replace("\r", "");
        } catch (IOException e) {
            return "";
        }
    }

    /** 仅 debug：轮询页面状态并打到 logcat，供 adb 验证 */
    private android.webkit.ValueCallback<String> logCb() {
        return new android.webkit.ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                android.util.Log.i("ShanhaiState", String.valueOf(v));
            }
        };
    }

    private void pageReadyProbe() {
        final android.os.Handler h = new android.os.Handler(getMainLooper());
        h.postDelayed(new Runnable() {
            int n = 0;

            @Override
            public void run() {
                n++;
                if (web == null) return;
                if (n == 1) {
                    // 真机核对：干净存档开局，把每次三选一的卡片内容打出来。
                    // 防的是"未解锁系的武器/被动出现在卡池里"。
                    web.evaluateJavascript(
                            "(function(){try{"
                                    + "document.getElementById('btn-start').click();"
                                    + "var s=window.__shanhai,w=s.world;if(!w)return 'CARDS 没有world';"
                                    + "var save=JSON.parse(localStorage.getItem('shanhai-save-v1')||'{}');"
                                    + "var unlockSeries=(save.unlocks&&save.unlocks.series)||[];"
                                    + "var unlockWeapons=(save.unlocks&&save.unlocks.weapons)||[];"
                                    + "var log=[];var round=0;"
                                    + "for(var i=0;i<60*400 && w.running && round<40;i++){"
                                    + "if(w.awaitingChoice){round++;"
                                    + "var line='#'+round+' ';"
                                    + "for(var k=0;k<w.cardChoices.length;k++){var c=w.cardChoices[k];"
                                    + "line+=(c.type==='weapon-new'||c.type==='weapon-up'?c.weaponId:c.passiveId||'none')+' | ';}"
                                    + "log.push(line);"
                                    + "w.takeCard(w.cardChoices[0]);continue;}"
                                    + "w.input.mx=Math.cos(i/90);w.input.my=Math.sin(i/90);w.step();}"
                                    + "return 'CARDS 已解锁系='+unlockSeries.join(',')+' 已解锁武器='+unlockWeapons.join(',')+' 升级次数='+round+'\\n'+log.join('\\n');"
                                    + "}catch(e){return 'CARDS ERR '+e.message;}})()",
                            logCb());
                }
                if (n == 4) {
                    // 真机验证②：逐个角色开一局，校验"角色 → 初始武器"的映射是否正确
                    // （按下标取卡片是不可靠的：卡片顺序会变）
                    web.evaluateJavascript(
                            "(function(){try{"
                                    + "var expect={shanpo:'w_shoujia',haipo:'w_linyu',huangpo:'w_huanglei',tianpo:'w_tian_1',wupo:'w_ling_1',busipo:'w_kun_1'};"
                                    + "var res=[];var bad=[];"
                                    + "var cards=document.querySelectorAll('.char-card');"
                                    + "for(var i=0;i<cards.length;i++){"
                                    + "cards[i].click();"
                                    + "document.getElementById('btn-start').click();"
                                    + "var w=window.__shanhai.world;"
                                    + "if(!w){bad.push('第'+i+'张:无world');continue;}"
                                    + "var got=w.slots.weapons[0].id;var cid=w.characterId;"
                                    + "if(expect[cid]!==got)bad.push(cid+' 期望'+expect[cid]+' 实际'+got);"
                                    + "res.push(cid+'='+got);"
                                    + "w.player.hp=0;w.outcome='dead';w.running=false;"
                                    + "}"
                                    + "return 'E2E '+res.join(' ')+(bad.length?(' ❌ mismatched: '+bad.join(', ')):' ✅ 六个角色初始武器全部正确');"
                                    + "}catch(e){return 'E2E ERR '+e.message;}})()",
                            logCb());
                }
                web.evaluateJavascript(
                        "(function(){try{"
                                + "var d=document, w=window.__shanhai&&window.__shanhai.world;"
                                + "return JSON.stringify({"
                                + "menu:!d.getElementById('screen-menu').hidden,"
                                + "hud:!d.getElementById('screen-hud').hidden,"
                                + "levelup:!d.getElementById('screen-levelup').hidden,"
                                + "cards:d.querySelectorAll('#cards .card').length,"
                                + "playing:!!w,"
                                + "t:w?Math.round(w.elapsedMs/1000):0,"
                                + "kills:w?w.runStats.kills:0,"
                                + "hp:w?Math.round(w.player.hp):0"
                                + "});}catch(e){return 'ERR '+e.message;}})()",
                        logCb());
                h.postDelayed(this, 2000);
            }
        }, 3000);
    }

    /** 把 /assets/xxx 映射到 APK 内的 assets/xxx，自己判定 MIME 与状态码 */
    private WebResourceResponse serveFromAssets(String path) {
        if (path == null) return notFound();
        String rel = path.startsWith("/assets/") ? path.substring("/assets/".length()) : null;
        if (rel == null) return notFound();
        try {
            rel = URLDecoder.decode(rel, "UTF-8");
        } catch (Exception ignored) {
        }
        // 防目录穿越
        if (rel.contains("..")) return notFound();

        String mime = guessMime(rel);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        // 文本类统一声明 UTF-8（源码里全是中文，不声明会乱码）；
        // 二进制类必须把 encoding 传 null，否则 WebView 会往 Content-Type 上挂 charset。
        boolean textual = mime.startsWith("text/") || mime.equals("application/javascript")
                || mime.equals("application/json") || mime.equals("application/manifest+json")
                || mime.equals("image/svg+xml");
        String encoding = textual ? "utf-8" : null;

        InputStream in;
        try {
            in = getAssets().open(rel, android.content.res.AssetManager.ACCESS_STREAMING);
        } catch (IOException e) {
            // 目录或缺失文件：返回 404 而不是 null。返回 null 会让 WebView 尝试走网络，
            // 那就违背了"严格不联网"这条架构约束。
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }
        return new WebResourceResponse(mime, encoding, 200, "OK", headers, in);
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    /** 扩展名 → MIME。ES Module 必须拿到 text/javascript，否则 Chromium 会拒绝加载。 */
    private static String guessMime(String name) {
        String n = name.toLowerCase();
        int dot = n.lastIndexOf('.');
        String ext = dot >= 0 ? n.substring(dot + 1) : "";
        switch (ext) {
            case "html": case "htm": return "text/html";
            case "js": case "mjs": return "application/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "ico": return "image/x-icon";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "ttf": return "font/ttf";
            case "otf": return "font/otf";
            case "mp3": return "audio/mpeg";
            case "ogg": case "oga": return "audio/ogg";
            case "wav": return "audio/wav";
            case "m4a": return "audio/mp4";
            case "webm": return "video/webm";
            case "mp4": return "video/mp4";
            case "txt": return "text/plain";
            case "md": return "text/markdown";
            default: {
                String g = URLConnection.guessContentTypeFromName(n);
                return g != null ? g : "application/octet-stream";
            }
        }
    }

    /** 沉浸式全屏：避开刘海与导航栏，避免安全区计算把 HUD 挤到屏幕外 */
    private void goImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            android.view.WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                    android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    @Override
    public void onBackPressed() {
        // 交给页面处理（暂停），避免误触直接退出丢掉这一局
        if (web != null) {
            web.evaluateJavascript(
                    "(function(){try{var b=document.getElementById('btn-pause');"
                            + "if(b && document.getElementById('screen-menu').hidden){b.click();return 'paused';}"
                            + "return 'menu';}catch(e){return 'err';}})()",
                    value -> {
                        if (value != null && value.contains("menu")) {
                            super.onBackPressed();
                        }
                    });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        goImmersive();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
