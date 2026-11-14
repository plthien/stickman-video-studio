# R1 — MODE B STUDIO UI V3: ONE-ROUND IMPLEMENTATION PLAN

**Loại task:** IMPLEMENTATION (không phải audit-only hoặc lập kế hoạch lại)  
**Repository:** `plthien/stickman-video-studio`  
**Branch:** `feat/mode-b-ui-v3-baseline` (đã tạo, chứa mockup đã duyệt)  
**UI baseline LOCKED:** `docs/ui/mockups/v3/vertical-stickman-ui-mockup-v3.html`  
**Layout rules:** `docs/ui/mockups/v3/EDITOR_LAYOUT_NOTES.md`  
**Hướng dẫn tổng:** `docs/ui/UI_V3_IMPLEMENTATION_PLAN.md`  
**Platform:** Windows 10/11, Node.js 22, ứng dụng desktop Electron + React + TypeScript + Vite.  
**Output:** Mã nguồn UI production chia page/component, chạy local được, test và evidence; chưa kết nối các dịch vụ production.

## 0. Non-negotiable / phạm vi khóa

1. **Giữ nguyên 100% Mode B Core:** không sửa file nào trong `skills/directing-stickman-videos/**` (scripts, styles B1–B5, SKILL, assets, package/lockfile, tests). Không sửa cấu trúc native `project.json`, không viết renderer mới, không tích hợp Remotion.
2. HTML V3 là **nguồn tham chiếu hình ảnh/tương tác**, chỉ giữ trong `docs/ui/mockups/v3/`. **Không copy nguyên HTML vào app, iframe, WebView, `dangerouslySetInnerHTML`, giant JSX hoặc 1 file CSS**. Tách thành pages, feature components, hooks, styles, typed state.
3. **R1 chỉ làm UI + Electron shell + UI state thực sự tương tác.** Chưa kết nối External ChatGPT backend, VoiceStudio Nano, G-Labs, FFmpeg/Mode B CLI, SQLite/production DB, queue, real preview/approval/render. Không gọi API, không dùng LLM API, không chạy job trả phí.
4. Những trạng thái chưa nối backend phải hiển thị rõ **`DEMO / Chưa kết nối`**; không ghi `PASS`, `Approved`, `Generated`, `Connected` như trạng thái thực của service. Nếu giữ action demo từ mockup, trạng thái cũng phải ghi rõ demo và không được tạo file native/approval thật.
5. **Một implementation round duy nhất:** triển khai xong, tự test, tự sửa lỗi, xuất evidence và push lên **cùng branch**. Không tạo plan mới, không mở rộng thành nhiều phase/PR, không merge vào `main`.

## 1. Baseline và source structure

- Trước khi code: refresh HEAD; kiểm tra `main` và branch hiện tại, pin commit SHA; xem toàn bộ mockup V3 và layout notes. Chụp reference screenshots tại 1656×790 và 1280×720. Kiểm tra baseline `git diff --name-only main...HEAD` chỉ chứa `docs/ui/**`.
- Mọi mã mới nằm trong `studio/` (trừ tài liệu evidence ngoài `studio/` nếu thật sự cần). Sử dụng **Electron + React 18+/19, TypeScript strict, Vite/electron-vite**, dependencies cố định có lockfile và npm scripts. Chọn một routing strategy rõ ràng; không dựng hai hệ điều hướng song song.
- Đề xuất cấu trúc (có thể đổi tên nhưng bắt buộc tương đương):

```text
studio/
  package.json                 # npm ci / dev / build / lint / typecheck / test / test:ui
  package-lock.json
  tsconfig*.json
  src/
    main/
      index.ts                 # Electron bootstrap, secure BrowserWindow
      ipc/                    # tối thiểu: app metadata / safe openExternal
    preload/
      index.ts                 # contextBridge typed allowlist
    renderer/
      app/
        App.tsx
        routes.tsx
        layout/
          AppShell.tsx
          Sidebar.tsx
          Topbar.tsx
          PipelineStrip.tsx
      pages/
        ProjectSetupPage.tsx
        OverviewPage.tsx
        ExternalChatGPTPage.tsx
        ScriptPage.tsx
        VoiceCaptionsPage.tsx
        StoryboardImagesPage.tsx
        VideoEditorPage.tsx
        RenderExportPage.tsx
        SystemSettingsPage.tsx
      features/
        project/               # inputs, style selector, duration, ratio
        external/              # task tabs, prompt display, JSON textarea, import demo
        script/                # script editor, section cards
        voice/                 # waveform mock, voice pickers, caption rows
        storyboard/            # cards, shot details, selection
        editor/
          EditorModeTabs.tsx
          ScenesAssetsPanel.tsx
          PortraitPreview.tsx
          PreviewControls.tsx
          InspectorPanel.tsx
          EditorTimeline.tsx
          TimelineTrack.tsx
          TimelineSplitter.tsx
          NativePreviewPanel.tsx
          ApprovalPanel.tsx
          QADetailsDialog.tsx
        render/                # job/result demo states
        settings/              # endpoint forms (NOT network tests yet)
      components/ui/           # Button, Input, Select, Card, Badge, Tabs, Dialog, Toast, etc.
      styles/
        tokens.css             # V3 palette/spacings
        global.css
        layout.css
        editor.css
      state/                   # typed UI state, demo fixtures, selected project, navigation
      types/                   # app-only types; no changes to Mode B manifest
  tests/
    unit/
    ui/
  scripts/
    windows-r1-acceptance.ps1
```

- Duy trì **component boundaries**: page chỉ compose feature components; `App.tsx` là shell/router, không chứa toàn bộ UI; editor state không lẫn project form state; demo fixtures tập trung ở một chỗ; UI components không truy cập Node, filesystem hoặc HTTP trực tiếp.
- Ưu tiên CSS V3 tokens đã duyệt: dark navy, mint accent, typography và spacing. Giữ nguyên điều hướng và nhóm system. Có thể trích xuất pattern từ mockup nhưng **phải tổ chức lại thành component CSS**.

## 2. Toàn bộ 9 màn hình bắt buộc hoàn thiện trong R1

| Page | Parity/interaction cần có ở R1 |
|---|---|
| **01 Project Setup** | **Đứng đầu sidebar, landing page mặc định**; form topic/title/source, style B1–B4, 9:16, duration dưới 300 s, language/output; client validation; thay đổi state phản ánh tại header/project chip. B5 hiện `Separate workflow / chưa hỗ trợ External JSON`. |
| **02 Overview** | Pipeline cards, project metrics, readiness and issues hiển thị đúng *demo*; điều hướng tới stage tương ứng; thông tin thay đổi khi chỉnh demo state. |
| **03 External ChatGPT** | Stage tabs; Generate/Copy/Export Prompt demo, paste/upload `.json`, JSON syntax/error view, clear/reset, mock validation state ghi `DEMO`; chưa claim strict schema/atomic import trong R1. |
| **04 Script** | Script sections, chọn section, chỉnh text local demo, undo/reset hoặc dirty indicator, section metrics; không cho thao tác giả thay đổi narration production. |
| **05 Voice & Captions** | Voice picker demo, readiness panel `NOT CONNECTED`, waveform và caption cue list minh họa; play demo audio chỉ khi có bundled/local sample thực sự; nút TTS/align thật disabled/Coming in R3. |
| **06 Storyboard & Images** | Shot grid, chọn shot mở details, đổi active scene/filters, ảnh tham chiếu, asset statuses demo; generate/retry G-Labs chưa hoạt động thì disabled/Coming in R3. |
| **07 Video Editor** | **Trọng tâm R1**: bố cục 3 panel + timeline cố định, chọn shot, preview 9:16, controls, seek, inspector tabs, layers/keyframe demo, 3 modes Edit/Native Preview/Approval, QA dialog, timeline splitter. Native commands **không** gọi, phải ghi rõ `No actual MP4` / Demo. |
| **08 Render & Export** | Render settings/result cards/log section demo, job progress placeholder; real Render/Download chưa được kích hoạt hoặc hiển thị Coming in R2. |
| **09 System Settings** | General UI settings, Nano/G-Labs endpoint fields (chỉ local form/demo), diagnostics placeholders, version/core baseline info; `Test Connection` disabled/Coming in R3. |

**Các nút có thể hoạt động thật ở R1:** navigate, switch tabs/modes, select/filter/search mock data, sửa form, validate form, change/scrub playback-demo timeline, open/close dialog, copy text, export locally generated demo prompt, upload/parsing JSON syntax (không là backend import), toggle settings, reset demo. **Các nút gọi provider/native CLI chưa có implement:** disabled và giải thích rõ, không fake result.

## 3. Video Editor V3 — acceptance bắt buộc

1. Vùng desktop Editor dùng `height: calc(100dvh - app-topbar)` hoặc grid/flex tương đương với `min-height:0`; **không để preview 9:16 quyết định chiều cao toàn trang**. Sidebar/topbar giữ nguyên; editor ẩn stage strip và page intro dài đúng V3.
2. Workbench 3 cột: **Scenes & Assets (trái) / portrait preview (giữa) / Inspector (phải)**. Preview dùng `aspect-ratio: 9 / 16`, `max-height: 100%`, `object-fit: contain` hoặc tương đương; không làm méo khung hình.
3. Timeline phía dưới **mặc định cao 244px**, luôn hiển thị **6 track**: Scenes, Layers, Captions, Narration, SFX, Ambience và time ruler. Timeline scroll ngang nội bộ nếu nhiều clips; page Editor không scroll dọc desktop.
4. Splitter nằm giữa workbench/timeline, kéo chuột/pointer để đổi chiều cao, `ArrowUp/ArrowDown` đổi theo step, `Home` hoặc double-click reset; clamp kích thước để không giấu hoàn toàn preview hoặc tracks. Có `role="separator"`/ARIA label và keyboard focus.
5. `1280×720`, `1440×800`, `1600×900`, **`1656×790`** (CSS viewport): preview và **toàn bộ 6 track** đều nhìn thấy *không cuộn body*. Sidebar/scenes/inspector cuộn nội bộ khi cần. 1050×850 và 390×844 dùng responsive fallback, không tràn ngang viewport; trên mobile được phép cuộn dọc.
6. Select shot từ left pane và timeline đồng bộ với preview/inspector; seek và play/pause demo không để state lệch; inspector sửa thuộc tính demo và hiển thị unsaved/dirty indicator rõ ràng. Reset demo phục hồi dữ liệu mock, không ghi native manifest.
7. Edit / Native Preview / Approval dùng **cùng kích thước editor**, không làm timeline tụt khỏi viewport. QA Details dùng dialog/overlay có thể đóng bằng Escape và nút đóng. Native Preview/Approval phải hiện rõ chưa có native MP4/approval thật.
8. Các keyframe/layer controls chỉ mô phỏng field **đã có trong Mode B** (`x`,`y`,`w`,`angle`,`alpha`,`progress`), không tạo motion engine/rigging mới.

## 4. Electron shell và security tối thiểu

- `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webSecurity:true`; preload chỉ expose API cần thiết. CSP chặt; chặn navigation sang URL ngoài, chỉ mở external link bằng allowlisted HTTPS. Tắt remote content không cần thiết.
- Renderer không được `require`, `fs`, `child_process`, `exec`, raw IPC hoặc tự gọi Nano/G-Labs. Không lưu API keys vào repo/demo fixtures.
- Main process R1 chỉ bootstrap/app version/openExternal hợp lệ, không expose CLI execution/terminal. Chuẩn bị typed API bridge để R2/R3 gắn services mà không viết lại UI.
- `npm ci` reproducible, lockfile checked in. Không động tới package.json hoặc lockfile Mode B gốc.

## 5. Test local Windows — một lệnh

Tạo `studio/scripts/windows-r1-acceptance.ps1` chạy **không phụ thuộc GitHub Actions**, tạo `studio/.artifacts/r1-<timestamp>/` gồm `results.json`, các logs và screenshots. Không check-in output runtime.

Bắt buộc test:

- `npm ci --no-audit --no-fund` + `npm run typecheck` + `npm run lint` + `npm run test` + `npm run build`.
- UI smoke bằng Playwright (Chromium) hoặc tương đương: 9 pages, navigation order, Project Setup first/default, external JSON syntax error, storyboard select, script edit, settings toggles, no console exceptions/unhandled promise rejections.
- Screenshot UI actual React app **và V3 reference mockup** cùng 1656×790 + 1280×720; lưu side-by-side/comparison để review chênh lệch. Không tự tuyên bố pixel-perfect nếu chưa kiểm chứng.
- Editor test ở 1280×720 và 1656×790: `document.documentElement.scrollHeight <= window.innerHeight + tolerance`, timeline bottom <= viewport bottom; cả 6 track có bounding rect visible; preview 9:16; splitter pointer drag/keyboard/Home reset; switching 3 modes vẫn giữ layout.
- Mobile/narrow widths 390×844 và 1050×850: không horizontal overflow, navigation usable; native modal/QA accessible.
- Electron startup smoke trên Windows (app window thực, không chỉ website), verify security flags, no load failure/JS console crash.
- Verify Git native core unchanged:

```powershell
$changes = git diff --name-only main...HEAD -- skills/directing-stickman-videos/
if ($changes) { throw "MODE_B_CORE_CHANGED: $changes" }
```

- Run native Mode B tests **nếu dependencies đã sẵn** (`cd skills/directing-stickman-videos; npm test`). Nếu không thể chạy vì thiếu môi trường, ghi rõ `NOT_RUN` kèm lý do; tuyệt đối không claim PASS.
- Kết quả test phải phân loại `PASS | FAIL | NOT_RUN`, `results.json` không được báo xanh khi UI smoke/baseline test thất bại. Script lỗi thì exit nonzero.

## 6. Delivery / Definition of Done

- Push code và test evidence summary lên branch `feat/mode-b-ui-v3-baseline`; **không merge main**, không mở rộng scope qua R2/R3, không chỉnh mockup V3 đã khóa.
- Có thể chạy local: `cd studio`, `npm ci`, `npm run dev` (mở Electron), `npm run build`, `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-r1-acceptance.ps1`.
- Tất cả 9 pages có component riêng; Editor có các subcomponent như cấu trúc yêu cầu; code format/typecheck/lint/unit/build đạt; test UI và Windows acceptance có evidence rõ.
- Đối chiếu mockup V3 bằng screenshots và giữ UI parity; **không sử dụng `docs/ui/mockups/v3/*.html` làm runtime**.
- Kết thúc implementation báo: branch/HEAD, danh sách file chính, lệnh chạy, test matrix, đường dẫn evidence, UI screenshots, các hạn chế chỉ dành cho R2/R3.

## 7. Explicit out-of-scope — không triển khai trong R1

External ChatGPT **real** reservation/import/schema/repair, persistence production DB, VoiceStudio Nano calls, G-Labs Webhook jobs, force alignment, native Mode B CLI orchestration, native preview/approval/render, media export, B5 execution, installer packaging, cloud connectivity. Các integration points chỉ dựng type/interface/UI states để nối trong R2/R3, **không fake thành đã hoạt động**.

---

**Instruction to implementer:** Execute all R1 items above, test and self-repair **within a single implementation round**. Do not request further design approval or modify locked Mode B files. If a tool/dependency blocks a test, record the exact blocker and continue all independent work; never mark unexecuted tests as PASS.