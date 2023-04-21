import re
import os

# Đường dẫn đến file txt ban đầu
input_file_path = "words.txt"

# Đường dẫn đến file txt mới sẽ ghi ra
output_file_path = "tudien.txt"

# Đọc nội dung file txt ban đầu
with open(input_file_path, "r") as input_file:
    content = input_file.read()

# Tìm tất cả các chuỗi "text" trong nội dung file
texts = re.findall(r'"text": "([\w\s-]+)",', content)

# Tạo danh sách mới để lưu các chuỗi có đúng 2 từ
filtered_texts = []
for text in texts:
    # Tách các từ bằng khoảng trắng
    words = text.split()
    # Kiểm tra xem chuỗi có đúng 2 từ không
    if len(words) == 2:
        filtered_texts.append(text)

# Ghi danh sách các chuỗi có đúng 2 từ ra file mới
with open(output_file_path, "w") as output_file:
    for text in filtered_texts:
        output_file.write(f"{text}\n")
