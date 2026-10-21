import asyncio
import getpass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.password_policy import is_common_password
from app.core.security import hash_password
from app.db import SessionLocal
from app.models.user import User


async def main():
    print("Create a ZeroProxy faculty account")

    name = input("Faculty name: ").strip()
    email = input("Faculty email: ").strip().lower()
    roll_no = input("Faculty/staff ID: ").strip()
    password = getpass.getpass("Password: ")
    confirm_password = getpass.getpass("Confirm password: ")

    if not name or not email or not roll_no:
        print("Name, email, and staff ID are required.")
        return

    if len(password) < 8 or len(password) > 128:
        print("Password must contain 8–128 characters.")
        return

    if password != confirm_password:
        print("Passwords do not match.")
        return

    if is_common_password(password):
        print("Choose a less common password.")
        return

    async with SessionLocal() as db:
        existing = await db.execute(
            select(User).where(
                (User.email == email) | (User.roll_no == roll_no)
            )
        )

        if existing.scalar_one_or_none() is not None:
            print("An account with that email or staff ID already exists.")
            return

        faculty = User(
            tenant_id=1,
            name=name,
            email=email,
            roll_no=roll_no,
            password_hash=hash_password(password),
            role="faculty",
            status="active",
            must_change_password=True,
        )

        db.add(faculty)

        try:
            await db.commit()
            print(f"Faculty account created successfully: {email}")
        except IntegrityError:
            await db.rollback()
            print("Account creation failed due to a duplicate record.")


if __name__ == "__main__":
    asyncio.run(main())