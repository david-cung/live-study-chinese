# Lớp Tiếng Trung Live

## Chạy trên Mac

Dùng Node 24 (`nvm install 24`, sau đó `nvm use 24`). Mở **BAT-LIVE.command** hoặc chạy:

```sh
./BAT-LIVE.command
```

File này build giao diện rồi chạy production; server không nạp Vite khi live.
Nếu macOS chặn mở file tải về, chạy lệnh trên từ Terminal trong thư mục dự án.
Cách chạy thủ công:

```sh
npm ci
npm run build
npm start
```

Bảng điều khiển: `http://localhost:3002`. Link sân khấu:
`http://lvh.me:3002/?view=stage`, giữ độ phân giải **1080 × 1920**.
Giữ một sân khấu có tiếng, hạn chế mở thêm nguồn Link trùng nhau.
Chế độ phát triển vẫn dùng `npm run dev`.

Trong **5. Tên kênh → Nhân vật giảng dạy**, chọn **Thầy giáo** hoặc **Cô giáo**.
Sân khấu và bản xem trước đổi nhân vật ngay, có hình đứng yên và hình đang nói.
Lựa chọn được lưu trong `settings.json` và khôi phục khi mở lại.

## Dạng câu hỏi trên live

Trong **3. Lớp học → Dạng câu hỏi**, chọn xen kẽ hoặc luyện riêng một dạng:

- **Chọn nghĩa đúng**: nhìn chữ Hán và chọn nghĩa tiếng Việt.
- **Nghe và chọn chữ**: nghe phát âm, chọn chữ tương ứng.
- **Điền từ còn thiếu**: hoàn thành câu có `___`, kèm gợi ý tiếng Việt.
- **Chọn pinyin đúng**: nhìn chữ Hán và chọn phiên âm có dấu thanh.
- **Tìm chữ theo nghĩa**: nhìn nghĩa tiếng Việt và chọn chữ Hán.

Mặc định xen kẽ cả năm dạng, mỗi vòng có đủ các dạng khả dụng và không lặp
liên tiếp cùng một dạng. Lựa chọn được lưu và áp dụng từ câu tiếp theo.
Người xem vẫn bình luận **A/B/C/D** (hoặc 1/2/3/4); điểm, VIP, câu thưởng x3/x5
và bảng xếp hạng dùng chung. Lệnh **đọc lại** nhắc gợi ý phù hợp với dạng bài;
đáp án và câu hoàn chỉnh chỉ được đọc sau khi hết giờ.

Sau mỗi 10 câu, lớp nghỉ ở phần đáp án 24 giây. Sân khấu chỉ mời tặng quà
khi đã đọc xong đáp án, lời khen và còn ít nhất 8 giây trước câu mới.
Lời mời cách nhau ít nhất 5 phút và tạm hoãn 2 phút sau khi nhận quà;
nếu đang có lời đọc khác thì bỏ qua khoảng nghỉ đó. Không nhắc quà khi đang trả lời.

Có sẵn **104 câu điền từ**: HSK1 và HSK2 mỗi cấp 36 câu, HSK3 có 32 câu,
trong `content/zh/hsk1/0-dien-tu.json`, `content/zh/hsk2/0-dien-tu.json`
và `content/zh/hsk3/0-dien-tu.json`. HSK3 có thêm 80 từ vựng theo năm chủ đề:
học tập và công việc, đi lại và đời sống, sức khỏe và cảm xúc, hoạt động và kế hoạch,
miêu tả và từ nối. Thư mục cấp học được tự động nạp vào danh sách chọn bài.
Muốn thêm câu, bổ sung vào mảng `cloze`:

```json
{
  "sentence": "我___学生。",
  "vi": "Tôi là học sinh.",
  "answer": "是",
  "options": ["是", "有", "在", "去"]
}
```

Mỗi câu có đúng một `___`, bốn lựa chọn khác nhau và một đáp án khớp `answer`.
Các lựa chọn phải có trong từ vựng của cấp đang học. Gợi ý tiếng Việt cần làm
rõ đáp án khi nhiều từ có thể điền đúng ngữ pháp. Chọn lại bài học để nạp nội
dung mới. Bài tự thêm không có câu điền từ vẫn chạy các dạng đủ dữ liệu.

## Đo RAM khi live

```sh
MEMORY_DIAGNOSTICS=1 ./BAT-LIVE.command
```

Server ghi số đo mỗi 10 giây và cung cấp `http://localhost:3002/api/diagnostics`.
Các trường `memory` tính bằng byte, `pid` là tiến trình server. `ai.pid` là CLI
do ứng dụng khởi chạy, không phải tiến trình Cursor IDE. Không ghi bình luận,
tên người xem hoặc nội dung giọng đọc trong số đo.

Thêm `&diagnostics=1` vào Link sân khấu để ghi số lượng audio/hàng đợi/cooldown
vào console trình duyệt mỗi 10 giây. Giọng đọc giữ tối đa một audio đang phát
và một audio tải trước; nhạc nền dùng audio riêng. Cache TTS tối đa 32 MiB/300 mục,
tổng hợp đồng thời tối đa hai nội dung và chờ tối đa 32 nội dung khác nhau.
Khi quá tải, thông báo giọng đọc chưa bắt đầu có thể được gom/bỏ theo nhóm;
điểm thưởng và sự kiện quà vẫn được xử lý.

Để so sánh trước/sau trên Mac M1 Pro:

1. Dùng cùng tài khoản, nguồn Link, độ phân giải, nhạc và lượng tương tác.
2. Trong Activity Monitor, theo dõi riêng server Node theo PID, CLI AI và LIVE Studio
   (kể cả tiến trình renderer/GPU). Ghi Memory Pressure và Swap Used; không cộng
   các vùng bộ nhớ chia sẻ như thể chúng độc lập.
3. Sau 10 phút làm nóng, ghi số đo tại phút 10, 30, 60, 90 và 120.
4. Thử đợt bình luận/quà/follow lớn, TTS lỗi, AI quá hạn và ngắt/nối lại TikTok.
   Hàng đợi phải thoát sau đợt tương tác; CLI cũ phải biến mất trước yêu cầu AI mới.
5. Phân biệt cache đã đầy và dữ liệu phiên (điểm, người đã nhận tên/quà) với
   cooldown/hàng đợi/audio. Dữ liệu phiên tăng theo số người tham gia là có chủ ý.
   Reconnect cùng phòng không xóa quyền lợi hoặc cộng lại điểm follow.

Nếu lỗi dọn nhóm tiến trình AI, ứng dụng chặn yêu cầu AI mới và báo lỗi; khởi động
lại ứng dụng sau khi kiểm tra PID. Không tìm/diệt các tiến trình Cursor khác theo tên.

## Kiểm tra

```sh
npm run lint
npm test
npm run build
npm run test:soak
```

`test:soak` mô phỏng hai giờ tương tác bằng thời gian giả lập với audio/TTS giả;
kiểm tra giới hạn tài nguyên, không phải benchmark RAM của LIVE Studio thực.
Phiên live hai giờ cần kiểm chứng trên máy phát theo các bước ở trên.
