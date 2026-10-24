import argparse
import asyncio
import getpass
import sys

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.password_policy import is_common_password
from app.core.security import hash_password
from app.db import SessionLocal
from app.models.user import User


async def create_or_enable_faculty(name: str, email: str, roll_no: str, password: str, update_existing: bool = True):
    if not name or not email or not roll_no:
        print(" [!] Name, email, and staff ID are required.")
        return False

    if len(password) < 8 or len(password) > 128:
        print(" [!] Password must contain 8–128 characters.")
        return False

    if is_common_password(password):
        print(" [!] Please choose a stronger, less common password.")
        return False

    async with SessionLocal() as db:
        existing_result = await db.execute(
            select(User).where(
                (User.email == email) | (User.roll_no == roll_no)
            )
        )
        existing = existing_result.scalar_one_or_none()

        if existing is not None:
            if not update_existing:
                print(f" [!] An account with email '{email}' or staff ID '{roll_no}' already exists.")
                return False

            # Update and enable existing account as active faculty
            existing.name = name
            existing.email = email
            existing.roll_no = roll_no
            existing.role = "faculty"
            existing.status = "active"
            existing.password_hash = hash_password(password)
            existing.must_change_password = False

            await db.commit()
            print(f"\n [✓] Successfully updated and enabled '{email}' as an ACTIVE Faculty account!")
            print(f"     Email:    {email}")
            print(f"     Role:     faculty")
            print(f"     Status:   active")
            print(f"     Staff ID: {roll_no}\n")
            return True

        # Create new active faculty user
        faculty = User(
            tenant_id=1,
            name=name,
            email=email,
            roll_no=roll_no,
            password_hash=hash_password(password),
            role="faculty",
            status="active",
            must_change_password=False,
        )
        db.add(faculty)

        try:
            await db.commit()
            print(f"\n [✓] Faculty account created successfully!")
            print(f"     Email:    {email}")
            print(f"     Role:     faculty")
            print(f"     Status:   active")
            print(f"     Staff ID: {roll_no}\n")
            return True
        except IntegrityError:
            await db.rollback()
            print(" [!] Creation failed due to a duplicate database constraint.")
            return False


async def main():
    parser = argparse.ArgumentParser(description="Create or Enable a ZeroProxy Faculty Account")
    parser.add_argument("--name", help="Faculty full name")
    parser.add_argument("--email", help="Faculty email address")
    parser.add_argument("--staff-id", help="Faculty staff / employee ID")
    parser.add_argument("--password", help="Password (minimum 8 characters)")
    parser.add_argument("--no-update", action="store_true", help="Do not update if user already exists")
    args = parser.parse_args()

    # If flags are provided via CLI
    if args.email and args.password:
        name = args.name or args.email.split("@")[0].title()
        staff_id = args.staff_id or ("FAC" + args.email.split("@")[0][:4].upper())
        await create_or_enable_faculty(
            name=name,
            email=args.email.strip().lower(),
            roll_no=staff_id.strip(),
            password=args.password,
            update_existing=not args.no_update,
        )
        return

    # Interactive mode
    print("=" * 55)
    print(" ZeroProxy - Create or Enable Faculty Account")
    print("=" * 55)

    name = input("Faculty full name: ").strip()
    email = input("Faculty email address: ").strip().lower()
    roll_no = input("Staff / Employee ID (e.g. FAC001): ").strip()

    password = getpass.getpass("Password (min 8 chars): ")
    confirm_password = getpass.getpass("Confirm password: ")

    if password != confirm_password:
        print(" [!] Passwords do not match.")
        return

    await create_or_enable_faculty(
        name=name,
        email=email,
        roll_no=roll_no,
        password=password,
        update_existing=True,
    )


if __name__ == "__main__":
    asyncio.run(main())