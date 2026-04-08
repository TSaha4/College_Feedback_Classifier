"""
CampusLens Backend API
----------------------
Run from project root:  uvicorn backend.api:app --reload --port 8000
"""

import os, sys, json, base64, zlib
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── locate models relative to this file ───────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT_MODEL_DIR  = os.path.join(ROOT, "cat_model")
SENT_MODEL_DIR = os.path.join(ROOT, "sent_model")
REVIEWS_FILE   = os.path.join(ROOT, "backend", "system_cache.bin")
LEGACY_REVIEWS = os.path.join(ROOT, "reviews.json")

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

app = FastAPI(title="CampusLens API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── load models once at startup ────────────────────────────────
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[CampusLens] Loading models on {device}...")

cat_tokenizer  = AutoTokenizer.from_pretrained(CAT_MODEL_DIR)
cat_model      = AutoModelForSequenceClassification.from_pretrained(
                     CAT_MODEL_DIR, dtype=torch.float32).to(device)
sent_tokenizer = AutoTokenizer.from_pretrained(SENT_MODEL_DIR)
sent_model     = AutoModelForSequenceClassification.from_pretrained(
                     SENT_MODEL_DIR, dtype=torch.float32).to(device)
cat_model.eval()
sent_model.eval()

print("[CampusLens] Models ready ✅")

ID2CAT  = {0:"Academics", 1:"Administration", 2:"Facilities", 3:"Faculty", 4:"Hostel", 5:"Mess", 6:"Others"}
ID2SENT = {0:"Negative", 1:"Neutral", 2:"Positive"}

# ── helpers ───────────────────────────────────────────────────
import math

def safe_float(val: float) -> float:
    """Return 0.0 for NaN/Inf so JSON serialisation never blows up."""
    if math.isnan(val) or math.isinf(val):
        return 0.0
    return val

def sanitize_obj(obj):
    """Recursively replace NaN/Inf floats in any dict/list structure."""
    if isinstance(obj, float):
        return safe_float(obj)
    if isinstance(obj, dict):
        return {k: sanitize_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_obj(v) for v in obj]
    return obj

def load_reviews():
    # Auto-migrate and encrypt legacy JSON file securely if it exists
    if os.path.exists(LEGACY_REVIEWS):
        try:
            with open(LEGACY_REVIEWS, "r", encoding="utf-8") as f:
                legacy_data = json.loads(f.read())
            save_reviews(legacy_data)
            os.remove(LEGACY_REVIEWS)
        except Exception as e:
            print("Failed to auto-migrate legacy data:", e)

    if os.path.exists(REVIEWS_FILE):
        try:
            with open(REVIEWS_FILE, "rb") as f:
                encrypted = f.read()
            decrypted_str = zlib.decompress(base64.b64decode(encrypted)).decode('utf-8')
            return sanitize_obj(json.loads(decrypted_str))
        except Exception:
            return []
    return []

def save_reviews(reviews):
    os.makedirs(os.path.dirname(REVIEWS_FILE), exist_ok=True)
    json_str = json.dumps(reviews, ensure_ascii=False).encode('utf-8')
    encrypted = base64.b64encode(zlib.compress(json_str))
    with open(REVIEWS_FILE, "wb") as f:
        f.write(encrypted)

# ── schemas ───────────────────────────────────────────────────
class ReviewRequest(BaseModel):
    text: str
    author: str = "Anonymous"

# ── routes ────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "device": device}


@app.post("/api/reviews")
def submit_review(req: ReviewRequest):
    if not req.text.strip():
        raise HTTPException(400, "Review text cannot be empty.")

    # category prediction
    inp_cat = cat_tokenizer(req.text, return_tensors="pt", truncation=True, max_length=512).to(device)
    # sentiment prediction
    inp_sent = sent_tokenizer(req.text, return_tensors="pt", truncation=True, max_length=512).to(device)

    with torch.no_grad():
        logits_cat  = cat_model(**inp_cat).logits
        logits_sent = sent_model(**inp_sent).logits

    # Cast to float32 — DeBERTa saves in fp16 which causes NaN in softmax on CPU
    logits_cat  = logits_cat.float()
    logits_sent = logits_sent.float()

    cat_idx  = logits_cat.argmax().item()
    sent_idx = logits_sent.argmax().item()

    cat_probs  = torch.nn.functional.softmax(logits_cat,  dim=-1)[0]
    sent_probs = torch.nn.functional.softmax(logits_sent, dim=-1)[0]

    # all category probs for a mini-breakdown (guarded against NaN)
    all_cats = {
        ID2CAT[i]: round(safe_float(cat_probs[i].item()) * 100, 1)
        for i in range(len(ID2CAT))
    }

    review = {
        "id":             datetime.now().isoformat(),
        "author":         req.author.strip() or "Anonymous",
        "text":           req.text.strip(),
        "category":       ID2CAT[cat_idx],
        "sentiment":      ID2SENT[sent_idx],
        "cat_confidence": round(safe_float(cat_probs[cat_idx].item())  * 100, 1),
        "sent_confidence":round(safe_float(sent_probs[sent_idx].item())* 100, 1),
        "all_cats":       all_cats,
        "timestamp":      datetime.now().strftime("%Y-%m-%d %H:%M"),
    }

    reviews = load_reviews()
    reviews.append(review)
    save_reviews(reviews)

    return review


@app.get("/api/reviews")
def get_reviews():
    return list(reversed(load_reviews()))   # newest first


@app.get("/api/leaderboard")
def get_leaderboard():
    reviews = load_reviews()
    stats: dict[str, dict] = {}
    for r in reviews:
        cat = r["category"]
        if cat not in stats:
            stats[cat] = {
                "category": cat,
                "total":    0,
                "positive": 0,
                "negative": 0,
                "neutral":  0,
                "score":    0,   # positive - negative
            }
        stats[cat]["total"]   += 1
        key = r["sentiment"].lower()
        stats[cat][key]       += 1
        stats[cat]["score"]   += (1 if key == "positive" else -1 if key == "negative" else 0)

    return list(stats.values())


@app.post("/api/reviews/reassess")
def reassess_reviews():
    reviews = load_reviews()
    if not reviews:
        return {"reassessed": 0}
        
    for review in reviews:
        text = review.get("text", "")
        if not text:
            continue
            
        inp_cat = cat_tokenizer(text, return_tensors="pt", truncation=True, max_length=512).to(device)
        inp_sent = sent_tokenizer(text, return_tensors="pt", truncation=True, max_length=512).to(device)

        with torch.no_grad():
            logits_cat  = cat_model(**inp_cat).logits
            logits_sent = sent_model(**inp_sent).logits

        logits_cat  = logits_cat.float()
        logits_sent = logits_sent.float()

        cat_idx  = logits_cat.argmax().item()
        sent_idx = logits_sent.argmax().item()

        cat_probs  = torch.nn.functional.softmax(logits_cat,  dim=-1)[0]
        sent_probs = torch.nn.functional.softmax(logits_sent, dim=-1)[0]

        all_cats = {
            ID2CAT[i]: round(safe_float(cat_probs[i].item()) * 100, 1)
            for i in range(len(ID2CAT))
        }

        review["category"] = ID2CAT[cat_idx]
        review["sentiment"] = ID2SENT[sent_idx]
        review["cat_confidence"] = round(safe_float(cat_probs[cat_idx].item())  * 100, 1)
        review["sent_confidence"] = round(safe_float(sent_probs[sent_idx].item())* 100, 1)
        review["all_cats"] = all_cats

    save_reviews(reviews)
    return {"reassessed": len(reviews)}


@app.post("/api/reviews/{review_id}/rusticate")
def rusticate_student(review_id: str):
    reviews = load_reviews()
    
    # Find the target review to determine author and new status
    target = next((r for r in reviews if r["id"] == review_id), None)
    if not target:
        raise HTTPException(404, "Review not found.")
        
    author = target.get("author", "Anonymous")
    new_status = not target.get("rusticated", False)
    
    # Apply to all identical IDs (in case of manual JSON duplication) 
    # AND apply to all reviews by the same author (if not Anonymous)
    for r in reviews:
        if r["id"] == review_id:
            r["rusticated"] = new_status
        elif author.lower() != "anonymous" and r.get("author", "") == author:
            r["rusticated"] = new_status

    save_reviews(reviews)
    return {"success": True}


@app.delete("/api/reviews/{review_id}")
def delete_review(review_id: str):
    reviews = load_reviews()
    filtered = [r for r in reviews if r["id"] != review_id]
    if len(filtered) == len(reviews):
        raise HTTPException(404, "Review not found.")
    save_reviews(filtered)
    return {"deleted": True}
