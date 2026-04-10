"""
train_models.py
---------------
Retrain both the Category (DistilBERT) and Sentiment (RoBERTa) classifiers.
Improvements over original:
  - More epochs (6 cat / 5 sent)
  - Label smoothing to reduce overfitting on noisy labels
  - Class-weighted loss to handle imbalance
  - Gradient accumulation for more stable updates
  - Weight decay regularization
  - Saves to temp dir first to avoid Windows file-lock error (os error 1224)

Run from project root:
    python train_models.py
"""

import math
import os
import time

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
from torch.utils.data import DataLoader, Dataset as TorchDataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# ── Global Config ──────────────────────────────────────────────────────────────
CSV_PATH        = "project_dataset.csv"
MAX_LEN         = 128
LR              = 2e-5
SEED            = 42
LABEL_SMOOTHING = 0.1   # softens targets → less overconfident on noisy labels
GRAD_ACCUM      = 2     # effective batch = batch_size × GRAD_ACCUM

torch.manual_seed(SEED)
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

TASKS = {
    "category": {
        "base_model": "distilbert-base-uncased",
        "output_dir": "cat_model",
        "epochs":      6,
        "batch_size":  16,
        "target_col":  "Category",
        "labels": {
            "Academics": 0, "Administration": 1, "Facilities": 2,
            "Faculty": 3, "Hostel": 4, "Mess": 5, "Others": 6,
        },
    },
    "sentiment": {
        "base_model": "roberta-base",
        "output_dir": "sent_model",
        "epochs":      5,
        "batch_size":  16,
        "target_col":  "Sentiment",
        "labels": {"Negative": 0, "Neutral": 1, "Positive": 2},
    },
}


# ── Dataset ────────────────────────────────────────────────────────────────────
class ReviewDataset(TorchDataset):
    def __init__(self, texts, labels, tokenizer):
        enc = tokenizer(
            list(texts), truncation=True, padding="max_length",
            max_length=MAX_LEN, return_tensors="pt",
        )
        self.input_ids      = enc["input_ids"]
        self.attention_mask = enc["attention_mask"]
        self.labels         = torch.tensor(list(labels), dtype=torch.long)

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        return {
            "input_ids":      self.input_ids[idx],
            "attention_mask": self.attention_mask[idx],
            "labels":         self.labels[idx],
        }


# ── Training ───────────────────────────────────────────────────────────────────
def train_task(task_name):
    cfg        = TASKS[task_name]
    target_col = cfg["target_col"]
    labels_map = cfg["labels"]
    num_labels = len(labels_map)

    print("\n" + "=" * 60)
    print(f"  Training '{task_name.upper()}' Model")
    print(f"  Base model : {cfg['base_model']}")
    print(f"  Output     : {cfg['output_dir']}/")
    print(f"  Device     : {device}")
    print("=" * 60)

    # 1. Load & filter data
    df = pd.read_csv(CSV_PATH)
    df = df.dropna(subset=["Feedback", target_col])
    df = df[df[target_col].isin(labels_map)]
    df["label"] = df[target_col].map(labels_map)

    print(f"✅ Loaded {len(df)} samples")
    print(f"   Distribution:\n{df[target_col].value_counts().to_string()}")

    train_df, val_df = train_test_split(
        df, test_size=0.1, random_state=SEED, stratify=df["label"]
    )

    # 2. Class weights
    cw = compute_class_weight(
        class_weight="balanced",
        classes=np.arange(num_labels),
        y=train_df["label"].values,
    )
    weight_tensor = torch.tensor(cw, dtype=torch.float).to(device)
    print(f"   Class weights: {dict(zip(labels_map.keys(), cw.round(3)))}")

    # 3. Tokenize
    print(f"📥 Tokenizer: {cfg['base_model']} ...")
    tokenizer = AutoTokenizer.from_pretrained(cfg["base_model"])

    train_ds = ReviewDataset(train_df["Feedback"].values, train_df["label"].values, tokenizer)
    val_ds   = ReviewDataset(val_df["Feedback"].values,   val_df["label"].values,   tokenizer)
    train_loader = DataLoader(train_ds, batch_size=cfg["batch_size"], shuffle=True)
    val_loader   = DataLoader(val_ds,   batch_size=cfg["batch_size"])

    # 4. Model
    print(f"📥 Model: {cfg['base_model']} ...")
    model = AutoModelForSequenceClassification.from_pretrained(
        cfg["base_model"],
        num_labels=num_labels,
        ignore_mismatched_sizes=True,
    ).float().to(device)

    # 5. Loss: label-smoothed + class-weighted
    loss_fn = nn.CrossEntropyLoss(weight=weight_tensor, label_smoothing=LABEL_SMOOTHING)

    # 6. Optimizer + cosine schedule with warmup
    optimizer    = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    total_steps  = cfg["epochs"] * math.ceil(len(train_loader) / GRAD_ACCUM)
    warmup_steps = max(1, total_steps // 10)

    def lr_lambda(step):
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return max(0.0, 0.5 * (1.0 + math.cos(math.pi * progress)))

    scheduler  = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
    sched_step = 0

    # 7. Training loop
    print(f"\n🚀 Training {cfg['epochs']} epochs (grad_accum={GRAD_ACCUM}) ...\n")
    best_val_loss = float("inf")
    best_state    = None

    for epoch in range(1, cfg["epochs"] + 1):
        model.train()
        total_loss, correct, seen = 0.0, 0, 0
        t0 = time.time()
        optimizer.zero_grad()

        for step, batch in enumerate(train_loader, 1):
            input_ids = batch["input_ids"].to(device)
            attn_mask = batch["attention_mask"].to(device)
            lbls      = batch["labels"].to(device)

            logits = model(input_ids=input_ids, attention_mask=attn_mask).logits
            loss   = loss_fn(logits, lbls) / GRAD_ACCUM
            loss.backward()

            if step % GRAD_ACCUM == 0 or step == len(train_loader):
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                scheduler.step()
                optimizer.zero_grad()
                sched_step += 1

            total_loss += loss.item() * GRAD_ACCUM
            correct    += (logits.argmax(-1) == lbls).sum().item()
            seen       += len(lbls)

            if step % 20 == 0 or step == len(train_loader):
                print(
                    f"  Epoch {epoch}/{cfg['epochs']}  "
                    f"step {step:3d}/{len(train_loader)}  "
                    f"loss={total_loss/step:.4f}  "
                    f"acc={correct/seen*100:.1f}%",
                    end="\r",
                )

        train_loss = total_loss / len(train_loader)
        train_acc  = correct / seen * 100

        # Validation
        model.eval()
        val_loss, val_correct, val_seen = 0.0, 0, 0
        with torch.no_grad():
            for batch in val_loader:
                input_ids = batch["input_ids"].to(device)
                attn_mask = batch["attention_mask"].to(device)
                lbls      = batch["labels"].to(device)
                logits    = model(input_ids=input_ids, attention_mask=attn_mask).logits
                val_loss    += loss_fn(logits, lbls).item()
                val_correct += (logits.argmax(-1) == lbls).sum().item()
                val_seen    += len(lbls)

        val_loss = val_loss / len(val_loader)
        val_acc  = val_correct / val_seen * 100
        elapsed  = time.time() - t0

        print(
            f"\n  Epoch {epoch}/{cfg['epochs']} — {elapsed:.0f}s  "
            f"train_loss={train_loss:.4f}  train_acc={train_acc:.1f}%  "
            f"val_loss={val_loss:.4f}  val_acc={val_acc:.1f}%"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state    = {k: v.clone().cpu() for k, v in model.state_dict().items()}
            print(f"  ✅ Best val_loss={best_val_loss:.4f} — checkpoint saved")

    # 8. Save best checkpoint — save to temp dir first to avoid
    #    Windows os error 1224 (file locked via memory-mapped section by backend)
    import shutil
    tmp_dir = cfg["output_dir"] + "_tmp_new"
    old_dir = cfg["output_dir"] + "_old_bak"

    print(f"\n💾 Saving {task_name} model → {tmp_dir}/ (temp) ...")
    model.load_state_dict(best_state)
    model.float().save_pretrained(tmp_dir)
    tokenizer.save_pretrained(tmp_dir)

    # Atomically swap: old → _old_bak, tmp → target
    if os.path.exists(cfg["output_dir"]):
        if os.path.exists(old_dir):
            shutil.rmtree(old_dir)
        os.rename(cfg["output_dir"], old_dir)
    os.rename(tmp_dir, cfg["output_dir"])
    if os.path.exists(old_dir):
        shutil.rmtree(old_dir)

    print(f"🎉 {task_name.capitalize()} model saved → {cfg['output_dir']}/")


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    t_start = time.time()

    train_task("category")
    train_task("sentiment")

    elapsed = (time.time() - t_start) / 60
    print("\n" + "=" * 60)
    print(f"🌟 ALL MODELS TRAINED IN {elapsed:.1f} MINUTES 🌟")
    print("   Start backend:  uvicorn backend.api:app --reload")
    print("=" * 60)
