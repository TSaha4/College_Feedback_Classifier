# CampusLens

CampusLens is a full-stack, AI-powered college review classifier. It uses state-of-the-art transformer models (DistilBERT & RoBERTa) to automatically categorize student feedback (Academics, Hostel, Mess, etc.) and analyze sentiment (Positive, Neutral, Negative) in real-time.

It features a fast React + Vite frontend and a PyTorch + FastAPI backend.

## 🚀 Setup Guide for New Computers

Because the machine learning model weights (`model.safetensors`) are very large (~500MB total), they are **not** stored on GitHub. When you clone this repository on a new machine, you need to train/download the models once before starting the app.

Follow these 4 steps to get the app running:

### 1. Install Dependencies
Make sure you have Node.js and Python 3.10+ installed.

```bash
# Install Python dependencies
pip install -r requirements.txt

# Install Frontend dependencies
cd frontend
npm install
cd ..
```

### 2. Generate the AI Models
You need to run the pure PyTorch training script. It will automatically download the base models, fine-tune both the Category and Sentiment models on `project_dataset.csv`, and save the weights locally.

```bash
# Train both models sequentially (Takes ~15 mins on CPU, ~3 mins on GPU)
python train_models.py
```
*Note: This script will automatically create the `cat_model/` and `sent_model/` folders containing the active weights and tokenizers.*

### 3. Start the Backend
The FastAPI server will load the newly trained models into memory.

```bash
uvicorn backend.api:app --reload --port 8000
```
Wait until the terminal says: `Models ready ✅`

### 4. Start the Frontend
Open a **new terminal window** and run:

```bash
cd frontend
npm run dev
```

Visit **[http://localhost:5173](http://localhost:5173)** in your browser!
