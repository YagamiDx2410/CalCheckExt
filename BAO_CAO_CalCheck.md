# Báo cáo đánh giá CalCheck v2.33.0

Phạm vi: đọc toàn bộ mã nguồn trong thư mục (manifest, background.js, popup.js, popup.html, offscreen.js, README). Không build, không chạy thử, không sửa code. Mọi nhận định dưới đây đến từ việc đọc code; hành vi thực tế trên KM Design chưa được kiểm chứng.

## 1. Kết luận ngắn

CalCheck là một công cụ tự động hoá kiểm tra cấu hình (QA / LiveOps) có giá trị thực: nó thay một quy trình đối chiếu thủ công giữa ticket Jira và trang KM Design bằng một lần bấm, kèm ảnh bằng chứng. Phần hiểu nghiệp vụ và phần xử lý lỗi chụp ảnh là điểm mạnh rõ nhất. Phần kỹ thuật phần mềm (test, cấu trúc code, quản lý phiên bản) là điểm yếu rõ nhất.

Đưa vào phỏng vấn thì nên, đặc biệt cho vị trí QA automation, SDET, tools / internal tooling. Với vị trí software engineer thuần, nó là một câu chuyện tốt về giải quyết vấn đề, nhưng người phỏng vấn sẽ hỏi về test và kiến trúc, và hiện tại câu trả lời còn yếu.

## 2. Extension làm gì

1. Người dùng dán link ticket Jira. Popup gọi Jira REST API (`/rest/api/3/issue/<key>`) bằng phiên đăng nhập sẵn có, đọc mô tả ở dạng ADF JSON.
2. Bộ đọc ticket suy ra danh sách "case" cần kiểm: Calendar ID, Program ID, Flag, Event ID, Package Tag, Shard Tag, County Config ID, ngày, giờ, Pre / Duration / Post, Global, Repeat.
3. Service worker mở một tab ẩn tới KM Design, lọc danh sách calendar theo id, mở calendar, mở popup chương trình, đọc các trường trong popup.
4. So sánh từng trường, cho PASS / FAIL / Note từng dòng.
5. Chụp ảnh qua Chrome DevTools Protocol, ghép phần báo cáo chữ lên trên ảnh, khoanh đỏ trường sai, lưu file. Tên file bắt đầu bằng `FAILED - ` khi sai.
6. Chạy một chương trình hoặc cả lô (ví dụ trong changelog: 2 calendar × 38 chương trình = 78 dòng kiểm).

## 3. Số liệu

| Mục | Giá trị |
|---|---|
| Nền tảng | Chrome Extension Manifest V3, JavaScript thuần, không framework, không bước build |
| Mã tự viết | khoảng 3.400 dòng: background.js 1.620, popup.js 1.708, offscreen.js 44, popup.html 221 |
| Thư viện ngoài | html2canvas (chỉ dùng làm phương án dự phòng) |
| Quyền | scripting, tabs, downloads, notifications, storage, alarms, debugger, offscreen; host giới hạn 2 domain |
| Phiên bản | 2.6 → 2.33.0, khoảng 45 bản phát hành ghi trong changelog |
| Thời gian | file cũ nhất 17/9, mới nhất 4/11: khoảng 7 tuần |
| Loại ticket hỗ trợ | Fund/Event, stacked, KvK (3 biến thể), Offer/Store Window, Boss-spawn v3/v4, Onboarding, Mission, Titan |
| Test tự động | không có trong thư mục |
| Git | không có; phiên bản lưu bằng file zip |

## 4. Điểm mạnh

### 4.1 Hiểu nghiệp vụ sâu, và mã hoá được nó

Đây là phần khó sao chép nhất. Vài ví dụ cụ thể:

- So sánh thời lượng theo giá trị, không theo ký tự: `24h` bằng `1d`, `23h50m` bằng `23h 50m` ([background.js:29](background.js:29)).
- So sánh id theo nguyên cả id, không theo "chứa": `kvk-c033` không khớp `kvk-c033-b072`. Khi gần đúng, báo rõ "thừa 1 ký tự", "khác ngày" bằng khoảng cách Levenshtein ([background.js:198](background.js:198)).
- Kiểm tra vị trí: một event id nằm trong Package Tags là FAIL và nêu tên trường sai.
- Ngày dạng `03/11/2026` được phân xử ngày/tháng bằng thứ trong tuần nếu ticket có ghi ([popup.js:215](popup.js:215)).
- KM có nhiều mục When: ngày và giờ phải thuộc cùng một mục, không ghép ngày của mục này với giờ của mục kia ([background.js:125](background.js:125)).
- Id bị dính nhau trong Jira (`ev.Atag.B`) được tách, nhưng nếu KM có đúng id đó ở dạng liền thì giữ nguyên ([background.js:631](background.js:631)).

### 4.2 Nguyên tắc "không đoán"

Khi ticket mơ hồ, công cụ không tự chọn một cách hiểu. Nó báo `TICKET DATA ERROR`, hoặc ghi Note không tính điểm, hoặc cảnh báo "enter manually". Với một công cụ kiểm tra, PASS sai nguy hiểm hơn FAIL sai, và thiết kế này cho thấy bạn hiểu điều đó. Đây là điểm đáng nói nhất khi phỏng vấn.

### 4.3 Xử lý chụp ảnh trên tab ẩn

Chuỗi sửa lỗi từ v2.15 đến v2.29 là một câu chuyện debug thật:

- Chuyển từ html2canvas sang `chrome.debugger` + `Page.captureScreenshot` để chụp được tab ẩn.
- Phát hiện banner "started debugging" xuất hiện trễ làm co viewport: gắn debugger từ đầu lượt chạy, chờ viewport ổn định ([background.js:1312](background.js:1312)).
- Khoá kích thước viewport và device pixel ratio suốt lượt chạy ([background.js:1322](background.js:1322)).
- Đo, chụp, đo lại; nếu popup dịch chuyển thì bỏ ảnh.
- Phát hiện ảnh bị lặp 2×2 bằng cách thu nhỏ còn 96×96 rồi so hai nửa ([background.js:1358](background.js:1358)).
- Thử lại 3 mức, rồi lùi về html2canvas, rồi lùi về báo cáo chỉ có chữ. Bằng chứng không bao giờ mất hẳn.

### 4.4 Xử lý đúng các ràng buộc của Manifest V3

- Service worker không có DOM: ghép ảnh bằng `OffscreenCanvas`.
- Service worker không ghi được vào thư mục người dùng chọn: dùng offscreen document, chia sẻ directory handle qua IndexedDB ([offscreen.js](offscreen.js)).
- Popup đóng là mất trạng thái: lưu phiên vào `chrome.storage.local`, giữ trạng thái lượt chạy ở service worker, popup mở lại thì nối tiếp.
- Lỗi ghi thư mục thì lùi về Downloads và ghi vào log.

### 4.5 Sản phẩm được dùng thật

Changelog gắn với mã ticket thật (KM-62668, KM-63219, KM-63509, …). Mỗi bản sửa một tình huống người dùng gặp. Các tính năng như chọn dòng để chạy, chạy lại riêng dòng lỗi, log chỉ lưu khi có vấn đề, lý do FAIL hiện ngay dưới tên chương trình đều là dấu hiệu của công cụ có người dùng hằng ngày.

### 4.6 Phạm vi quyền hẹp

Chỉ hai host, không có server riêng, không gửi dữ liệu ra ngoài, dùng phiên đăng nhập sẵn có. Phù hợp cho công cụ nội bộ.

## 5. Điểm yếu và rủi ro

Xếp theo mức độ ảnh hưởng.

### 5.1 Không có test tự động

Bộ đọc ticket gồm nhiều hàm thuần (`parseTicketTable`, `pickShard`, `durSeconds`, `cmpWhen`, `slashDate`, …), rất dễ viết unit test, nhưng thư mục không có test nào. README có nhắc "test Chrome", nên có thể bạn có bộ thử ở nơi khác; nếu có thì nên đưa vào cùng repo.

Hệ quả: 45 bản phát hành, mỗi bản thêm một nhánh điều kiện cho một kiểu ticket. Không có gì bảo đảm bản 2.33 không làm hỏng kiểu ticket của bản 2.17. Changelog đã ghi nhận ít nhất hai lần như vậy (v2.17.0 sửa lỗi do v2.16.2 gây ra; v2.31.1 sửa quy tắc tách id của v2.6).

### 5.2 Bộ đọc ticket là chuỗi heuristic chồng lên nhau

`parseTicketTable` dài khoảng 430 dòng, chứa các chế độ `calGroupMode`, `calTagMode`, mission, fan-out, ánh xạ theo `wkN`, suy ra tag từ `sw.*`. Nhiều quy tắc được viết cho đúng một ticket:

- Tên chương trình chứa "store" / "shop" thì không có event ([popup.js:725](popup.js:725)).
- Shard tag mặc định `events-v3nux-spawn` / `events-v4-spawn` viết cứng ([popup.js:1301](popup.js:1301)).
- Ba thế hệ bộ đọc cùng tồn tại: `parseTicketV2`, `parseTicket`, `parseAdf`, `parseTicketHtml`.

Rủi ro thật sự là PASS sai: một quy tắc khớp nhầm kiểu ticket và bỏ qua một trường. Gốc rễ là ticket Jira không có mẫu cố định. Hướng xử lý bền hơn là chuẩn hoá mẫu ticket ở phía người viết, không phải thêm heuristic.

### 5.3 Phụ thuộc vào giao diện KM Design

Dữ liệu được đọc bằng cách dò DOM: `.MuiDialog-paper`, `span.cursor-pointer.underline`, khớp chữ nhãn "Event IDs", vị trí header trong khoảng `top` 100–360 px ([background.js:687](background.js:687)). KM Design đổi class hoặc bố cục là công cụ hỏng. Nếu KM Design có API, đọc qua API sẽ bền hơn nhiều và chỉ cần giao diện cho phần chụp ảnh. Người phỏng vấn gần như chắc chắn sẽ hỏi câu này.

### 5.4 Cấu trúc code

- Hai file hơn 1.600 dòng, nhiều dòng dài trên 300 ký tự, có hàm được viết dưới dạng chuỗi (`HL_FN`, `measure`, `EXPAND`).
- Code lặp: bảng tháng `MON` / `MON_BG`, hàm ghi file ở cả popup và offscreen, hàm duyệt bảng ADF viết lại 5 lần.
- Code chết: `cmpContains`, `cmpMulti`, `cmpTime`, `cmpDate`, `cmpPlacement` không còn được gọi. Nhánh ghi thư mục từ popup (`batchFolderMode`) cũng không còn chạy vì `imageDataUrl` luôn rỗng.
- Khoá `"Global"` lặp hai lần trong `FIELD_OF` ([background.js:546](background.js:546)).
- Trạng thái toàn cục (`RUN`, `CAP`, `CUR`, `dbgTab`, `lastHl`) nằm trong bộ nhớ service worker. Nếu Chrome dừng worker giữa lượt chạy thì mất lượt chạy.
- Offscreen document chỉ được đóng ở nhánh thành công của lượt chạy đơn; lượt chạy lô không đóng ([background.js:1606](background.js:1606)).

### 5.5 Tài liệu lệch với code

- README ghi "version shown should be 2.10.0", bản thật là 2.33.0.
- README và popup ghi "exact match (7d must be exactly 7d)", trong khi từ v2.22.2 thời lượng so theo giá trị.

### 5.6 Quy trình

- Không có git. 45 bản phát hành chỉ còn lại hai file zip (v2.22, v2.33).
- Phân phối bằng "Load unpacked". Quyền `debugger` sẽ bị xét kỹ nếu đưa lên Chrome Web Store, nên cách này hợp lý cho nội bộ, nhưng mỗi người dùng phải tự cập nhật.
- Chỉ một người hiểu toàn bộ quy tắc.

## 6. Đánh giá giá trị

| Khía cạnh | Mức | Ghi chú |
|---|---|---|
| Giá trị cho đội | Cao | Thay việc thủ công lặp lại, có bằng chứng lưu được |
| Hiểu nghiệp vụ | Cao | Điểm mạnh nhất |
| Độ bền vận hành (retry, fallback, log) | Khá cao | Phần chụp ảnh làm rất kỹ |
| Chất lượng kỹ thuật phần mềm | Trung bình thấp | Không test, monolith, không git |
| Khả năng bảo trì bởi người khác | Thấp | Heuristic nhiều, tài liệu chủ yếu là changelog |
| Khả năng tái sử dụng ngoài công ty | Gần như không | Gắn chặt vào KM Design và mẫu ticket nội bộ |

Về con số: tôi không có dữ liệu thời gian thật. Ước lượng của tôi, cần bạn kiểm lại: kiểm tay một chương trình (mở calendar, mở popup, đối chiếu khoảng 8 trường, chụp ảnh, đặt tên file) mất 1–2 phút. Ticket 78 dòng vì thế mất khoảng 1,5–2,5 giờ làm tay. Bạn nên đo ba số thật trước khi phỏng vấn:

1. Thời gian kiểm tay so với dùng công cụ, trên cùng một ticket.
2. Số ticket mỗi tuần và số người dùng công cụ.
3. Số lỗi cấu hình công cụ bắt được trước khi lên production, nhất là loại mắt người dễ sót (thừa một ký tự, id nằm nhầm trường, flag còn `tbd`).

Con số thứ ba có sức nặng nhất.

## 7. Khi đề cập trong phỏng vấn

### 7.1 Cách giới thiệu (khoảng 30 giây)

> Đội tôi phải đối chiếu thủ công cấu hình lịch sự kiện trong game giữa ticket Jira và công cụ thiết kế nội bộ, mỗi ticket có thể vài chục chương trình. Tôi viết một Chrome extension đọc ticket qua Jira API, tự mở từng chương trình trong tab ẩn, so sánh từng trường và lưu ảnh bằng chứng có khoanh chỗ sai. Việc mất [X giờ] còn [Y phút], và nó bắt được [N] lỗi mà kiểm tay hay sót.

Điền số thật vào ba chỗ trống. Không có số thì nói "từ khoảng vài giờ xuống vài phút" và nói rõ đó là ước lượng.

### 7.2 Ba câu chuyện nên chuẩn bị

1. **Ảnh chụp bị lặp 2×2** (v2.17.2 → v2.17.4). Triệu chứng, các giả thuyết sai, nguyên nhân thật (banner debugger co viewport sau khi đã đo; tab chưa từng hiển thị render ở tỉ lệ khác), cách sửa, và lớp phòng vệ thêm vào (phát hiện ảnh lặp, thử lại). Đây là câu chuyện debug tốt nhất bạn có.
2. **Quyết định "không đoán"**. Vì sao chọn báo `TICKET DATA ERROR` thay vì chọn đại một giá trị; vì sao Flag chuyển từ so sánh sang chỉ ghi nhận rồi lại so sánh riêng cho KvK. Cho thấy bạn cân nhắc PASS sai và FAIL sai.
3. **So sánh "chứa" đổi thành "nguyên id"** (v2.23.0). Bạn phát hiện chính công cụ của mình cho PASS sai (`…zulrashards` vẫn qua), và sửa. Thừa nhận lỗi của mình rồi nêu cách khắc phục luôn được đánh giá cao.

### 7.3 Câu hỏi sẽ gặp và hướng trả lời

| Câu hỏi | Hướng trả lời |
|---|---|
| Sao không dùng API của KM Design mà đi dò giao diện? | Nói thật lý do (không có API, không có quyền, hoặc cần ảnh giao diện làm bằng chứng). Thừa nhận đây là điểm dễ gãy và nêu cách bạn giảm rủi ro: tìm theo nhãn chữ, báo "could not read" thay vì PASS. |
| Bạn test nó thế nào? | Điểm yếu nhất. Đừng nói quá. Nói thật hiện kiểm bằng ticket thật, rồi nêu kế hoạch: lưu ADF JSON của các ticket đã gặp làm fixture, viết snapshot test cho bộ đọc. Tốt hơn nữa là làm việc này trước buổi phỏng vấn. |
| Làm sao biết công cụ không cho PASS sai? | Trường trống thì bỏ qua và ghi rõ; id so nguyên vẹn; dữ liệu mơ hồ thì FAIL kèm lý do; ảnh chụp cho phép người xem kiểm lại. Thừa nhận heuristic vẫn có thể khớp nhầm kiểu ticket. |
| Sao cần quyền `debugger`? Quyền này rất mạnh. | Chụp tab ẩn không nhấp nháy, khoá viewport, chặn thao tác người dùng trong lúc chạy. Đánh đổi: banner vàng, khó lên Web Store; chấp nhận được vì là công cụ nội bộ, host giới hạn 2 domain. |
| Service worker MV3 bị dừng thì sao? | Alarm đánh thức định kỳ, phiên debugger đang mở, trạng thái lượt chạy để popup nối lại. Thừa nhận trạng thái còn nằm trong bộ nhớ; nếu worker bị dừng thật thì mất lượt chạy, và hướng sửa là ghi tiến độ vào `chrome.storage.session`. |
| File 1.700 dòng, sao không tách module? | Ưu tiên giao nhanh cho người dùng, không có bước build để cài đặt đơn giản. Nêu cách bạn sẽ tách: `parser/`, `compare/`, `capture/`, `ui/`, dùng ES module (MV3 hỗ trợ sẵn, không cần bundler). |
| Nếu làm lại từ đầu? | Chuẩn hoá mẫu ticket trước; mỗi kiểu ticket một parser riêng sau một bước nhận dạng; test từ ngày đầu; git từ ngày đầu. |
| Mẫu ticket đổi liên tục, cách này có bền không? | Không. Nói thẳng rằng giải pháp gốc là thống nhất mẫu ticket hoặc dữ liệu có cấu trúc, công cụ chỉ là cách giảm đau trong lúc chưa có điều đó. Câu trả lời này cho thấy bạn nhìn ra vấn đề hệ thống. |

### 7.4 Điều cần cẩn thận

- **Bảo mật thông tin công ty.** Mã nguồn chứa domain nội bộ, mã ticket, tên sự kiện, cấu trúc dữ liệu game. Không đưa code, ảnh chụp hay file zip cho nhà tuyển dụng, không đẩy lên GitHub công khai, trừ khi công ty cho phép. Khi kể, dùng mô tả chung: "công cụ thiết kế nội bộ", "ticket cấu hình sự kiện". Muốn có bản demo thì dựng một trang giả và ticket giả.
- **Quyền sở hữu.** Công cụ viết trong giờ làm, cho việc của công ty, nhiều khả năng thuộc về công ty. Trình bày nó là kinh nghiệm làm việc, không phải dự án cá nhân.
- **Nói đúng phần mình làm.** Nếu bạn dùng trợ lý AI để viết một phần code, hãy nói thẳng và chuẩn bị giải thích được từng phần được hỏi (ví dụ thuật toán phát hiện ảnh lặp, cách xử lý `rowspan` trong ADF). Người phỏng vấn sẽ đào sâu đúng vào chỗ nghe ấn tượng nhất.
- **Đừng gọi nó là framework hay nền tảng.** Nó là một công cụ nội bộ giải quyết tốt một việc. Nói đúng tầm thì đáng tin hơn.

### 7.5 Mức độ phù hợp theo vị trí

| Vị trí | Phù hợp | Nên nhấn vào |
|---|---|---|
| QA automation / SDET | Rất phù hợp | Tư duy kiểm thử, PASS sai / FAIL sai, bằng chứng, chạy lại dòng lỗi |
| Tools / internal tooling / LiveOps engineer | Rất phù hợp | Hiểu người dùng, lặp nhanh theo phản hồi, độ bền vận hành |
| Frontend / web engineer | Khá | MV3, CDP, OffscreenCanvas, File System Access; chuẩn bị cho câu hỏi về cấu trúc code |
| Backend / software engineer cấp senior | Vừa phải | Dùng làm ví dụ về chủ động và debug; đừng lấy làm bằng chứng về thiết kế hệ thống |

## 8. Việc nên làm trước khi phỏng vấn

Theo thứ tự lợi ích trên công sức. Chưa việc nào được thực hiện trong lần đánh giá này.

1. Đưa vào git (repo riêng tư), commit từng bản zip còn giữ để có lịch sử.
2. Đo ba con số ở mục 6.
3. Lưu ADF JSON của 8–10 ticket đại diện làm fixture, viết snapshot test cho `parseTicketV2`. Chỉ cần Node, không cần Chrome. Việc này biến điểm yếu lớn nhất thành một câu trả lời tốt.
4. Xoá code chết, sửa README (số phiên bản, câu "exact match").
5. Tách `popup.js` thành phần đọc ticket và phần giao diện.
