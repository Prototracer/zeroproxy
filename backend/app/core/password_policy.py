
COMMON_PASSWORDS = {
    "password",
    "password123",
    "12345678",
    "123456789",
    "qwerty123",
    "admin123",
    "letmein",
    "welcome123",
}


def is_common_password(password: str) -> bool:
    return password.strip().lower() in COMMON_PASSWORDS
