with open("./src/assets/new.txt", "r") as input_file, open("output_2_words.txt", "w") as output_file:
    for line in input_file:
        words = line.strip().split()
        if len(words) == 2:
            output_file.write(line)
