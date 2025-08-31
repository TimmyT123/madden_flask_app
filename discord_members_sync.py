import os, json
import discord
import asyncio

from dotenv import load_dotenv
load_dotenv(".env")

TOKEN = os.getenv("WURD_TEST_BOT_TOKEN")  # <-- unique var for this bot
if not TOKEN:
    raise RuntimeError("WURD_TEST_BOT_TOKEN is not set")

GUILD_ID = 1144688789248282804

intents = discord.Intents.default()
intents.members = True
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    guild = client.get_guild(GUILD_ID)
    members = {str(m.id): m.display_name for m in guild.members}
    with open("discord_members.json", "w", encoding="utf-8") as f:
        json.dump(members, f, indent=2)
    print("✅ Member mapping saved")
    await client.close()

asyncio.run(client.start(TOKEN))
