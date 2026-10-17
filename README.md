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
