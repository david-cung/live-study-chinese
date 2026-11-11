# Giọng Việt VieNeu chạy trên máy

Project dùng VieNeu-TTS v3 Turbo qua Python SDK `vieneu==3.8.4`, chạy CPU/ONNX.
Model được giữ trong một tiến trình riêng suốt buổi live. Cài đặt và model nằm
trong `.vieneu/` (không đưa lên Git). Không cần API key cho cấu hình local.

Tài liệu SDK: https://pypi.org/project/vieneu/3.8.4/
Source VieNeu: https://github.com/pnnbao97/VieNeu-TTS

## Mở giọng Việt

Cần Node theo cấu hình project và Python 3.10+ hoặc `uv`.

- Windows: mở **BAT-GIONG-VIET.bat**.
- Mac: chạy `zsh BAT-GIONG-VIET.command` từ Terminal. Muốn mở bằng nhấp đúp,
  cấp quyền một lần bằng `chmod +x BAT-GIONG-VIET.command`.

Cách chạy thủ công từ thư mục project:

```sh
npm run voice:setup
npm run voice:start
```

Lần đầu cần mạng để tải thư viện và model. Giữ cửa sổ giọng Việt mở và chờ dòng
`VieNeu is ready` trước khi live. Các lần sau dùng lại model đã tải. Không cần
cài lại SDK mỗi lần mở file khởi động. Giọng Trung vẫn dùng dịch vụ giọng Trung
qua mạng để giữ cách phát âm tiếng Trung riêng.

Sau đó mở app như trước bằng BAT-LIVE hoặc `npm start`. Vào
**6. Đọc một câu trên live → Giọng đọc tiếng Việt**:

1. Chọn **VieNeu · Giọng tự nhiên trên máy**.
2. Bấm **Kiểm tra kết nối / Tải giọng**.
3. Chọn giọng cho **cô giáo** và **thầy giáo**, hoặc để tự chọn theo giới tính
   từ danh sách preset. Bấm **Lưu giọng**.
4. Mở sân khấu có tiếng, bấm **Lưu & nghe thử** để nghe lựa chọn vừa chọn.

Chọn thầy/cô trong mục 5 sẽ đổi cả hình ảnh và giọng tương ứng. Khi đổi giọng,
câu đang đọc được phát hết, câu sau dùng giọng mới. Cài đặt giọng được lưu trong
`settings.json`. Giọng mẫu có chất giọng khác nhau; nên nghe thử trước khi chọn.

## Khi chưa có giọng hoặc tải model lỗi

Trong lúc model đang tải hoặc nếu dịch vụ lỗi, app tự dùng giọng Edge/Google
dự phòng và báo trạng thái trên bảng điều khiển. Bấm kiểm tra lại sau khi model
sẵn sàng; âm thanh dự phòng không được ghi đè vào cache của VieNeu.

Nếu Python chưa cài được, cài Python 3.10+ hoặc `uv`, rồi chạy lại setup.
Nếu mạng báo lỗi chứng chỉ, dùng chứng chỉ CA tin cậy của hệ thống hoặc cấu hình
`SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` với CA của mạng đang dùng. Trên Windows,
setup xuất các CA tin cậy của Windows vào `.vieneu/system-ca.pem` cho pip và bộ
tải model, trừ khi người dùng đã cấu hình CA riêng. Không tắt xác minh TLS.

## Cổng và cấu hình tùy chọn

Bridge mặc định chỉ nghe tại `127.0.0.1:8000`. Node gọi API tương thích
`POST /v1/audio/speech` và `GET /v1/voices`; âm thanh trả về là WAV 48 kHz.

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `VIENEU_PORT` | `8000` | Cổng của bridge Python |
| `VIENEU_BASE_URL` | `http://127.0.0.1:8000/v1` | API mà app Node gọi |
| `VIENEU_TIMEOUT_MS` | `45000` | Giới hạn chờ một lần sinh giọng |
| `VIENEU_API_KEY` | trống | Bearer key tùy chọn; đặt cùng giá trị cho bridge và app |
| `VIENEU_BACKEND` | `onnx` | Backend SDK; mặc định CPU, không cần CUDA |

Nếu đổi cổng, cần đặt `VIENEU_PORT` cho bridge và `VIENEU_BASE_URL` tương ứng cho
app. Key chỉ nằm ở server, không gửi xuống trình duyệt. Giới hạn cache VieNeu
24 MiB, cache dự phòng 16 MiB; mỗi lần sinh giọng Việt được xếp hàng riêng để
không chạy nhiều bản model cùng lúc. Model và preset chỉ tải khi cần; muốn chạy
giọng Việt offline hoàn toàn sau khi đã tải đủ có thể đặt `HF_HUB_OFFLINE=1`.
