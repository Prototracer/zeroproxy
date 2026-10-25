import argparse
import asyncio
import secrets
import sys

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.password_policy import is_common_password
from app.core.security import hash_password
from app.db import SessionLocal
from app.models.user import User


def generate_strong_password(length: int = 16) -> str:
    """Generate a high-entropy temporary password."""
    return secrets.token_urlsafe(length)[:length]


async def create_or_enable_staff_user(
    name: str,
    email: str,
    roll_no: str,
    password: str | None = None,
    role: str = "faculty",
    update_existing: bool = True,
):
    if not name or not email or not roll_no:
        print(" [!] Name, email, and staff/admin ID are required.")
        return False

    role = role.lower().strip()
    if role not in ("faculty", "admin"):
        print(" [!] Role must be 'faculty' or 'admin'.")
        return False

    generated = False
    if not password:
        password = generate_strong_password(16)
        generated = True
    else:
        if len(password) < 10 or len(password) > 128:
            print(" [!] Password must contain 10–128 characters.")
            return False
        if is_common_password(password):
            print(" [!] Password is too common. Please choose a stronger password.")
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
                print(f" [!] An account with email '{email}' or ID '{roll_no}' already exists.")
                return False

            existing.name = name
            existing.email = email
            existing.roll_no = roll_no
            existing.role = role
            existing.status = "active"
            existing.password_hash = hash_password(password)
            existing.must_change_password = True

            await db.commit()
            print(f"\n [✓] Successfully updated and enabled '{email}' as an ACTIVE {role.upper()} account!")
        else:
            staff_user = User(
                tenant_id=1,
                name=name,
                email=email,
                roll_no=roll_no,
                password_hash=hash_password(password),
                role=role,
                status="active",
                must_change_password=True,
            )
            db.add(staff_user)
            try:
                await db.commit()
                print(f"\n [✓] {role.capitalize()} account created successfully!")
            except IntegrityError:
                await db.rollback()
                print(" [!] Creation failed due to a duplicate database constraint.")
                return False

        print("=" * 60)
        print(f"  Email:              {email}")
        print(f"  Role:               {role}")
        print(f"  Status:             active")
        print(f"  Staff / Admin ID:   {roll_no}")
        print(f"  TEMPORARY PASSWORD: {password}")
        print("  (Shown ONCE. User must change password at first login)")
        print("=" * 60 + "\n")
        return True


async def main():
    parser = argparse.ArgumentParser(description="Create or Seed a ZeroProxy Faculty or Admin Account")
    parser.add_argument("--name", help="Full name")
    parser.add_argument("--email", help="Email address")
    parser.add_argument("--staff-id", help="Staff or Admin ID (e.g. FAC001, ADM001)")
    parser.add_argument("--password", help="Optional password (at least 10 characters). If omitted, a strong password is generated.")
    parser.add_argument("--role", choices=["faculty", "admin"], default="faculty", help="Role to assign (default: faculty)")
    parser.add_argument("--admin", action="store_true", help="Shortcut to create an admin account instead of faculty")
    parser.add_argument("--no-update", action="store_true", help="Do not update if user already exists")
    args = parser.parse_args()

    role = "admin" if args.admin else args.role

    if args.email:
        name = args.name or args.email.split("@")[0].title()
        prefix = "ADM" if role == "admin" else "FAC"
        staff_id = args.staff_id or (prefix + args.email.split("@")[0][:4].upper())
        await create_or_enable_staff_user(
            name=name,
            email=args.email.strip().lower(),
            roll_no=staff_id.strip(),
            password=args.password,
            role=role,
            update_existing=not args.no_update,
        )
        return

    # Interactive mode
    print("=" * 60)
    print(f" ZeroProxy - Create or Seed {role.capitalize()} Account")
    print("=" * 60)

    name = input(f"{role.capitalize()} full name: ").strip()
    email = input(f"{role.capitalize()} email address: ").strip().lower()
    prefix = "ADM001" if role == "admin" else "FAC001"
    roll_no = input(f"Staff / Employee ID (e.g. {prefix}): ").strip()

    custom_pwd = input("Enter password (press Enter to auto-generate strong password): ").strip()
    password = custom_pwd if custom_pwd else None

    await create_or_enable_staff_user(
        name=name,
        email=email,
        roll_no=roll_no,
        password=password,
        role=role,
        update_existing=True,
    )


if __name__ == "__main__":
    asyncio.run(main())