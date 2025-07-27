# College_Feedback_Classifier & Sentiment Analyzer

A dual transformer-based NLP system to classify student feedback into:

- 📂 **Category** — (e.g., Mess, Hostel, Academics, etc.)
- 💬 **Sentiment** — Positive, Negative, or Neutral

Built using Hugging Face Transformers on **Google Colab**, this project fine-tunes:

- `microsoft/deberta-v3-base` for category classification  
- `roberta-base` for sentiment analysis

---

## 🗂️ Dataset

The dataset `project_dataset.csv` includes:

| Feedback                             | Category | Sentiment |
|--------------------------------------|----------|-----------|
| "Food has improved in the mess."     | Mess     | Positive  |
| "Hostel room was not cleaned today." | Hostel   | Negative  |

---

## 🚀 Model Architecture

| Task                  | Transformer Model       | Hugging Face ID              |
|-----------------------|--------------------------|-------------------------------|
| Category Classification | DeBERTa-v3 (Base)       | `microsoft/deberta-v3-base`   |
| Sentiment Analysis     | RoBERTa (Base)          | `roberta-base`                |

Training and evaluation are done using `Trainer` API from 🤗 Transformers.

---

## 📊 Results

| Task                  | Accuracy   |
|-----------------------|------------|
| 📂 Category           | **89.08%** |
| 💬 Sentiment          | **98.32%** |

---

## 🧪 Evaluation Report

The performance of the trained models on the test dataset is summarized below. Both classification reports were generated using `sklearn.metrics.classification_report`.

### 📂 Category & 💬 Sentiment Classification Metrics

<img src="https://github.com/user-attachments/assets/f3d4d7d3-03ca-41ac-b3ce-d0937076ca3f" alt="Classification Report" width="600" />

> 📌 *The report includes precision, recall, and F1-score for each class across both Category and Sentiment predictions.*


---

## 💻 Sample Prediction

<img width="839" height="146" alt="image" src="https://github.com/user-attachments/assets/6ee124ea-7aef-48c6-8be1-0751b8fd0fbc" />



## 🛠️ Requirements (Colab-ready)
You don’t need to install anything manually — the notebook will install:
(just uncomment the first line)

transformers
datasets
accelerate
bitsandbytes
