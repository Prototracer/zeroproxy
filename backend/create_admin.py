"""
CLI utility to seed or create an administrator account in ZeroProxy.
Usage:
    python create_admin.py --email admin@example.com --password YourSecurePassword123! --name "Admin User" --roll ADM001
"""

import argparse
import asyncio
import sys
from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.models.user import User


async def create_or_update_admin(email: str, password: str, name: str, roll_no: str):
    async with SessionLocal() as db:
        res = await db.execute(select(User).where(User.email == email))
        user = res.scalar_one_or_none()

        pwd_hash = hash_password(password)

        if user:
            print(f"[*] Updating existing user {email} to admin role...")
            user.role = "admin"
            user.status = "active"
            user.password_hash = pwd_hash
            user.name = name
            user.roll_no = roll_no
            user.must_change_password = False
        else:
            print(f"[*] Creating new administrator account: {email}...")
            user = User(
                tenant_id=1,
                roll_no=roll_no,
                name=name,
                email=email,
                password_hash=pwd_hash,
                role="admin",
                status="active",
                must_change_password=False,
            )
            db.add(user)

        await db.commit()
        await db.refresh(user)
        print(f"[+] Administrator ready! ID={user.id}, Email={user.email}, Role={user.role}")


def main():
    parser = argparse.ArgumentParser(description="Create or seed an admin account.")
    parser.add_argument("--email", default="admin@example.com", help="Admin email (default: admin@example.com)")
    parser.add_argument("--password", default="Admin@123456", help="Admin password (default: Admin@123456)")
    parser.add_argument("--name", default="System Administrator", help="Admin display name")
    parser.add_argument("--roll", default="ADM001", help="Admin roll/ID (default: ADM001)")
    args = parser.parse_args()

    asyncio.run(create_or_update_admin(args.email, args.password, args.name, args.roll))


if __name__ == "__main__":
    main()
