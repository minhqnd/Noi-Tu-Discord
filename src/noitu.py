import random
import requests
from bs4 import BeautifulSoup
import json

# Load dữ liệu từ file json
with open("data.json", "r") as f:
    data = json.load(f)

# Load danh sách các từ có 2 từ vào một list
with open('src/assets/tudien.txt', 'r') as f:
    list_words = [word.strip().lower() for word in f.readlines()]


def getnoitu(player_word):
    """
    Hàm trả về từ tiếp theo trong trò chơi Nối từ dựa trên từ người chơi nhập vào
    """
    if len(player_word.split()) != 2: 
        return 'Từ bắt buộc phải gồm 2 từ'
    else:
        matching_words = [word for word in list_words if word.split()[
            0] == player_word.split()[-1]]
        if matching_words:
            word = random.choice(matching_words)
            return word
        else:
            return 'None'


def tratu(word):
    """
    Hàm tra từ trong từ điển
    """
    url = "http://tudientv.com/dictfunctions.php"
    payload = {
        "action": 'getmeaning',
        "entry": word
    }
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Encoding': 'gzip, deflate, br'
    }
    response = requests.post(url, headers=headers, data=payload)
    response.encoding = 'UTF-8'

    if response.status_code == 200:
        if len(response.text) < 5:
            return 'Không tìm thấy từ trong api tudientv, có thể từ ở nguồn khác.'
        else:
            soup = BeautifulSoup(response.text, 'html.parser')
            text = soup.get_text(separator='\n')
            return text
    else:
        return "Không thể lấy dữ liệu từ API"
    
getnoitu('ngữ cảnh')