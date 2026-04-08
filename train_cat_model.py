"""
train_cat_model.py
------------------
Retrain the category classifier using distilbert-base-uncased (stable fp32, fast).
Replaces the corrupted DeBERTa cat_model.

Run from project root:
    python train_cat_model.py
or with Python 3.10 (recommended):
    py -3.10 train_cat_model.py
"""

import os, time
import pandas as pd
import torch
from sklearn.model_selection import train_test_split
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
)
from datasets import Dataset

# ── Config ────────────────────────────────────────────────────
BASE_MODEL   = "distilbert-base-uncased"   # fast, stable, fp32-friendly
OUTPUT_DIR   = "cat_model"
CSV_PATH     = "project_dataset.csv"
EPOCHS       = 4
BATCH_SIZE   = 8
MAX_LEN      = 128
SEED         = 42

CAT_LABELS = {
    "Academics": 0, "Administration": 1, "Facilities": 2, "Faculty": 3,
    "Hostel": 4, "Mess": 5, "Others": 6
}
ID2CAT = {v: k for k, v in CAT_LABELS.items()}

print("=" * 60)
print("  CampusLens — Category Model Training")
print(f"  Base model : {BASE_MODEL}")
print(f"  Output     : {OUTPUT_DIR}/")
print(f"  Device     : {'cuda' if torch.cuda.is_available() else 'cpu'}")
print("=" * 60)

# ── Load & validate dataset ────────────────────────────────────
df = pd.read_csv(CSV_PATH)
print(f"\n✅ Loaded {len(df)} rows from {CSV_PATH}")

# Validate columns
assert "Feedback" in df.columns and "Category" in df.columns, \
    "CSV must have 'Feedback' and 'Category' columns"

df = df.dropna(subset=["Feedback", "Category"])
df = df[df["Category"].isin(CAT_LABELS)]       # drop any unknown labels
df["label"] = df["Category"].map(CAT_LABELS)
df = df[["Feedback", "label"]].rename(columns={"Feedback": "text"})

print(f"   After cleaning: {len(df)} rows")
print("\n   Class distribution:")
for cat, idx in CAT_LABELS.items():
    count = (df["label"] == idx).sum()
    print(f"     {cat:15s}: {count}")

# ── Split ─────────────────────────────────────────────────────
train_df, val_df = train_test_split(df, test_size=0.1, random_state=SEED, stratify=df["label"])
train_ds = Dataset.from_pandas(train_df.reset_index(drop=True))
val_ds   = Dataset.from_pandas(val_df.reset_index(drop=True))

# ── Tokenizer ──────────────────────────────────────────────────
print(f"\n📥 Downloading tokenizer: {BASE_MODEL} ...")
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

def tokenize(batch):
    return tokenizer(batch["text"], truncation=True, padding="max_length", max_length=MAX_LEN)

train_ds = train_ds.map(tokenize, batched=True)
val_ds   = val_ds.map(tokenize,   batched=True)

train_ds = train_ds.remove_columns(["text"])
val_ds   = val_ds.remove_columns(["text"])
train_ds.set_format("torch")
val_ds.set_format("torch")

# ── Model ──────────────────────────────────────────────────────
print(f"📥 Downloading model: {BASE_MODEL} ...")
model = AutoModelForSequenceClassification.from_pretrained(
    BASE_MODEL,
    num_labels=len(CAT_LABELS),
    dtype=torch.float32,            # ← explicit float32, never fp16
)

# ── Training args ──────────────────────────────────────────────
device_name = "cuda" if torch.cuda.is_available() else "cpu"
use_gpu     = device_name == "cuda"

args = TrainingArguments(
    output_dir            = "./tmp_cat_checkpoints",
    num_train_epochs      = EPOCHS,
    per_device_train_batch_size = BATCH_SIZE,
    per_device_eval_batch_size  = BATCH_SIZE,
    eval_strategy         = "epoch",
    save_strategy         = "epoch",
    load_best_model_at_end= True,
    metric_for_best_model = "eval_loss",
    fp16                  = False,          # ← NEVER fp16 (that's what broke DeBERTa)
    logging_steps         = 20,
    seed                  = SEED,
    report_to             = "none",         # no wandb etc.
)

trainer = Trainer(
    model         = model,
    args          = args,
    train_dataset = train_ds,
    eval_dataset  = val_ds,
)

# ── Train ──────────────────────────────────────────────────────
print(f"\n🚀 Training on {device_name.upper()} for {EPOCHS} epochs ...")
t0 = time.time()
trainer.train()
elapsed = time.time() - t0
print(f"\n✅ Training complete in {elapsed/60:.1f} minutes")

# ── Evaluate ─────────────────────────────────────────────────
results = trainer.evaluate()
print(f"   Eval loss: {results['eval_loss']:.4f}")

# ── Save in float32 ─────────────────────────────────────────
print(f"\n💾 Saving model to {OUTPUT_DIR}/ ...")
model = model.float()           # guarantee float32 before saving
model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)

# Quick sanity check
print("\n🔍 Sanity check ...")
ck_tok   = AutoTokenizer.from_pretrained(OUTPUT_DIR)
ck_model = AutoModelForSequenceClassification.from_pretrained(OUTPUT_DIR, dtype=torch.float32)
ck_model.eval()

sample = ck_tok("The library is excellent and well-equipped.", return_tensors="pt", truncation=True)
with torch.no_grad():
    logits = ck_model(**sample).logits.float()

probs = torch.nn.functional.softmax(logits, dim=-1)[0]
pred  = logits.argmax().item()
for i, p in enumerate(probs):
    bar = "█" * int(p.item() * 20)
    print(f"  {ID2CAT[i]:15s}: {p.item()*100:5.1f}%  {bar}")

print(f"\n🏆 Predicted: {ID2CAT[pred]}")
print("\n✅ All done! Restart the FastAPI backend to use the new model.")

# Cleanup tmp checkpoints
import shutil
if os.path.exists("./tmp_cat_checkpoints"):
    shutil.rmtree("./tmp_cat_checkpoints")
