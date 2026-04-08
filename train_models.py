"""
train_models.py
---------------
Retrain both the Category (DistilBERT) and Sentiment (RoBERTa) classifiers.
Uses a plain PyTorch loop — no Trainer / accelerate needed.

Run from project root:
    python train_models.py
"""

import os, time, math
import pandas as pd
import torch
from torch.utils.data import DataLoader, Dataset as TorchDataset
from sklearn.model_selection import train_test_split
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# ── Global Config ─────────────────────────────────────────────
CSV_PATH = "project_dataset.csv"
MAX_LEN  = 128
LR       = 2e-5
SEED     = 42

torch.manual_seed(SEED)
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Definitions for both tasks
TASKS = {
    "category": {
        "base_model": "distilbert-base-uncased",
        "output_dir": "cat_model",
        "epochs": 4,
        "batch_size": 8,
        "target_col": "Category",
        "labels": {
            "Academics": 0, "Administration": 1, "Facilities": 2,
            "Faculty": 3, "Hostel": 4, "Mess": 5, "Others": 6
        }
    },
    "sentiment": {
        "base_model": "roberta-base",
        "output_dir": "sent_model",
        "epochs": 3,
        "batch_size": 8,
        "target_col": "Sentiment",
        "labels": {"Negative": 0, "Neutral": 1, "Positive": 2} # Adjust if needed
    }
}

# ── Dataset Class ──────────────────────────────────────────────
class ReviewDataset(TorchDataset):
    def __init__(self, texts, labels, tokenizer):
        enc = tokenizer(
            list(texts), truncation=True, padding="max_length",
            max_length=MAX_LEN, return_tensors="pt"
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

# ── Core Training Function ─────────────────────────────────────
def train_task(task_name):
    cfg = TASKS[task_name]
    target_col = cfg["target_col"]
    labels_map = cfg["labels"]
    
    print("\n" + "=" * 60)
    print(f"  Training '{task_name.upper()}' Model")
    print(f"  Base model : {cfg['base_model']}")
    print(f"  Output     : {cfg['output_dir']}/")
    print(f"  Device     : {device}")
    print("=" * 60)

    # 1. Load Data Specific to Task
    df = pd.read_csv(CSV_PATH)
    df = df.dropna(subset=["Feedback", target_col])
    df = df[df[target_col].isin(labels_map)]
    df["label"] = df[target_col].map(labels_map)

    print(f"✅ Loaded {len(df)} samples")
    train_df, val_df = train_test_split(
        df, test_size=0.1, random_state=SEED, stratify=df["label"]
    )

    # 2. Tokenize
    print(f"📥 Loading tokenizer: {cfg['base_model']} ...")
    tokenizer = AutoTokenizer.from_pretrained(cfg["base_model"])

    train_ds = ReviewDataset(train_df["Feedback"].values, train_df["label"].values, tokenizer)
    val_ds   = ReviewDataset(val_df["Feedback"].values, val_df["label"].values, tokenizer)
    train_loader = DataLoader(train_ds, batch_size=cfg["batch_size"], shuffle=True)
    val_loader   = DataLoader(val_ds, batch_size=cfg["batch_size"])

    # 3. Model
    print(f"📥 Loading model: {cfg['base_model']} ...")
    model = AutoModelForSequenceClassification.from_pretrained(
        cfg["base_model"], 
        num_labels=len(labels_map), 
        ignore_mismatched_sizes=True
    ).float().to(device)

    # 4. Optimizer & Schedule
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR)
    total_steps = cfg["epochs"] * len(train_loader)
    warmup_steps = total_steps // 10

    def lr_lambda(step):
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return max(0.0, 0.5 * (1.0 + math.cos(math.pi * progress)))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # 5. Training Loop
    print(f"\n🚀 Training for {cfg['epochs']} epochs ...\n")
    best_val_loss = float("inf")
    best_state = None

    for epoch in range(1, cfg["epochs"] + 1):
        model.train()
        total_loss, correct, seen = 0.0, 0, 0
        t0 = time.time()

        for step, batch in enumerate(train_loader, 1):
            input_ids = batch["input_ids"].to(device)
            attn_mask = batch["attention_mask"].to(device)
            lbls      = batch["labels"].to(device)

            outputs = model(input_ids=input_ids, attention_mask=attn_mask, labels=lbls)
            loss = outputs.loss

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            total_loss += loss.item()
            preds = outputs.logits.argmax(-1)
            correct += (preds == lbls).sum().item()
            seen += len(lbls)

            if step % 20 == 0 or step == len(train_loader):
                print(f"  Epoch {epoch}/{cfg['epochs']}  step {step:3d}/{len(train_loader)}"
                      f"  loss={total_loss/step:.4f}  acc={correct/seen*100:.1f}%", end="\r")

        train_loss = total_loss / len(train_loader)
        train_acc  = correct / seen * 100

        # Validate
        model.eval()
        val_loss, val_correct, val_seen = 0.0, 0, 0
        with torch.no_grad():
            for batch in val_loader:
                input_ids = batch["input_ids"].to(device)
                attn_mask = batch["attention_mask"].to(device)
                lbls      = batch["labels"].to(device)
                outputs = model(input_ids=input_ids, attention_mask=attn_mask, labels=lbls)
                
                val_loss += outputs.loss.item()
                preds = outputs.logits.argmax(-1)
                val_correct += (preds == lbls).sum().item()
                val_seen += len(lbls)

        val_loss = val_loss / len(val_loader)
        val_acc  = val_correct / val_seen * 100
        elapsed  = time.time() - t0

        print(f"\n  Epoch {epoch}/{cfg['epochs']} done in {elapsed:.0f}s "
              f"| train_loss={train_loss:.4f} train_acc={train_acc:.1f}% "
              f"| val_loss={val_loss:.4f} val_acc={val_acc:.1f}%")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = {k: v.clone().cpu() for k, v in model.state_dict().items()}
            print(f"  ✅ New best val_loss={best_val_loss:.4f} — saved intermediate checkpoint")

    # 6. Save Best
    print(f"\n💾 Saving optimal {task_name} model to {cfg['output_dir']}/ ...")
    model.load_state_dict(best_state)
    model = model.float() # guarantee float32
    model.save_pretrained(cfg["output_dir"])
    tokenizer.save_pretrained(cfg["output_dir"])
    print(f"🎉 {task_name.capitalize()} model training complete!")

# ── Main Entry ──────────────────────────────────────────────────
if __name__ == "__main__":
    t_start = time.time()
    
    # Train Category Model
    train_task("category")
    
    # Train Sentiment Model
    train_task("sentiment")
    
    total_time = (time.time() - t_start) / 60
    print("\n" + "=" * 60)
    print(f"🌟 ALL MODELS TRAINED SUCCESSFULLY IN {total_time:.1f} MINUTES 🌟")
    print("   You may now start the backend with:")
    print("   uvicorn backend.api:app --reload")
    print("=" * 60)
