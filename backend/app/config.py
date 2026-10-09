import os

DATABASE_URL=os.getenv("DATABASE_URL")
JWT_SECRET=os.getenv("JWT_SECRET")
QR_MASTER_KEY=os.getenv("QR_MASTER_KEY")
ENC_KEY=os.getenv("ENC_KEY")
CAMPUS_CIDRS=[cidr.strip() 
              for cidr in os.getenv("CAMPUS CIDRS","").split(",")
              if cidr.strip()]

def validate_settings():
    required={
        "DATABASE_URL": DATABASE_URL,
        "JWT_SECRET":JWT_SECRET,
        "QR_MASTER_KEY":QR_MASTER_KEY,
        "ENC_KEY": ENC_KEY,
        "CAMPUS_CIDRS":CAMPUS_CIDRS
    }
    missing =[name for name,value in required.items() if not value]
    if(missing):
        raise RuntimeError(f"Missing required environment variables: {','.join(missing)}")