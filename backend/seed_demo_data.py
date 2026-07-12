#!/usr/bin/env python3
"""Optional helper: creates a couple of demo cellars and imports the sample
CSV, so you have something to look at right after first setup.

Usage (after the API is running and you've registered your account):
    python3 seed_demo_data.py --token YOUR_ACCESS_TOKEN [--url http://localhost:8000]
"""
import argparse
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("This script needs httpx: pip install httpx", file=sys.stderr)
    sys.exit(1)

SAMPLE_CSV = Path(__file__).parent / "sample_data" / "sample_cellar_en.csv"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", required=True, help="Access token from /auth/login or /auth/register")
    parser.add_argument("--url", default="http://localhost:8000")
    args = parser.parse_args()

    headers = {"Authorization": f"Bearer {args.token}"}
    client = httpx.Client(base_url=args.url, headers=headers, timeout=30)

    for cellar in [
        {"name": "Cave Nord", "purpose_level": 1, "max_capacity": 200, "threshold": 180, "location_rule": "AG"},
        {"name": "Kitchen Fridge", "purpose_level": 9, "max_capacity": 24, "threshold": 20, "location_rule": "SV"},
        {"name": "Garage overflow", "is_overflow": True, "max_capacity": 0, "threshold": 0},
    ]:
        resp = client.post("/cellars", json=cellar)
        if resp.status_code not in (201, 409):
            print(f"Failed to create cellar {cellar['name']}: {resp.text}", file=sys.stderr)
        else:
            print(f"Cellar ready: {cellar['name']}")

    with open(SAMPLE_CSV, "rb") as f:
        resp = client.post("/import", files={"file": ("sample_cellar_en.csv", f, "text/csv")})
    resp.raise_for_status()
    print("Import report:", resp.json())


if __name__ == "__main__":
    main()
