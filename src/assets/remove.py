# with open("./src/assets/output.txt", "r") as input_file, open("output.txt", "w") as output_file:
#     lines = input_file.readlines()
#     sorted_lines = sorted(lines)
#     for line in sorted_lines:
#         output_file.write(line)


# with open("./src/assets/output.txt", "r") as input_file, open("output.txt", "w") as output_file:
#     unique_lines = set(input_file)
#     for line in unique_lines:
#         output_file.write(line)
        
# with open("./src/assets/tudien.txt", "r") as input_file, open("output.txt", "w") as output_file:
#     unique_lines = set()
#     for line in input_file:
#         # Loại bỏ khoảng trắng thừa
#         line = line.strip()
#         # Thêm vào tập hợp nếu chưa có
#         if line not in unique_lines:
#             unique_lines.add(line)
#             output_file.write(line + "\n")
       
with open("./src/assets/output.txt", "r") as input_file, open("sorted_output.txt", "w") as output_file:
    lines = input_file.readlines()
    sorted_lines = sorted(lines)
    for line in sorted_lines:
        output_file.write(line)

