COMMON_PASSWORDS = {
    "password",
    "password123",
    "password1234",
    "password12345",
    "12345678",
    "123456789",
    "1234567890",
    "qwerty123",
    "qwerty1234",
    "admin123",
    "admin1234",
    "admin12345",
    "letmein123",
    "welcome123",
    "welcome1234",
    "changeme123",
    "iloveyou123",
}


def is_common_password(password: str) -> bool:
    return password.strip().lower() in COMMON_PASSWORDS
