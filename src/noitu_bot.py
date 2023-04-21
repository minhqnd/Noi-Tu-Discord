import random
import db

# Load danh sách các từ có 2 từ vào một list
with open('src/assets/tudien.txt', 'r') as f:
    list_words = [word.strip().lower() for word in f.readlines()]


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
            response = 'Không tồn tại từ, vui lòng tìm từ khác, **còn ' + \
                str(sai) + ' lần thử** \nTừ hiện tại: **' + current_word + '**'
            return response
    # else:
    #     return loss()


def check_user(player_word, id_user):
    id_user = str(id_user)
    user_data = db.read('users').get(id_user, {})
    current_word = user_data.get('word', None)
    history = user_data.get('history', [])
    sai = int(user_data.get('sai', 0))

    if current_word:
        if last_word(current_word) == first_word(player_word) and sai != 3:
            if player_word in history or player_word not in list_words:
                return f'Đã trả lời từ hoặc từ không hợp lệ, vui lòng tìm từ khác\nTừ hiện tại: **{current_word}**'
            next_word = get_word_starting_with(last_word(player_word))
            current_word = next_word
            if not next_word or not next_word in history:
                current_word = random.choice(list_words)
                db.store(
                    'users', {id_user: {'word': current_word, 'history': []}})
                return '**BẠN ĐÃ THẮNG!** Từ mới: **' + current_word + '**'
            response = f'Từ tiếp theo: **{next_word}**'
            history.append(player_word)
            history.append(current_word)
            db.store(
                'users', {id_user: {'word': current_word, 'history': history}})
            return response
        else:
            current_word = random.choice(list_words)
            db.store('users', {id_user: {'word': current_word, 'history': []}})
            return f'> Thua cuộc, từ đầu bạn đưa ra phải trùng với từ cuối của bot hoặc từ phải có nghĩa! \nTừ mới: **{current_word}**'
    else:
        current_word = random.choice(list_words)
        db.store('users', {id_user: {'word': current_word,
                 'history': [current_word], 'sai': 0}})
        return f'Từ hiện tại: **{current_word}**'
