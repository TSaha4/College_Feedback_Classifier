"""
CampusLens Backend API
----------------------
Run from project root: uvicorn backend.api:app --reload --port 8000
"""

import base64
import json
import math
import os
import re
import zlib
from collections import Counter
from datetime import datetime
from typing import Optional

import pandas as pd
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# locate models relative to this file
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT_MODEL_DIR = os.path.join(ROOT, "cat_model")
SENT_MODEL_DIR = os.path.join(ROOT, "sent_model")
REVIEWS_FILE = os.path.join(ROOT, "backend", "system_cache.bin")
LEGACY_REVIEWS = os.path.join(ROOT, "reviews.json")
SAMPLE_REVIEWS_FILE = os.path.join(ROOT, "backend", "sample_reviews.json")
DATASET_PATH = os.path.join(ROOT, "project_dataset.csv")
EVAL_SPLIT_SEED = 42

ID2CAT = {
    0: "Academics",
    1: "Administration",
    2: "Facilities",
    3: "Faculty",
    4: "Hostel",
    5: "Mess",
    6: "Others",
}
ID2SENT = {0: "Negative", 1: "Neutral", 2: "Positive"}
CAT2ID = {label: idx for idx, label in ID2CAT.items()}
SENT2ID = {label: idx for idx, label in ID2SENT.items()}
MULTI_CATEGORY_GAP = 12.0
SEGMENT_SPLIT_PATTERN = re.compile(r"\b(?:but|however|although|though|while|yet)\b|[.;]+", re.IGNORECASE)
NEGATIVE_ACTIONS = {
    "Academics": [
        "Audit timetable pressure, deadlines, and course pacing with class reps.",
        "Offer doubt-clearing slots or tutorial sessions for the most reported subjects.",
    ],
    "Administration": [
        "Review approval bottlenecks and publish clearer process timelines.",
        "Create a single contact point for unresolved student issues.",
    ],
    "Facilities": [
        "Inspect high-traffic infrastructure and assign quick-fix maintenance items.",
        "Track recurring facility complaints weekly until the backlog drops.",
    ],
    "Faculty": [
        "Share student concerns with department heads and review classroom conduct patterns.",
        "Arrange feedback meetings focused on fairness, clarity, and approachability.",
    ],
    "Hostel": [
        "Check cleanliness, repairs, and water/electricity issues floor by floor.",
        "Set a visible response SLA for hostel complaints and publish resolution status.",
    ],
    "Mess": [
        "Review food quality, hygiene, and menu repetition with the mess committee.",
        "Run sample tasting and collect weekly feedback before changing vendors or menus.",
    ],
    "Others": [
        "Manually review these comments to identify a missing category or repeated issue.",
        "Group similar complaints into an action list for the next admin review.",
    ],
}

app = FastAPI(title="CampusLens API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[CampusLens] Loading models on {device}...")

cat_tokenizer = AutoTokenizer.from_pretrained(CAT_MODEL_DIR)
cat_model = AutoModelForSequenceClassification.from_pretrained(
    CAT_MODEL_DIR,
    dtype=torch.float32,
).to(device)
sent_tokenizer = AutoTokenizer.from_pretrained(SENT_MODEL_DIR)
sent_model = AutoModelForSequenceClassification.from_pretrained(
    SENT_MODEL_DIR,
    dtype=torch.float32,
).to(device)
cat_model.eval()
sent_model.eval()

print("[CampusLens] Models ready.")

ANALYTICS_CACHE = {"key": None, "value": None}
EVALUATION_CACHE = {"key": None, "value": None}


class ReviewRequest(BaseModel):
    text: str
    author: str = "Anonymous"


def safe_float(val: float) -> float:
    if math.isnan(val) or math.isinf(val):
        return 0.0
    return val


def sanitize_obj(obj):
    if isinstance(obj, float):
        return safe_float(obj)
    if isinstance(obj, dict):
        return {k: sanitize_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_obj(v) for v in obj]
    return obj


def load_reviews():
    if os.path.exists(LEGACY_REVIEWS):
        try:
            with open(LEGACY_REVIEWS, "r", encoding="utf-8") as file:
                legacy_data = json.loads(file.read())
            save_reviews(legacy_data)
            os.remove(LEGACY_REVIEWS)
        except Exception as exc:
            print("Failed to auto-migrate legacy data:", exc)

    if os.path.exists(REVIEWS_FILE):
        try:
            with open(REVIEWS_FILE, "rb") as file:
                encrypted = file.read()
            decrypted = zlib.decompress(base64.b64decode(encrypted)).decode("utf-8")
            return merge_sample_reviews(sanitize_obj(json.loads(decrypted)))
        except Exception:
            return merge_sample_reviews([])
    return merge_sample_reviews([])


def save_reviews(reviews):
    os.makedirs(os.path.dirname(REVIEWS_FILE), exist_ok=True)
    payload = json.dumps(reviews, ensure_ascii=False).encode("utf-8")
    encrypted = base64.b64encode(zlib.compress(payload))
    with open(REVIEWS_FILE, "wb") as file:
        file.write(encrypted)
    ANALYTICS_CACHE["key"] = None
    ANALYTICS_CACHE["value"] = None


def load_sample_reviews():
    if not os.path.exists(SAMPLE_REVIEWS_FILE):
        return []
    try:
        with open(SAMPLE_REVIEWS_FILE, "r", encoding="utf-8") as file:
            sample_data = json.loads(file.read())
        if not isinstance(sample_data, list):
            return []
        return sanitize_obj(sample_data)
    except Exception as exc:
        print("Failed to load sample reviews:", exc)
        return []


def merge_sample_reviews(reviews):
    sample_reviews = load_sample_reviews()
    if not sample_reviews:
        return reviews
    existing_ids = {review.get("id") for review in reviews}
    merged = list(reviews)
    for sample_review in sample_reviews:
        if sample_review.get("id") not in existing_ids:
            merged.append(sample_review)
            existing_ids.add(sample_review.get("id"))
    return merged


def get_path_signature(path):
    if not os.path.exists(path):
        return ("missing", path)
    stat = os.stat(path)
    return (path, stat.st_mtime_ns, stat.st_size)


def get_directory_signature(path):
    if not os.path.exists(path):
        return ("missing-dir", path)

    signatures = []
    for root, _, files in os.walk(path):
        for name in sorted(files):
            full_path = os.path.join(root, name)
            stat = os.stat(full_path)
            signatures.append((full_path, stat.st_mtime_ns, stat.st_size))
    return tuple(signatures)


def get_analytics_cache_key():
    return (
        get_path_signature(REVIEWS_FILE),
        get_path_signature(SAMPLE_REVIEWS_FILE),
    )


def get_evaluation_cache_key():
    return (
        get_path_signature(DATASET_PATH),
        get_directory_signature(CAT_MODEL_DIR),
        get_directory_signature(SENT_MODEL_DIR),
    )


def predict_labels(text: str):
    clean_text = text.strip()
    inp_cat = cat_tokenizer(clean_text, return_tensors="pt", truncation=True, max_length=512).to(device)
    inp_sent = sent_tokenizer(clean_text, return_tensors="pt", truncation=True, max_length=512).to(device)

    with torch.no_grad():
        logits_cat = cat_model(**inp_cat).logits.float()
        logits_sent = sent_model(**inp_sent).logits.float()

    cat_probs = torch.nn.functional.softmax(logits_cat, dim=-1)[0]
    sent_probs = torch.nn.functional.softmax(logits_sent, dim=-1)[0]
    cat_idx = logits_cat.argmax().item()
    sent_idx = logits_sent.argmax().item()

    return {
        "category": ID2CAT[cat_idx],
        "sentiment": ID2SENT[sent_idx],
        "cat_confidence": round(safe_float(cat_probs[cat_idx].item()) * 100, 1),
        "sent_confidence": round(safe_float(sent_probs[sent_idx].item()) * 100, 1),
        "all_cats": {
            ID2CAT[i]: round(safe_float(cat_probs[i].item()) * 100, 1)
            for i in range(len(ID2CAT))
        },
    }


def detect_categories(text: str, prediction: Optional[dict] = None):
    prediction = prediction or predict_labels(text)
    ranked_categories = sorted(
        prediction["all_cats"].items(),
        key=lambda item: item[1],
        reverse=True,
    )

    detected = []
    if ranked_categories:
        top_label, top_score = ranked_categories[0]
        detected.append(top_label)
        for label, score in ranked_categories[1:]:
            if top_score - score <= MULTI_CATEGORY_GAP:
                detected.append(label)

    segments = [
        segment.strip(" ,")
        for segment in SEGMENT_SPLIT_PATTERN.split(text.strip())
        if segment.strip(" ,")
    ]
    if len(segments) > 1:
        for segment in segments:
            segment_prediction = predict_labels(segment)
            label = segment_prediction["category"]
            if label not in detected:
                detected.append(label)

    return detected[:3]


def build_review_record(text: str, author: str):
    prediction = predict_labels(text)
    detected_categories = detect_categories(text, prediction)
    return {
        "id": datetime.now().isoformat(),
        "author": author.strip() or "Anonymous",
        "text": text.strip(),
        "category": prediction["category"],
        "detected_categories": detected_categories,
        "is_multi_category": len(detected_categories) > 1,
        "sentiment": prediction["sentiment"],
        "cat_confidence": prediction["cat_confidence"],
        "sent_confidence": prediction["sent_confidence"],
        "all_cats": prediction["all_cats"],
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


def get_leaderboard_stats(reviews):
    stats = {}
    for review in reviews:
        review_categories = review.get("detected_categories") or [review["category"]]
        for category in review_categories:
            if category not in stats:
                stats[category] = {
                    "category": category,
                    "total": 0,
                    "positive": 0,
                    "negative": 0,
                    "neutral": 0,
                    "score": 0,
                    "avg_cat_confidence": 0.0,
                    "avg_sent_confidence": 0.0,
                }

            stats[category]["total"] += 1
            sentiment_key = review["sentiment"].lower()
            stats[category][sentiment_key] += 1
            stats[category]["score"] += 1 if sentiment_key == "positive" else -1 if sentiment_key == "negative" else 0
            stats[category]["avg_cat_confidence"] += review.get("cat_confidence", 0.0)
            stats[category]["avg_sent_confidence"] += review.get("sent_confidence", 0.0)

    for item in stats.values():
        total = max(1, item["total"])
        item["avg_cat_confidence"] = round(item["avg_cat_confidence"] / total, 1)
        item["avg_sent_confidence"] = round(item["avg_sent_confidence"] / total, 1)

    return list(stats.values())


def load_dataset_frame():
    if not os.path.exists(DATASET_PATH):
        raise HTTPException(500, "Dataset not found for evaluation.")
    frame = pd.read_csv(DATASET_PATH)
    return frame.dropna(subset=["Feedback", "Category", "Sentiment"])


def predict_batch(texts, tokenizer, model, label_map):
    predictions = []
    confidences = []
    for text in texts:
        encoded = tokenizer(str(text), return_tensors="pt", truncation=True, max_length=512).to(device)
        with torch.no_grad():
            logits = model(**encoded).logits.float()
        probs = torch.nn.functional.softmax(logits, dim=-1)[0]
        idx = logits.argmax().item()
        predictions.append(label_map[idx])
        confidences.append(round(safe_float(probs[idx].item()) * 100, 1))
    return predictions, confidences


def metrics_from_predictions(y_true, y_pred, labels):
    precision, recall, f1, support = precision_recall_fscore_support(
        y_true,
        y_pred,
        labels=labels,
        zero_division=0,
    )
    matrix = confusion_matrix(y_true, y_pred, labels=labels)

    return {
        "accuracy": round(accuracy_score(y_true, y_pred) * 100, 2),
        "macro_f1": round(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0) * 100, 2),
        "weighted_f1": round(f1_score(y_true, y_pred, labels=labels, average="weighted", zero_division=0) * 100, 2),
        "per_class": [
            {
                "label": label,
                "precision": round(float(precision[idx]) * 100, 2),
                "recall": round(float(recall[idx]) * 100, 2),
                "f1": round(float(f1[idx]) * 100, 2),
                "support": int(support[idx]),
            }
            for idx, label in enumerate(labels)
        ],
        "confusion_matrix": {
            "labels": labels,
            "matrix": matrix.tolist(),
        },
    }


def evaluate_models():
    frame = load_dataset_frame()

    category_frame = frame[frame["Category"].isin(CAT2ID)]
    sentiment_frame = frame[frame["Sentiment"].isin(SENT2ID)]

    cat_train, cat_test = train_test_split(
        category_frame,
        test_size=0.1,
        random_state=EVAL_SPLIT_SEED,
        stratify=category_frame["Category"],
    )
    sent_train, sent_test = train_test_split(
        sentiment_frame,
        test_size=0.1,
        random_state=EVAL_SPLIT_SEED,
        stratify=sentiment_frame["Sentiment"],
    )

    cat_true = cat_test["Category"].tolist()
    cat_pred, cat_conf = predict_batch(cat_test["Feedback"].tolist(), cat_tokenizer, cat_model, ID2CAT)
    sent_true = sent_test["Sentiment"].tolist()
    sent_pred, sent_conf = predict_batch(sent_test["Feedback"].tolist(), sent_tokenizer, sent_model, ID2SENT)

    cat_errors = []
    for text, truth, pred, conf in zip(cat_test["Feedback"], cat_true, cat_pred, cat_conf):
        if truth != pred:
            cat_errors.append(
                {
                    "text": str(text)[:220],
                    "actual": truth,
                    "predicted": pred,
                    "confidence": conf,
                }
            )

    sent_errors = []
    for text, truth, pred, conf in zip(sent_test["Feedback"], sent_true, sent_pred, sent_conf):
        if truth != pred:
            sent_errors.append(
                {
                    "text": str(text)[:220],
                    "actual": truth,
                    "predicted": pred,
                    "confidence": conf,
                }
            )

    return sanitize_obj(
        {
            "dataset_rows": int(len(frame)),
            "holdout_size": {
                "category": int(len(cat_test)),
                "sentiment": int(len(sent_test)),
            },
            "category": {
                **metrics_from_predictions(cat_true, cat_pred, list(CAT2ID.keys())),
                "sample_errors": cat_errors[:8],
            },
            "sentiment": {
                **metrics_from_predictions(sent_true, sent_pred, list(SENT2ID.keys())),
                "sample_errors": sent_errors[:8],
            },
        }
    )


def build_topic_clusters(reviews):
    usable_reviews = [review for review in reviews if review.get("text", "").strip()]
    if len(usable_reviews) < 3:
        return {"cluster_count": 0, "clusters": [], "keywords": []}

    texts = [review["text"] for review in usable_reviews]
    vectorizer = TfidfVectorizer(stop_words="english", max_features=600, ngram_range=(1, 2), min_df=1)
    matrix = vectorizer.fit_transform(texts)
    feature_names = vectorizer.get_feature_names_out()

    cluster_count = min(4, len(usable_reviews))
    if cluster_count < 2:
        return {"cluster_count": 0, "clusters": [], "keywords": []}

    model = KMeans(n_clusters=cluster_count, random_state=42, n_init=10)
    assignments = model.fit_predict(matrix)
    clusters = []

    for cluster_id in range(cluster_count):
        members = [usable_reviews[idx] for idx, assigned in enumerate(assignments) if assigned == cluster_id]
        if not members:
            continue

        centroid = model.cluster_centers_[cluster_id]
        top_indices = centroid.argsort()[-5:][::-1]
        keywords = [feature_names[idx] for idx in top_indices if centroid[idx] > 0]
        sentiment_mix = Counter(member.get("sentiment", "Neutral") for member in members)
        category_mix = Counter(member.get("category", "Others") for member in members)

        clusters.append(
            {
                "id": cluster_id,
                "title": ", ".join(keywords[:3]) if keywords else f"Theme {cluster_id + 1}",
                "keywords": keywords,
                "size": len(members),
                "sentiment_mix": dict(sentiment_mix),
                "top_category": category_mix.most_common(1)[0][0] if category_mix else "Others",
                "examples": [
                    {
                        "id": member["id"],
                        "text": member["text"][:180],
                        "category": member.get("category", "Others"),
                        "sentiment": member.get("sentiment", "Neutral"),
                    }
                    for member in members[:3]
                ],
            }
        )

    clusters.sort(key=lambda item: item["size"], reverse=True)
    keywords = []
    for cluster in clusters:
        keywords.extend(cluster["keywords"][:2])

    return {
        "cluster_count": len(clusters),
        "clusters": clusters,
        "keywords": list(dict.fromkeys(keywords))[:8],
    }


def build_summary_insights(reviews, leaderboard, clusters):
    if not reviews:
        return {
            "headline": "No reviews yet. Submit a few reviews to unlock analytics.",
            "recommendations": [],
            "signals": [],
        }

    total_reviews = len(reviews)
    negative_reviews = [review for review in reviews if review.get("sentiment") == "Negative"]
    positive_reviews = [review for review in reviews if review.get("sentiment") == "Positive"]
    multi_category_reviews = [review for review in reviews if review.get("is_multi_category")]
    low_confidence = [
        review
        for review in reviews
        if review.get("cat_confidence", 100) < 60 or review.get("sent_confidence", 100) < 60
    ]

    most_negative = max(leaderboard, key=lambda item: item["negative"] / max(1, item["total"])) if leaderboard else None
    most_positive = max(leaderboard, key=lambda item: item["score"]) if leaderboard else None
    busiest_cluster = clusters["clusters"][0] if clusters["clusters"] else None

    recommendations = []
    if most_negative and most_negative["negative"] > 0:
        recommendations.append(
            f"Prioritize {most_negative['category']} because it has the heaviest negative load ({most_negative['negative']} of {most_negative['total']} reviews)."
        )
    if busiest_cluster:
        recommendations.append(
            f"Investigate the '{busiest_cluster['title']}' theme first; it appears in {busiest_cluster['size']} reviews and is driving repeated feedback."
        )
    if low_confidence:
        recommendations.append(
            f"Review {len(low_confidence)} low-confidence predictions manually to improve label quality before the next retraining cycle."
        )
    if most_positive and most_positive["score"] > 0:
        recommendations.append(
            f"Use {most_positive['category']} as a benchmark area because it currently has the strongest net sentiment score."
        )

    signals = [
        {
            "label": "Negative share",
            "value": f"{round(len(negative_reviews) / max(1, total_reviews) * 100, 1)}%",
        },
        {
            "label": "Positive share",
            "value": f"{round(len(positive_reviews) / max(1, total_reviews) * 100, 1)}%",
        },
        {
            "label": "Low-confidence reviews",
            "value": str(len(low_confidence)),
        },
        {
            "label": "Detected themes",
            "value": str(clusters["cluster_count"]),
        },
        {
            "label": "Multi-topic reviews",
            "value": str(len(multi_category_reviews)),
        },
    ]

    headline_parts = []
    if most_negative:
        headline_parts.append(f"{most_negative['category']} needs attention")
    if busiest_cluster:
        headline_parts.append(f"repeated theme: {busiest_cluster['title']}")
    headline = " | ".join(headline_parts) if headline_parts else "Analytics ready."

    return {
        "headline": headline,
        "recommendations": recommendations[:4],
        "signals": signals,
    }


def build_negative_action_plan(leaderboard):
    negative_rows = [
        row for row in leaderboard
        if row.get("negative", 0) > 0
    ]
    negative_rows.sort(
        key=lambda row: (
            row["negative"] / max(1, row["total"]),
            row["negative"],
        ),
        reverse=True,
    )

    plan = []
    for row in negative_rows[:4]:
        actions = NEGATIVE_ACTIONS.get(row["category"], NEGATIVE_ACTIONS["Others"])
        plan.append(
            {
                "category": row["category"],
                "negative": row["negative"],
                "total": row["total"],
                "share": round(row["negative"] / max(1, row["total"]) * 100, 1),
                "actions": actions,
            }
        )
    return plan


def build_analytics_snapshot():
    cache_key = get_analytics_cache_key()
    if ANALYTICS_CACHE["key"] == cache_key and ANALYTICS_CACHE["value"] is not None:
        return ANALYTICS_CACHE["value"]

    reviews = load_reviews()
    leaderboard = get_leaderboard_stats(reviews)
    clusters = build_topic_clusters(reviews)

    sentiment_counts = Counter(review.get("sentiment", "Neutral") for review in reviews)
    detected_category_counts = Counter()
    for review in reviews:
        for category in review.get("detected_categories") or [review.get("category", "Others")]:
            detected_category_counts[category] += 1
    confidence_points = [
        {
            "category": review.get("category", "Others"),
            "cat_confidence": review.get("cat_confidence", 0),
            "sent_confidence": review.get("sent_confidence", 0),
            "sentiment": review.get("sentiment", "Neutral"),
        }
        for review in reviews[-20:]
    ]

    timeline = Counter(review.get("timestamp", "")[:10] for review in reviews if review.get("timestamp"))
    trend = [
        {"date": date, "count": count}
        for date, count in sorted(timeline.items())
    ]

    snapshot = sanitize_obj(
        {
            "overview": {
                "total_reviews": len(reviews),
                "categories": len(detected_category_counts),
                "avg_cat_confidence": round(
                    sum(review.get("cat_confidence", 0) for review in reviews) / max(1, len(reviews)),
                    1,
                ),
                "avg_sent_confidence": round(
                    sum(review.get("sent_confidence", 0) for review in reviews) / max(1, len(reviews)),
                    1,
                ),
            },
            "sentiment_distribution": [
                {"label": label, "value": sentiment_counts.get(label, 0)}
                for label in ID2SENT.values()
            ],
            "category_distribution": [
                {"label": label, "value": detected_category_counts.get(label, 0)}
                for label in ID2CAT.values()
                if detected_category_counts.get(label, 0)
            ],
            "leaderboard": leaderboard,
            "action_plan": build_negative_action_plan(leaderboard),
            "summary": build_summary_insights(reviews, leaderboard, clusters),
        }
    )
    ANALYTICS_CACHE["key"] = cache_key
    ANALYTICS_CACHE["value"] = snapshot
    return snapshot


@app.get("/api/health")
def health():
    return {"status": "ok", "device": device}


@app.post("/api/reviews")
def submit_review(req: ReviewRequest):
    if not req.text.strip():
        raise HTTPException(400, "Review text cannot be empty.")

    review = build_review_record(req.text, req.author)
    reviews = load_reviews()
    reviews.append(review)
    save_reviews(reviews)
    return review


@app.get("/api/reviews")
def get_reviews():
    return list(reversed(load_reviews()))


@app.get("/api/leaderboard")
def get_leaderboard():
    return get_leaderboard_stats(load_reviews())


@app.get("/api/analytics")
def get_analytics():
    return build_analytics_snapshot()


@app.get("/api/evaluation")
def get_evaluation():
    cache_key = get_evaluation_cache_key()
    if EVALUATION_CACHE["key"] == cache_key and EVALUATION_CACHE["value"] is not None:
        return EVALUATION_CACHE["value"]

    evaluation = evaluate_models()
    EVALUATION_CACHE["key"] = cache_key
    EVALUATION_CACHE["value"] = evaluation
    return evaluation


@app.post("/api/reviews/reassess")
def reassess_reviews():
    reviews = load_reviews()
    if not reviews:
        return {"reassessed": 0}

    for review in reviews:
        text = review.get("text", "").strip()
        if not text:
            continue
        prediction = predict_labels(text)
        review["category"] = prediction["category"]
        review["detected_categories"] = detect_categories(text, prediction)
        review["is_multi_category"] = len(review["detected_categories"]) > 1
        review["sentiment"] = prediction["sentiment"]
        review["cat_confidence"] = prediction["cat_confidence"]
        review["sent_confidence"] = prediction["sent_confidence"]
        review["all_cats"] = prediction["all_cats"]

    save_reviews(reviews)
    return {"reassessed": len(reviews)}


@app.post("/api/reviews/{review_id}/rusticate")
def rusticate_student(review_id: str):
    reviews = load_reviews()
    target = next((review for review in reviews if review["id"] == review_id), None)
    if not target:
        raise HTTPException(404, "Review not found.")

    author = target.get("author", "Anonymous")
    new_status = not target.get("rusticated", False)

    for review in reviews:
        if review["id"] == review_id:
            review["rusticated"] = new_status
        elif author.lower() != "anonymous" and review.get("author", "") == author:
            review["rusticated"] = new_status

    save_reviews(reviews)
    return {"success": True}


@app.delete("/api/reviews/{review_id}")
def delete_review(review_id: str):
    reviews = load_reviews()
    filtered = [review for review in reviews if review["id"] != review_id]
    if len(filtered) == len(reviews):
        raise HTTPException(404, "Review not found.")
    save_reviews(filtered)
    return {"deleted": True}
