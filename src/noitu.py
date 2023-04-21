import random
import requests
from bs4 import BeautifulSoup
import json

with open("data.json", "r") as f:
    data = json.load(f)

# Load danh sách các từ có 2 từ vào một list
with open('src/assets/tudien.txt', 'r') as f:
    list_words = [word.strip().lower() for word in f.readlines()]

# trích xuất từ cuối cùng của một từ
def last_word(word):
    return word.split()[-1]

# trích xuất từ đầu tiên của một từ
def first_word(word):
    return word.split()[0]

def get_word_starting_with(start):
    matching_words = [word for word in list_words if word.split()[0] == start]
    if matching_words:
        word = random.choice(matching_words)
        return word
    else:
        return False


def getnoitu(player_word):
    return get_word_starting_with(last_word(player_word))

# http://tudientv.com/dictfunctions.php?action=getmeaning&entry=chào


async def tratu(word):
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
            print(text)
            return text
    else:
        return "Không thể lấy dữ liệu từ API"
