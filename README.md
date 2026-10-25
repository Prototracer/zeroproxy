# ZeroProxy

Smart attendance platform: rotating QR + edge face recognition + liveness.

## Frontend Setup

1. **Navigate to frontend folder & install dependencies:**
   ```bash
   cd frontend
   npm install
   ```

2. **Download / prepare face-api models:**
   ```bash
   # From inside the frontend/ folder:
   # On Linux / macOS / Git Bash:
   ./scripts/download_models.sh

   # On Windows (PowerShell):
   .\scripts\download_models.ps1
   ```
   *Note: Model weights are placed into `frontend/public/models/` and are gitignored to keep the repository light.*

3. **Start local development server:**
   ```bash
   npm run dev
   ```
   Open `https://localhost:5180` in your browser. (Accept the self-signed certificate. HTTPS is required for camera access on phones).

## Backend & Account Seeding

Faculty and admin accounts are created only by administrators or via the seed script. There is no public faculty self-registration.

Run the seed script from the `backend/` directory:

```bash
# Interactive mode (generates a one-time temporary password):
python scripts/seed_faculty.py

# Create a faculty member with CLI arguments:
python scripts/seed_faculty.py --name "Dr. Jane Smith" --email "jane.smith@univ.edu" --staff-id "FAC001"

# Create or seed an administrator account:
python scripts/seed_faculty.py --admin --name "System Admin" --email "admin@univ.edu" --staff-id "ADM001"
```

The script generates a cryptographically strong temporary password shown once on the console, and sets `must_change_password=True`. The user must change their password on first login.
