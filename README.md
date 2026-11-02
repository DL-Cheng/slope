# Slope Sentinel｜插地型邊坡偵測桿（IPITEx 2027）

太陽能供電的插地型邊坡預警裝置：木製小屋內放置 ESP32 與感測器，偵測土壤濕度、邊坡傾斜與地表開裂，現場以紅光 LED 與蜂鳴器示警，並透過 MQTT 同步到雲端與手機 Web App。網頁為全英文介面，並在標題列、About 頁與頁尾標示 **IPITEx 2027**。

## 設計動機（對應邊坡滑動前兆）

| 前兆 | 本作品的感測方式 |
|---|---|
| 地表或坡面出現新裂縫並持續擴大 | 斷裂感測器：插銷拔開即短路到 GND |
| 樹木、電桿、擋土牆傾斜，地面位移 | L3G4200D 三軸陀螺儀，積分得到傾角 |
| 異常滲水、土壤飽和 | 電容式土壤濕度感測器 |

## 警示等級（韌體在裝置端判斷，斷網仍可現場示警）

| 等級 | 條件 | 紅光 LED | 蜂鳴器 |
|---|---|---|---|
| 0 All clear | 一切正常 | 熄滅 | 無 |
| 1 Watch | 土壤 ≥ 70 % 或傾角 ≥ 3° | 每 2 秒短閃 | 無 |
| 2 Warning | 土壤 ≥ 85 % 或傾角 ≥ 8° | 快閃 | 間歇短鳴 |
| 3 Danger | 插銷拔開，或傾角 ≥ 15° | 急閃 | 急促連續 |

同時出現兩種以上徵兆時，等級再升一級（最高 3）。電量 ≤ 20 % 僅顯示「Low battery」標籤。門檻值在 `SlopeSentinel.ino` 與 `js/app.js` 兩處，修改時請同步。

## 專案結構

```
index.html            主頁（Monitor / About / Settings）
css/style.css
js/app.js             MQTT、儀表板、通知、Demo 模式
js/mqtt.min.js        mqtt.js 5.10.1（本地檔，離線可用）
manifest.webmanifest  PWA 設定
sw.js                 Service Worker（離線與通知）
icons/                App 圖示（木屋＋太陽能屋頂＋警示燈＋插地桿）
firmware/SlopeSentinel/SlopeSentinel.ino   ESP32 程式
docs/Slope_Sentinel_Wiring.pdf             接線與腳位圖
```

## ESP32 腳位

| 功能 | 腳位 |
|---|---|
| 土壤濕度（簡易分壓電路，乾 0 V、濕 ≥ 約 1 V） | GPIO32 |
| 電池電量（100 kΩ + 100 kΩ 分壓，並聯 100 nF） | GPIO33 |
| L3G4200D I2C | SDA = GPIO21，SCL = GPIO22 |
| 斷裂開關（INPUT_PULLUP，拔開 = LOW） | GPIO27 |
| 蜂鳴器（5 V 主動式，經 S8050 驅動） | GPIO25 |
| 紅光 LED（串 220 Ω） | GPIO26 |

完整接線圖與焊接檢查清單見 `docs/Slope_Sentinel_Wiring.pdf`。

## 燒錄 ESP32

1. Arduino IDE 安裝 ESP32 開發板套件（Espressif）。
2. 程式庫管理員安裝 **PubSubClient**。
3. 開啟 `firmware/SlopeSentinel/SlopeSentinel.ino`，確認 Wi-Fi：SSID `DL`，密碼 `0932859879`（已設定）。
4. 選擇 ESP32 Dev Module 後上傳。序列埠（115200）出現 `L3G4200D found` 表示陀螺儀正常。
5. 校正土壤感測器：可用三用電表量 GPIO32 的電壓，或在 MQTT 資料的 `soil_mv` 欄位看到分壓電壓（mV）。乾燥時填入 `SOIL_MV_DRY`（預設 0），土壤飽和時填入 `SOIL_MV_WET`（預設 1000），濕度 % 即依此線性換算。
6. 開機時請保持木屋靜止約 2 秒（陀螺儀校零）。安裝站穩後可在 App 按 **Re-zero tilt** 重設傾斜基準。

## MQTT（www.emqx.com 公共 broker）

- ESP32：`broker.emqx.io:1883`；網頁：`wss://broker.emqx.io:8084/mqtt`
- 主題前綴：`ipitex2027/slopesentinel/dl01`（ino 的 `MQTT_BASE` 與網頁 Settings 必須一致）。公共 broker 任何人都能訂閱，建議把 `dl01` 改成不易重複的字串。
- `…/data`（JSON，retained，每 2 秒）、`…/status`（online/offline）、`…/event`（事件文字）、`…/cmd`（`mute`、`reset`、`zero`、`test`）

## 部署到 GitHub Pages 與安裝成手機 App

1. 將整個資料夾內容（不含 `firmware`、`docs` 也可）上傳到 GitHub repository 根目錄。
2. Settings → Pages → Branch 選 `main`，資料夾選 `/ (root)`。
3. 以手機瀏覽器開啟網址：Android Chrome 選「安裝應用程式」，iPhone Safari 選「分享 → 加入主畫面」。
4. 之後更新網頁時，請把 `sw.js` 內的 `CACHE` 版本號加 1，已安裝的手機才會取得新檔。

## 手機通知

- **Web App 通知**：在 Settings 按 Enable。App 開啟或在背景保持連線時，等級上升會跳出通知、震動並發出提示音。iPhone 須先「加入主畫面」。
- **App 關閉時也要通知**：ESP32 在等級上升時會經 HTTPS 推送到 ntfy.sh。手機安裝 **ntfy** App 並訂閱 `ipitex2027-slopesentinel-dl01`（`NTFY_TOPIC`，建議改成自訂字串）。不需要此功能時把 `NTFY_TOPIC` 設為 `""`。

## 展場 Demo

Settings → Demo mode，或網址加 `?demo=1`，即可不接硬體展示四種情境（Normal、Heavy rain、Slope shift、Crack opens）。

## 已知限制

- L3G4200D 只量角速度，傾角靠積分取得，會隨時間漂移。韌體在靜止時自動追蹤零點偏移以降低漂移，但長期（數天以上）仍建議定期按 Re-zero tilt，或另加加速度計校正。
- 太陽能板目前僅為屋頂示意，未接入充電電路。
- ntfy 推送為阻塞式 HTTPS 請求，等級上升時最多延遲 4 秒，期間蜂鳴器與 LED 狀態會暫停更新。
