# Phase 2 — Android 原生冷启动屏

本文件记录 Phase 2 的改动、**验证方法与实测结果**，以及为什么这里停在验证而非出包。

---

## 1. 改了什么

Phase 1 的启动页（`shell.overlay`）覆盖不到冷启动：它要等 DSH 应用帧挂载后才渲染，而在此之前浏览器会先画白帧、再显示 DSH 自己的 `_boot_` 卡片。真正的冷启动屏属于宿主外壳的 Android 主题。

`android-native-splash.patch` 包含 8 个文件：

| 文件 | 改动 |
|---|---|
| `res/values/splash.xml` | 新增：`splash_background` / `splash_mark` / `window_background`（浅色 `#FFFFFF` / `#4176E6`） |
| `res/values-night/splash.xml` | 新增：深色 `#151517` / `#5686FE` |
| `res/drawable/splash_mark.xml` | 新增：两个交叠圆环的 vector |
| `res/values/themes.xml` | `windowBackground` + 三色系统栏 + 新增 `Theme.dsh_tether_app.Splash` |
| `res/values-night/themes.xml` | 补上深色版（原文件与浅色**逐字相同**，夜间状态栏图标不可见） |
| `AndroidManifest.xml` | activity 加 `android:theme="@style/Theme.dsh_tether_app.Splash"` |
| `build.gradle.kts` | 加 `androidx.core:core-splashscreen:1.0.1` |
| `MainActivity.kt` | 在 `super.onCreate` **之前**调用 `installSplashScreen()` |

**颜色取自 DSH 自己的 token**：`--dsh-boot-bg`（`#fff` / `#151517`）与品牌强调色 `--dsw-alias-brand-primary-new-colorprimary-new-color`（`#4176E6` / `#5686FE`），因此原生启动屏与插件的 HTML 启动页是同一个色系。

**vector 几何是推导的，不是目测的**：源码标记在 48 视口内跨 33 单位，绕中心 (54,54) 缩放 1.2 倍 → 圆心 46.8 / 61.2，半径 13.8，描边 2.88，footprint 44.9 单位 ≈ 画布 41%，落在 API 31+ 启动图标圆形安全区内。

---

## 2. 为什么没出 APK

出包需要编译 Rust，而 Windows 上编译 Rust 需要 **MSVC 工具链**（`link.exe`）。本机实测：

```
error: linker `link.exe` not found
note: the msvc targets depend on the msvc linker but `link.exe` was not found
```

排查结果：**未安装 Visual Studio、无 Windows SDK、无 MinGW、无 clang、WSL 未安装**。这是硬性前提，即使目标是 Android 也绕不开 —— 因为构建脚本与 proc-macro 仍要为主机（Windows）编译。

已就绪的部分（本次会话补齐）：

| 组件 | 状态 |
|---|---|
| Rust 1.98.1 + `aarch64-linux-android` | ✅ 装在 `H:\DSH\_work\cargo`（项目内，不污染系统） |
| Android NDK 27.0.12077973 | ✅ |
| Tauri CLI 2.11.4 | ✅ |
| JDK 17 / SDK `android-36` / build-tools 36.0.0 / Gradle 8.14.3 | ✅ |
| **MSVC (`link.exe`)** | ❌ **缺，是唯一阻塞** |

解除阻塞：`winget install Microsoft.VisualStudio.2022.BuildTools`（含 VCTools 工作负载，约 2–4 GB），之后 Rust 全量交叉编译约 30–60 分钟（678 个 crate，含 iroh 1.0 与 Tauri 2.9）。

---

## 3. 验证方法与实测结果

启动屏纯粹是 Android 资源，其失败模式全部能被**资源编译器**捕获：

- XML 无法解析或编译
- `<vector>` 畸形（pathData 错误、未知属性）
- 主题项引用了未定义的属性或颜色
- 用了 `windowSplashScreen*` 但 `core-splashscreen` 的属性不在场

所以 `tools/verify-android-resources.ps1` 用 `aapt2` 独立完成验证，**不需要 Rust、Gradle 工程接线或 MSVC**。

### 实测输出

```
== stage app resources (stub the Material parent theme)
   ok
== aapt2 compile (app resources)
   ok: 123564 bytes
== aapt2 compile (core-splashscreen resources)
   ok: 14052 bytes
== prepare manifest (substitute manifestPlaceholders)
   ok
== aapt2 link (resolves every theme item and attribute reference)
   ok: 121291 bytes
== inspect the linked resource table
   color/splash_background              present
   color/splash_mark                    present
   color/window_background              present
   drawable/splash_mark                 present
   style/Theme.dsh_tether_app.Splash    present
   windowSplashScreenBackground         present
   windowSplashScreenAnimatedIcon       present
   postSplashScreenTheme                present
== night-qualified values differ from the default
   day  splash_background = #FFFFFFFF
   night splash_background = #FF151517
   night configuration present in the resource table

RESULT: launch-screen resources compile, link and survive into the APK
```

### 这个验证证明了什么、没证明什么

**证明了**：所有启动屏资源能被 aapt2 编译；每一个主题项与属性引用都能解析（含三个 `windowSplashScreen*`，它们来自 `core-splashscreen` 的 AAR）；8 个资源条目都进了链接后的资源表；深色变体确实不同且可被选择。

**没证明**：Tauri 应用整体能编译；`installSplashScreen()` 的运行时行为；真机上启动屏的实际观感。

### 验证中的两处替身（必须说明）

为了让 link 在无第三方依赖图的情况下跑通，脚本替换了两样**与启动屏无关**的东西：

1. **`Theme.MaterialComponents.DayNight.NoActionBar` → `android:Theme.Material.Light.NoActionBar`**。前者来自 `com.google.android.material`，会级联拖入 appcompat、core 及其传递 AAR。
2. **排除 `res/layout/`**。里面的 `activity_main.xml` 是 Tauri 的模板残留，依赖 `androidx.constraintlayout`；`MainActivity` 从不调用 `setContentView`。

真实 Gradle 构建会正常解析这两者。

---

## 4. 调用方式

```powershell
# 默认路径已按本机环境填好
powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-android-resources.ps1

# 或指定自己的路径
powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-android-resources.ps1 `
  -AppRes   <...>\app\src\main\res `
  -Manifest <...>\app\src\main\AndroidManifest.xml `
  -AarDir   <解包后的 core-splashscreen AAR> `
  -AndroidJar <sdk>\platforms\android-36\android.jar `
  -Aapt2    <sdk>\build-tools\36.0.0\aapt2.exe
```

需要先取到 `core-splashscreen:1.0.1` 的 AAR（属性定义来源）：

```powershell
curl.exe -L -o core-splashscreen-1.0.1.aar `
  https://dl.google.com/dl/android/maven2/androidx/core/core-splashscreen/1.0.1/core-splashscreen-1.0.1.aar
Copy-Item core-splashscreen-1.0.1.aar core-splashscreen-1.0.1.zip
Expand-Archive core-splashscreen-1.0.1.zip -DestinationPath splashscreen-aar
```

---

## 5. 应用 patch

```powershell
# 在 dsh-tether 源码目录内
git apply --check android-native-splash.patch
git apply android-native-splash.patch
```

patch 基于 `main` 分支的 `app/src-tauri/gen/android/`。若上游已改动这些文件，`--check` 会失败 —— **不要**强行 `--3way`，逐文件对照本文件的第 1 节手工合并更稳妥。

---

## 6. 真机上应当验证什么

出包后（或装进现有 App 后）需要确认：

1. **冷启动无白闪** —— 从点图标到看见品牌标记，中间不应出现白帧
2. **浅/深色都正确** —— 系统切深色后启动屏底色应为 `#151517` 而非白
3. **与 HTML 启动页接续** —— 原生启动屏淡出后接上 Phase 1 的浮层，缝不可辨
4. **状态栏图标可见** —— 深色下不再出现深色图标压深色背景

第 3 条是 Phase 1 与 Phase 2 的交界，也是这两个阶段一起做的意义所在。

---

## 7. 已知限制

- **未在真机验证**：本机 `adb devices` 为空（小米 14 Pro 仅蓝牙配对，蓝牙不跑 ADB）。需要 USB 调试或无线调试。
- **签名不匹配**：release APK 由 CI 的 keystore 签名（`ANDROID_KEYSTORE_B64`），本机没有。自建包签名不同 → 覆盖安装前必须卸载 → **会丢失配对信息**。
- **`android-runtime/` 缺失**：`scripts/build-android-runtime.mjs` 的产物（本地模式运行时）不在版本库里，gradle 引用该目录但源码注释确认「没生成时目录不存在，gradle 照常构建，APK 里只是没有本地模式」。所以自建包是**仅远程模式**的精简版（约 32 MB，而非 71 MB），足够验证启动屏。
