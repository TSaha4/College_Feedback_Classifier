"""
Generate evaluation metrics for the current saved CampusLens models.

Run from project root:
    python evaluate_models.py
"""

import json
import os

from backend.api import evaluate_models


def main():
    report = evaluate_models()
    output_path = os.path.join("backend", "evaluation_report.json")

    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(report, file, indent=2, ensure_ascii=False)

    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\nSaved evaluation report to {output_path}")


if __name__ == "__main__":
    main()
