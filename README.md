# Moi Nối Từ — Bot Discord Game Nối Từ Tiếng Việt

Moi Nối Từ là bot Discord hỗ trợ chơi game nối từ Tiếng Việt với từ gồm 2 chữ. Bot cung cấp hai chế độ chơi (user vs bot và PvP), cùng các tiện ích tra cứu, thống kê và quản lý phản hồi nhằm nâng cao trải nghiệm người dùng.

![Ảnh minh họa tổng quan](https://example.com/screenshots/overview.png)

## Tính Năng

### 1) Game nối từ cốt lõi
- Luật chơi: người chơi nhập một từ Tiếng Việt gồm 2 chữ; người kế tiếp phải dùng chữ cuối của từ trước làm chữ đầu cho từ mới.
- Xác thực: bot kiểm tra định dạng hợp lệ, tra cứu trong từ điển và ngăn dùng lại từ đã xuất hiện trong ván hiện tại.

![Gameplay](https://example.com/screenshots/gameplay.png)

### 2) Chế độ chơi linh hoạt
- User vs Bot: bot tự động trả lời bằng một từ hợp lệ sau lượt của người chơi.
- PvP (Player vs Player): bot đóng vai trò trọng tài, phản hồi bằng reaction để thông báo kết quả: ✅ đúng, ❌ sai/không có từ, 🔴 đã lặp, ⚠️ sai định dạng.

![Chế độ chơi](https://example.com/screenshots/modes.png)

### 3) Tra cứu từ điển
Sử dụng lệnh `/tratu` để tra cứu nhanh định nghĩa/ý nghĩa của từ Tiếng Việt.

![Tra cứu từ điển](https://example.com/screenshots/dictionary.png)

### 4) Thống kê người chơi
Lệnh `/stats` hiển thị các chỉ số cá nhân trong kênh: chuỗi hiện tại, kỷ lục chuỗi, và số trận thắng.

![Thống kê](https://example.com/screenshots/stats.png)

### 5) Hệ thống phản hồi (feedback)
- Lệnh `/feedback` mở menu lựa chọn loại phản hồi: “Từ còn thiếu”, “Lỗi”, hoặc “Đóng góp tính năng”.
- Sau khi chọn, một biểu mẫu (modal) xuất hiện để nhập nội dung chi tiết; phản hồi được lưu kèm loại để thuận tiện theo dõi.

![Gửi phản hồi](https://example.com/screenshots/feedback-send.png)

### 6) Quản trị phản hồi (dành cho Admin/Mod)
- Lệnh `/viewfeedback` hiển thị danh sách phản hồi gần nhất kèm dropdown để chọn xem chi tiết.
- Màn hình chi tiết cho phép: đánh dấu “Đã giải quyết”, “Xóa”, hoặc “Quay lại” danh sách.

![Quản lý phản hồi](https://example.com/screenshots/feedback-admin.png)

## Hệ Thống Lệnh

### Nhóm lệnh trò chơi
- `/noitu_add` — Thêm phòng cho game nối từ.
- `/noitu_remove` — Xóa phòng khỏi game nối từ.
- `/newgame` — Khởi tạo ván mới.
	- Trong DM: reset ván của riêng bạn và sinh từ bắt đầu mới ngay lập tức.
	- Trong kênh server: khởi tạo một yêu cầu reset có thể hủy. Bot sẽ hiển thị nút “Hủy” và chờ trong khoảng thời gian cấu hình; nếu không ai hủy, ván sẽ được reset và bot thông báo từ mới.
	- Dùng để “bỏ qua” từ hiện tại khi bế tắc hoặc muốn đổi ván mới.

![Newgame Flow](https://example.com/screenshots/newgame.png)
- `/stats` — Xem thống kê cá nhân.

### Nhóm lệnh tiện ích
- `/tratu [từ]` — Tra cứu từ điển.
- `/feedback` — Gửi phản hồi (qua menu + modal).
- `/noitu_mode [bot|pvp]` — Đặt chế độ chơi cho kênh.
- `/help` — Hiển thị hướng dẫn.

### Nhóm lệnh quản trị
- `/viewfeedback` — Xem và quản lý phản hồi người dùng.

## Cài Đặt & Chạy

### Yêu cầu
- Node.js (phiên bản LTS khuyến nghị)
- npm

### Các bước cài đặt
1) Clone repository:
```bash
git clone https://github.com/minhqnd/Noi-Tu-Discord.git
cd Noi-Tu-Discord
```
2) Cài đặt dependencies:
```bash
npm install
```
3) Khai báo biến môi trường:
Tạo file `.env` và thêm token của bot:
```
DISCORD_TOKEN=<token_bot_discord_của_bạn>
```
4) Chạy bot:
```bash
npm start
```

## Đóng Góp
Đóng góp được hoan nghênh. Vui lòng mở issue để báo lỗi/đề xuất, hoặc gửi pull request với mô tả chi tiết thay đổi.
