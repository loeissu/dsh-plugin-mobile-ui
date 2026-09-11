# 键盘遮挡输入框 · 诊断与缓解

**日期**：2026-09-11
**现象**：手机上键盘弹出时，输入框不升起，被键盘完全盖住。
**状态**：已实现缓解方案并通过验证；**根因在原生层，未修**。

---

## 1. 根因

**不是 DSH，也不是本插件 —— 是 Tauri 壳的 Android 配置缺了一项。**

`app/src-tauri/gen/android/app/src/main/AndroidManifest.xml` 的 `<activity>` **没有声明 `android:windowSoftInputMode`**：

```xml
<activity
    android:configChanges="orientation|keyboardHidden|keyboard|screenSize|..."
    android:launchMode="singleTask"
    android:label="@string/main_activity_title"
    android:name=".MainActivity"
    android:theme="@style/Theme.dsh_tether_app.Splash"
    android:exported="true">
    <!-- 没有 android:windowSoftInputMode -->
```

缺省是 `adjustUnspecified`，系统自行在 `adjustResize` / `adjustPan` 之间选。这台设备上解析成了**不缩小窗口**的行为，于是：

```
窗口不随键盘缩小
  → WebView 布局视口不变
  → 输入框（常规流元素）位置不变
  → 被键盘盖住
```

### 文档层也无法自救

实测几何：

```
html / body : height 915px（= 视口）, overflow: visible   ← 不可滚动
frame       : height 915px, display grid, overflow hidden
centre      : height 915px, display flex, overflow hidden
真正滚动的   : wSkVaW_scrollBody（会话内容）
```

**`html` 和 `body` 恰好等于视口高度且 `overflow: visible`，所以文档没有可滚动空间。**

DSH 自己在 `dsh-client-ui-conversation` 里**确实**有一段键盘处理（全库唯一一处 `visualViewport` 引用）：它用 `visualViewport.offsetTop` / `.height` 算出可见带，然后 `scrollBy(0, f)` 把聚焦元素滚进可视区。但**这里没有可滚动的祖先**，所以那段逻辑无事可做。

**输入框是常规流元素，位置完全取决于外壳有多高。**

---

## 2. 为什么走客户端缓解而不是改原生

正确修法是原生的：给 manifest 加 `android:windowSoftInputMode="adjustResize"`，或在 `MainActivity` 里监听 IME insets。**但那需要重新编译 APK**，而本机缺 MSVC 工具链（见 `docs/android-native-splash.md`）。

所以先做**客户端缓解**，它不需要出包就能生效。

---

## 3. 缓解方案

**关键依据：Android WebView 里 `visualViewport.height` 会随键盘缩小，即使布局视口不变。**

所以：当两个视口的高度差超过一个键盘的量级时，把 app frame 钉到可见带上。

```css
@media (max-width: 768px) {
  [data-slot="root"] > [class*="_frame"] {
    height: var(--dsh-mobile-vv-height, 100%) !important;
    top: var(--dsh-mobile-vv-top, 0px) !important;
  }
}
```

脚本在 `visualViewport` 的 `resize` / `scroll` 上写这两个变量；不触发时变量不存在，样式回退到 `100%` / `0px`，**布局与未改动时完全一致**。

文件：`src/client/viewport.ts`

---

## 4. 几何可行性（设备无关验证）

在真实运行实例上强制 frame 为 500px，看输入框是否跟随：

| | frame 高 | 输入框卡片底部 | 会话滚动区 |
|---|---|---|---|
| 基线 | 915 | 915 | 839 |
| frame=500px | 500 | **500** ← 精确跟随 | 424 |
| 恢复 | 915 | 915 | 839 |

**结论：输入框精确升到 frame 底部，滚动区按比例收缩，恢复无残留。** 复现：`tools/probe-keyboard-geometry.mjs`

---

## 5. 逻辑验证（16 项全通过）

用一个可控的 `visualViewport` 替身模拟键盘，在页面脚本之前注入，因此插件安装时绑定的就是它：

```
PASS  plugin bound to the visual viewport            listeners=1
PASS  no height override at rest                     var=null
PASS  frame is the full viewport at rest             915px
PASS  height override applied                        var=500px
PASS  frame followed the visual viewport             500px
PASS  composer clears the keyboard                   card bottom=500
PASS  height override removed                        var=null
PASS  frame restored                                 915px
PASS  composer returned to its original position     915 -> 915
PASS  below-threshold shrink ignored                 var=null
PASS  offset tracked                                 var=300px
PASS  rotation is not mistaken for a keyboard        var=null
PASS  keyboard still detected after a rotation       var=200px
PASS  no page exceptions
```

复现：`tools/verify-keyboard-fit.mjs`

---

## 6. 设计要点：为什么和 `window.innerHeight` 比，而不是记基准值

**第一版是错的。** 它记下插件安装时的视口高度作为基准，之后拿实时高度与之比较。测试中它**永久锁死**：基准是在视口稳定之前读到的，于是每次事件都像是"有一个 85px 的键盘从没关闭"。

改成**比较两个实时值**：`window.innerHeight - visualViewport.height`。这同时消掉了基准，还让 WebView 自身的 resize 模式变得无关紧要 —— 这正是要点：

| 情形 | `innerHeight` | 差值 | 结果 |
|---|---|---|---|
| **窗口不为 IME 缩小**（本 App 的情形） | 保持全高 | 增大 = 键盘高度 | 启用覆盖 ✓ |
| **窗口为 IME 缩小**（`adjustResize`） | 随键盘缩小 | 接近 0 | 不覆盖，原生已处理 ✓ |
| **旋转** | 与可视视口一起变 | 接近 0 | 不覆盖 ✓ |

旋转因此不需要特判。

---

## 7. 诚实的边界

**这是缓解，不是正确修复。**

- 它**依赖 WebView 通过 `visualViewport` 报告键盘**。若某个 WebView 不报告，则什么都不会发生，输入框保持原样 —— **降级，不会更糟**。
- **未在真机验证**。上述验证全部在桌面 Chromium 的 CDP 里完成，用的是可控替身；真机上 Android WebView 是否按预期报告键盘，**只有设备能确认**。
- 正确修复是原生的，需要出包。

---

## 8. 真机上应当确认

1. 键盘弹出时输入框**升到键盘之上**
2. 键盘关闭后布局**完全恢复**（无残留高度）
3. 抽屉打开时键盘弹出的行为
4. 横竖屏切换**不被误判成键盘**

若第 1 条不成立，说明该 WebView 不通过 `visualViewport` 报告键盘，那这条路就走不通，必须回到原生修复（出包）。
