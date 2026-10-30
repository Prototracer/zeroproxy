# ZeroProxy

ZeroProxy is a full-stack web application designed to eliminate proxy attendance (or manage secure proxy/network operations) with a modern Vite + Tailwind CSS frontend, a Python REST API backend, and containerized Nginx + Docker deployment.

---

## Tech Stack

### Frontend
- **Build Tool:** Vite (`vite.config.js`)
- **Styling:** Tailwind CSS & PostCSS (`tailwind.config.js`, `postcss.config.js`)
- **Language:** JavaScript / HTML5

### Backend
- **Language:** Python 3.x
- **Framework:** FastAPI / Flask (via `backend/app`)
- **Database Migrations:** Alembic (`alembic.ini`, `backend/migrations`)
- **Dependency Management:** `pip` (`requirements.txt`)

### DevOps & Deployment
- **Containerization:** Docker & Docker Compose (`deploy/docker-compose.yml`)
- **Reverse Proxy / Web Server:** Nginx (`deploy/nginx.conf`)

---

## Project Structure

```text
zeroproxy/
├── backend/
│   ├── app/                  # Core Python application source code
│   ├── migrations/           # Alembic database migration scripts
│   ├── alembic.ini           # Alembic configuration
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── src/                  # Frontend components, pages, and assets
│   ├── scripts/              # Frontend helper/build scripts
│   ├── index.html            # Main HTML entry point
│   ├── package.json          # Node.js dependencies and scripts
│   ├── postcss.config.js     # PostCSS configuration
│   ├── tailwind.config.js    # Tailwind CSS configuration
│   └── vite.config.js        # Vite bundler configuration
├── deploy/
│   ├── docker-compose.yml    # Multi-container Docker orchestration
│   └── nginx.conf            # Nginx reverse proxy configuration
├── CONTRIBUTING.md           # Contribution guidelines
└── README.md                 # Project documentation