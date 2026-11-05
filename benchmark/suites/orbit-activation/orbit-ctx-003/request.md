Đây là đặc tả cho việc tạm giữ đơn hàng. Hãy triển khai nó.

Tạm giữ đơn hàng
1. Nhân viên hỗ trợ có thể tạm giữ một đơn hàng đang mở bằng POST /orders/<id>/hold; trả về 200 và đơn hàng được đọc lại là đang tạm giữ.
2. Đơn hàng đang tạm giữ không thể giao: giao nó trả về 409 và nó vẫn đang tạm giữ.
3. POST /orders/<id>/release bỏ tạm giữ và đưa đơn hàng về trạng thái mở.
4. Mỗi lần tạm giữ ghi lại ai đã tạm giữ và vào lúc nào.
5. Đơn hàng lớn nên được bỏ tạm giữ nhanh chóng.
Ràng buộc: các route API hiện có giữ nguyên hợp đồng, và không thêm thư viện phụ thuộc nào.

Tiêu chí chấp nhận
- Tạm giữ một đơn hàng đang mở trả về 200, và đơn hàng được đọc lại là đang tạm giữ.
- Giao một đơn hàng đang tạm giữ trả về 409.
- Bỏ tạm giữ một đơn hàng đang tạm giữ đưa nó về trạng thái mở.
