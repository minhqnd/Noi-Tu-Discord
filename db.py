import json

# Đọc giá trị của a và b từ tập tin
def read(key):
    with open("data.json", "r") as f:
        data = json.load(f)
        return data[key]

def store(key, data):
    with open('data.json', 'r') as f:
        tempdata = json.load(f)
    tempdata[key] = data
    with open('data.json', 'w') as f:
        json.dump(tempdata, f, ensure_ascii=False)