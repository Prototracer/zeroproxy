from app.core.security import (
    create_access_token,
    decode_access_token,
)

token= create_access_token(user_id=1,role="student")

print("Token created:",bool(token))

payload=decode_access_token(token)
print("Token verified",payload is not None)
print("User ID:",payload["sub"] if payload else None)
print("Role:",payload["role"] if payload else None)

invalid_payload=decode_access_token("invalid.token.value")
print("Invalid token rejected:",invalid_payload is None)