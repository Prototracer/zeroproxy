
import asyncio
from sqlalchemy import text
from app.db import engine


async def main():
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text("SELECT id, roll_no, role, status FROM users LIMIT 10")
            )

            users = result.fetchall()

            if users:
                for user in users:
                    print(user)
            else:
                print("No users found in the users table.")

    except Exception as e:
        print("Database query failed:", e)

    finally:
        await engine.dispose()


asyncio.run(main())
