import secrets

# Characters excluding easily confused glyphs: 0, O, 1, I, L
JOIN_CODE_CHARACTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_course_join_code(length: int = 6) -> str:
    """Generate a clean, unambiguous uppercase alphanumeric course join code."""
    return "".join(secrets.choice(JOIN_CODE_CHARACTERS) for _ in range(length))
