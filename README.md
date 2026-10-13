# 山海拾遗

《山海拾遗》是离线 Android 单机游戏。游戏本体使用 HTML、Canvas 2D 和原生 JavaScript；Android 工程提供 WebView 容器。仓库对应 v0.2.4（Android `versionCode` 6）。

## 游戏玩法

这是一款横屏弹幕生存游戏。每局选一位角色，在不断涌来的怪群里走位、捡经验。升级时从三项强化中选一项，逐渐搭出自己的武器和被动组合；满足特定配方，还能触发融合。

战斗中会遇到精英怪和首领相柳，角色的主动技能也需要看准时机使用。通关后可以继续挑战无尽模式；局外还有试炼和图鉴，记录已经解锁、遇见的内容。

## 本地运行

需要 Node.js。浏览器版使用本地 HTTP 服务加载 ES Modules：

```powershell
node tools/serve.mjs 8080
```

打开 `http://127.0.0.1:8080/`。游戏运行时不依赖外部服务。

## 测试

```powershell
node test/all.mjs --quick
```

完整测试运行 `node test/all.mjs`。部分浏览器、设备诊断工具需要另行配置本地浏览器或 ADB。

## Android 工程

`android/` 是 Gradle 工程；构建需要 JDK 17、Android SDK 35 和 Gradle 8.9。先执行：

```powershell
powershell -File ./sync-android-assets.ps1
```

这会把网页游戏文件同步到 Android 工程的本地 `assets` 目录。然后在 `android/` 目录运行 `gradle assembleDebug`。仓库不包含本机 SDK 路径、签名密钥或签名密码；若要生成可更新已安装正式版的 APK，需使用原有私有签名密钥并在本地配置 `android/keystore.properties`。

## 仓库内容

- `src/`、`assets/`：游戏逻辑和美术资源。
- `test/`、`tools/`：自动测试、诊断与素材工具。
- `android/`：Android WebView 容器源码。
- `docs/`：设计规格与早期实现记录；其中部分历史路径和版本号仅供参考。

发布包、签名材料、设备截图和测试缓存不存放在本仓库。
