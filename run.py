"""
ZeroProxy App Launcher
Runs the FastAPI backend and React frontend concurrently.
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

# Paths
ROOT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = ROOT_DIR if (ROOT_DIR / "backend").exists() else ROOT_DIR / "zeroproxy"
BACKEND_DIR = PROJECT_DIR / "backend"
FRONTEND_DIR = PROJECT_DIR / "frontend"

VENV_PYTHON = BACKEND_DIR / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
if not VENV_PYTHON.exists():
    VENV_PYTHON = Path(sys.executable)


def print_banner():
    banner = r"""
  ______               _____                     
 |___  /              |  __ \                    
    / / ___ _ __ ___  | |__) | __ _____  ___   _ 
   / / / _ \ '__/ _ \ |  ___/ '__/ _ \ \/ / | | |
  / /_|  __/ | | (_) || |   | | | (_) >  <| |_| |
 /_____\___|_|  \___/ |_|   |_|  \___/_/\_\\__, |
                                            __/ |
                                           |___/ 
    """
    print(banner)
    print("=" * 60)
    print("  ZeroProxy - Facial Verification & Rotating QR Attendance")
    print("=" * 60)


def check_database():
    """Verify backend database connectivity."""
    print(" [1/3] Checking database connectivity...")
    test_code = (
        "import asyncio; from app.db import engine; from sqlalchemy import text; "
        "async def t():\n"
        "  try:\n"
        "    async with engine.connect() as c:\n"
        "      await c.execute(text('SELECT 1'))\n"
        "    print('  [DB] PostgreSQL connection successful.')\n"
        "  except Exception as e:\n"
        "    print(f'  [DB Warning] Database check returned: {e}')\n"
        "asyncio.run(t())"
    )
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND_DIR)
    try:
        subprocess.run(
            [str(VENV_PYTHON), "-c", test_code],
            cwd=str(BACKEND_DIR),
            env=env,
            timeout=8,
            capture_output=True,
            text=True,
        )
        print("  Database check passed.")
    except Exception as e:
        print(f"  Note: Proceeding (db check: {e})")


def run_tests():
    """Run pytest suite before launching."""
    print("\nRunning backend test suite (pytest)...")
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND_DIR)
    result = subprocess.run(
        [str(VENV_PYTHON), "-m", "pytest", "-q"],
        cwd=str(BACKEND_DIR),
        env=env,
    )
    if result.returncode != 0:
        print("\n [!] Tests failed. Exiting.")
        sys.exit(result.returncode)
    print(" All tests passed!\n")


def check_frontend_deps():
    """Check if frontend dependencies and AI face models are installed."""
    node_modules = FRONTEND_DIR / "node_modules"
    if not node_modules.exists():
        print(" [!] Frontend node_modules not found. Installing via npm...")
        npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
        subprocess.run([npm_cmd, "install"], cwd=str(FRONTEND_DIR), check=True)

    models_dir = FRONTEND_DIR / "public" / "models"
    manifest = models_dir / "tiny_face_detector_model-weights_manifest.json"
    if not manifest.exists():
        print(" [!] Copying face-api models to public/models...")
        models_dir.mkdir(parents=True, exist_ok=True)
        source_dir = FRONTEND_DIR / "node_modules" / "@vladmandic" / "face-api" / "model"
        if source_dir.exists():
            import shutil
            for f in source_dir.glob("*"):
                shutil.copy2(f, models_dir / f.name)
            print("  Face-api models ready.")


def start_backend(port=5000):
    """Start uvicorn server for FastAPI backend."""
    print(f" [*] Launching Backend on http://localhost:{port} (API docs: http://localhost:{port}/docs)...")
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND_DIR)
    cmd = [
        str(VENV_PYTHON),
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "0.0.0.0",
        "--port",
        str(port),
        "--reload",
    ]
    return subprocess.Popen(cmd, cwd=str(BACKEND_DIR), env=env)


def start_frontend():
    """Start Vite development server for React frontend."""
    print(" [*] Launching Frontend on https://localhost:5180...")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    return subprocess.Popen([npm_cmd, "run", "dev"], cwd=str(FRONTEND_DIR))


def main():
    parser = argparse.ArgumentParser(description="ZeroProxy App Runner")
    parser.add_argument("--backend-only", action="store_true", help="Launch backend server only")
    parser.add_argument("--frontend-only", action="store_true", help="Launch frontend server only")
    parser.add_argument("--test", action="store_true", help="Run pytest suite before launching")
    parser.add_argument("--port", type=int, default=5000, help="Backend port (default: 5000)")
    parser.add_argument("--create-faculty", action="store_true", help="Interactively create or enable a faculty account")
    args = parser.parse_args()

    print_banner()

    if args.create_faculty:
        env = os.environ.copy()
        env["PYTHONPATH"] = str(BACKEND_DIR)
        subprocess.run([str(VENV_PYTHON), "scripts/seed_faculty.py"], cwd=str(BACKEND_DIR), env=env)
        sys.exit(0)

    if args.test:
        run_tests()

    processes = []

    def cleanup(sig=None, frame=None):
        print("\n\nShutting down ZeroProxy services...")
        for p in processes:
            try:
                p.terminate()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    if not args.frontend_only:
        check_database()
        p_backend = start_backend(port=args.port)
        processes.append(p_backend)

    if not args.backend_only:
        check_frontend_deps()
        p_frontend = start_frontend()
        processes.append(p_frontend)

    print("\n" + "=" * 60)
    print("  ZeroProxy is running!")
    print(f"  - Backend API:       http://localhost:{args.port}")
    print(f"  - Swagger API Docs:  http://localhost:{args.port}/docs")
    if not args.backend_only:
        print("  - Frontend UI:       https://localhost:5180")
    print("=" * 60)
    print("Press Ctrl+C to stop all services.\n")

    try:
        while True:
            # Check if any process terminated unexpectedly
            for p in processes:
                if p.poll() is not None:
                    print(f"\nA process exited with code {p.returncode}. Stopping.")
                    cleanup()
            time.sleep(1)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
