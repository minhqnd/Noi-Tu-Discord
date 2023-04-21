import random
import requests
from bs4 import BeautifulSoup
from src import log
import json

with open("data.json", "r") as f:
    data = json.load(f)

# Load danh sách các từ có 2 từ vào một list
with open('src/assets/tudien.txt', 'r') as f:
    list_words = [word.strip().lower() for word in f.readlines()]

# Chọn ngẫu nhiên một từ từ danh sách các từ có 2 từ
# current_word = random.choice(list_words)
current_word = ''
player_word = ''
history = []
sai = 3
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
        addHistory(word)
        return word
    else:
        return False


def check_channel(player_word, id_channel, id_user):
    return 'test'
    global sai, current_word, data
    id = str(id)
    if id in data["word"]:
        print('ok')
    else:
        print('ok 2')
        return start()

    
    if not current_word:
        current_word = random.choice(list_words)
    
    if last_word(current_word) == first_word(player_word) and sai != 1:
        if player_word in history:
            return 'Đã trả lời từ, vui lòng tìm từ khác'
        if player_word in list_words:
            addHistory(player_word)
            # Tìm một từ mới từ danh sách các từ có 2 từ để đưa ra
            next_word = get_word_starting_with(last_word(player_word))
            current_word = next_word
            if not next_word:
               return win()
            response = 'Từ tiếp theo: **' + next_word + '**'
            return response
        else:
            print('Không tồn tại từ, vui lòng tìm từ khác')
            sai -= 1
            response = 'Không tồn tại từ, vui lòng tìm từ khác, **còn ' + str(sai) + ' lần thử** \nTừ hiện tại: **' + current_word + '**'
            return response
    # else:
    #     return loss()
    
def check_user(player_word, id_user):
    global sai, current_word, data
    id = str(id)
    if id in data["word"]:
        print('ok')
    else:
        print('ok 2')
        return start()

    
    if not current_word:
        current_word = random.choice(list_words)
    
    if last_word(current_word) == first_word(player_word) and sai != 1:
        if player_word in history:
            return 'Đã trả lời từ, vui lòng tìm từ khác'
        if player_word in list_words:
            addHistory(player_word)
            # Tìm một từ mới từ danh sách các từ có 2 từ để đưa ra
            next_word = get_word_starting_with(last_word(player_word))
            current_word = next_word
            if not next_word:
               return win()
            response = 'Từ tiếp theo: **' + next_word + '**'
            return response
        else:
            print('Không tồn tại từ, vui lòng tìm từ khác')
            sai -= 1
            response = 'Không tồn tại từ, vui lòng tìm từ khác, **còn ' + str(sai) + ' lần thử** \nTừ hiện tại: **' + current_word + '**'
            return response
    # else:
    #     return loss()

def win():
    newgame()
    return '**BẠN ĐÃ THẮNG!** Từ mới: **' + current_word + '**'

def loss():
    newgame()
    return '> Thua cuộc, từ đầu bạn đưa ra phải trùng với từ cuối của bot hoặc từ phải có nghĩa! \nTừ mới: **' + current_word + '**'

def newgame():
    global current_word, history, sai
    sai = 3
    current_word = randomWord()
    history = []

def start():
    print('ok3')
    #TODO ghi người dùng mới
    newgame()
    return 'Từ hiện tại: **' + current_word + '**'

def randomWord():
    word = random.choice(list_words)
    addHistory(word)
    return word

def addHistory(word):
    history.append(word)

# http://tudientv.com/dictfunctions.php?action=getmeaning&entry=chào

async def tratu():
    global current_word
    url = "http://tudientv.com/dictfunctions.php"
    payload = {
        "action": 'getmeaning',
        "entry": current_word
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