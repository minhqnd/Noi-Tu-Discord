import discord
import os
from discord import app_commands
from src import log
from . import noitu_bot
import json

logger = log.setup_logger(__name__)

isPrivate = False
isReplyAll = True
discord_channel_id = os.getenv("DISCORD_CHANNEL_ID")
with open("data.json", "r") as f:
    data = json.load(f)


class aclient(discord.Client):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.activity = discord.Activity(
            type=discord.ActivityType.playing, name="gay")


async def send_message(message, user_message):
    global isReplyAll
    if not isReplyAll:
        author = message.user.id
        await message.response.defer(ephemeral=isPrivate)
    else:
        author = message.author.id
    try:
        # response = '> **' + user_message + '** - <@' + \
        #     str(author) + '>'
        # response = f"{response}{await responses.response(user_message)}"
        response = f"{await responses.response(user_message)}"
        if len(response) > 1900:
            # Split the response into smaller chunks of no more than 1900 characters each(Discord limit is 2000 per chunk)
            if "```" in response:
                # Split the response if the code block exists
                parts = response.split("```")
                # Send the first message
                if isReplyAll:
                    await message.channel.send(parts[0])
                else:
                    await message.followup.send(parts[0])
                # Send the code block in a seperate message
                code_block = parts[1].split("\n")
                formatted_code_block = ""
                for line in code_block:
                    while len(line) > 1900:
                        # Split the line at the 50th character
                        formatted_code_block += line[:1900] + "\n"
                        line = line[1900:]
                    formatted_code_block += line + "\n"  # Add the line and seperate with new line

                # Send the code block in a separate message
                if (len(formatted_code_block) > 2000):
                    code_block_chunks = [formatted_code_block[i:i+1900]
                                         for i in range(0, len(formatted_code_block), 1900)]
                    for chunk in code_block_chunks:
                        if isReplyAll:
                            await message.channel.send("```" + chunk + "```")
                        else:
                            await message.followup.send("```" + chunk + "```")
                else:
                    if isReplyAll:
                        await message.channel.send("```" + formatted_code_block + "```")
                    else:
                        await message.followup.send("```" + formatted_code_block + "```")
                # Send the remaining of the response in another message

                if len(parts) >= 3:
                    if isReplyAll:
                        await message.channel.send(parts[2])
                    else:
                        await message.followup.send(parts[2])
            else:
                response_chunks = [response[i:i+1900]
                                   for i in range(0, len(response), 1900)]
                for chunk in response_chunks:
                    if isReplyAll:
                        await message.channel.send(chunk)
                    else:
                        await message.followup.send(chunk)

        else:
            if isReplyAll:
                await message.channel.send(response)
            else:
                await message.followup.send(response)
    except Exception as e:
        if isReplyAll:
            await message.channel.send("> **Error: Something went wrong, please try again later!**")
        else:
            await message.followup.send("> **Error: Something went wrong, please try again later!**")
        logger.exception(f"Error while sending message: {e}")


async def send_start_prompt(client):
    import os.path

    config_dir = os.path.abspath(__file__ + "/../../")
    prompt_name = 'starting-prompt.txt'
    prompt_path = os.path.join(config_dir, prompt_name)
    try:
        if os.path.isfile(prompt_path) and os.path.getsize(prompt_path) > 0:
            with open(prompt_path, "r") as f:
                prompt = f.read()
                if (discord_channel_id):
                    # logger.info(f"Send starting prompt with size {len(prompt)}")
                    # responseMessage = await responses.response(prompt)
                    responseMessage = 'Started!'
                    channel = client.get_channel(int(discord_channel_id))
                    await channel.send(responseMessage)
                else:
                    logger.info(
                        "No Channel selected. Skip sending starting prompt.")
        else:
            logger.info(f"No {prompt_name}. Skip sending starting prompt.")
    except Exception as e:
        logger.exception(f"Error while sending starting prompt: {e}")


def run_discord_bot():
    client = aclient()

    @client.event
    async def on_ready():
        # await send_start_prompt(client)
        await client.tree.sync()
        logger.info(f'{client.user} is now running!')

    @client.tree.command(name="noitu_add", description="Thêm phòng game nối từ")
    async def chatadd(interaction: discord.Interaction):
        channel = str(interaction.channel.id)
        if channel in data["channels"]:
            await interaction.response.defer(ephemeral=False)
            await interaction.followup.send("> **Phòng hiện tại đã có trong cơ sở dữ liệu!**")
        else:
            data['channels'].append(channel)
            with open("data.json", "w") as file:
                json.dump(data, file)
            noitu_bot.start()
            await interaction.response.defer(ephemeral=False)
            await interaction.followup.send("> **Đã thêm phòng game nối từ, MoiChat sẽ trả lời mọi tin nhắn từ phòng này!**")
            logger.info(f"Thêm phòng mới {channel}!")

    @client.tree.command(name="noitu_remove", description="Xóa phòng game nối từ")
    async def chatremove(interaction: discord.Interaction):
        channel = str(interaction.channel.id)
        if channel in data["channels"]:
            data["channels"].remove(channel)
            with open("data.json", "w") as file:
                json.dump(data, file)
            await interaction.response.defer(ephemeral=False)
            await interaction.followup.send("> **Đã xóa phòng game nối từ.**")
            logger.info(f"Xóa phòng {channel}!")
        else: 
            await interaction.response.defer(ephemeral=False)
            await interaction.followup.send("> **Không thể xóa vì chưa thêm phòng.**")

    @client.tree.command(name="help", description="Hiển thị trợ giúp của bot")
    async def help(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=False)
        await interaction.followup.send(":star:**BASIC COMMANDS** \n\n    - `/chatadd` Thêm phòng chat tự động!\n    - `/chatremove` Xóa phòng chat tự động.\n    - `/noituadd` Thêm phòng game nối từ.\n    - `/noituremove` Xóa phòng game nối từ.")
        logger.info(
            "\x1b[31mSomeone need help!\x1b[0m")

    @client.tree.command(name="tratu", description="Tra từ hiện tại đang nối từ")
    async def sendtratu(interaction: discord.Interaction):
        responses = await noitu_bot.tratu()
        await interaction.response.defer(ephemeral=False)
        embed = discord.Embed(title="Từ điển Tiếng Việt", description=responses)
        await interaction.followup.send(embed=embed)

        logger.info(f"Tra từ!")


    @client.event
    async def on_message(message):

        if message.author.bot:
            return
        if message.author == client.user:
            return
        if not isinstance(message.channel, discord.channel.DMChannel):
            if not str(message.channel.id) in data["channels"]:
                return
        if isReplyAll:
            username = str(message.author)
            user_message = str(message.content)
            channel = str(message.channel)
            logger.info(
                f"\x1b[31m{username}\x1b[0m : '{user_message}' ({channel})")
            await sendnoitu(message, user_message)

    TOKEN = os.getenv("DISCORD_BOT_TOKEN")

    client.run(TOKEN)


async def sendnoitu(message, user_message):
    # if not noitu.current_word:
    #     print(message.channel.id)
    #     await message.channel.send(noitu.start())
    # else:
    await message.channel.send(f'{noitu_bot.check(user_message.lower(), message.channel.id)}')


async def startnoitu(message):
    await message.channel.send(noitu_bot.start())
