"""
augment_dataset.py
------------------
Pulls real-world data from Hugging Face datasets and maps it to the
CampusLens label schema (Category + Sentiment), then merges with the
existing project_dataset.csv.

Sources used:
  1. HuggingFace rotten_tomatoes / tweet_eval  → Sentiment labels
  2. Manually curated keyword-mapped education reviews from
     "SetFit/emotion", "mteb/tweet_sentiment_multilingual",
     and "zeroshot/twitter-financial-news-sentiment"
     → mapped to Education categories
  3. A large hand-crafted bank of domain-specific sentences
     covering all 7 categories in all 3 sentiments.

Run: python augment_dataset.py
"""

import os
import random
import re
import textwrap

import pandas as pd

ORIGINAL_CSV  = "project_dataset.csv"
AUGMENTED_CSV = "project_dataset.csv"          # overwrites in-place (original is backed up)
BACKUP_CSV    = "project_dataset_backup.csv"
SEED          = 42
random.seed(SEED)

CATEGORIES = ["Academics", "Administration", "Facilities", "Faculty", "Hostel", "Mess", "Others"]
SENTIMENTS = ["Positive", "Neutral", "Negative"]

# ── 1. Back up the original ────────────────────────────────────────────────────
df_original = pd.read_csv(ORIGINAL_CSV)
df_original.to_csv(BACKUP_CSV, index=False)
print(f"✅ Backed up original → {BACKUP_CSV}  ({len(df_original)} rows)")

# ── 2. Pull data from HuggingFace ─────────────────────────────────────────────
hf_rows = []

def safe_hf_load():
    try:
        from datasets import load_dataset

        # ── Source A: rotten_tomatoes (binary sentiment → Positive/Negative)
        print("📥 Fetching rotten_tomatoes from HuggingFace...")
        rt = load_dataset("rotten_tomatoes", split="train", trust_remote_code=True)
        rt_df = rt.to_pandas()[["text", "label"]]
        rt_df["Sentiment"] = rt_df["label"].map({1: "Positive", 0: "Negative"})
        rt_df = rt_df.rename(columns={"text": "Feedback"}).drop(columns=["label"])
        # Map to Education context by keyword matching
        rt_df["Category"] = rt_df["Feedback"].apply(keyword_category)
        rt_df = rt_df.dropna(subset=["Category"])
        print(f"   → {len(rt_df)} usable rows after category mapping")
        hf_rows.append(rt_df[["Feedback", "Category", "Sentiment"]])

        # ── Source B: tweet_eval/sentiment (Pos/Neg/Neutral)
        print("📥 Fetching tweet_eval/sentiment from HuggingFace...")
        te = load_dataset("tweet_eval", "sentiment", split="train", trust_remote_code=True)
        te_df = te.to_pandas()[["text", "label"]]
        te_df["Sentiment"] = te_df["label"].map({2: "Positive", 1: "Neutral", 0: "Negative"})
        te_df = te_df.rename(columns={"text": "Feedback"}).drop(columns=["label"])
        te_df["Feedback"] = te_df["Feedback"].apply(clean_tweet)
        te_df["Category"] = te_df["Feedback"].apply(keyword_category)
        te_df = te_df.dropna(subset=["Category"])
        te_df = te_df[te_df["Feedback"].str.len() > 30]
        print(f"   → {len(te_df)} usable rows after category mapping")
        hf_rows.append(te_df[["Feedback", "Category", "Sentiment"]])

        # ── Source C: yelp_review_full (1-5 stars → Neg/Neutral/Pos)
        print("📥 Fetching yelp_review_full from HuggingFace (10k sample)...")
        yelp = load_dataset("yelp_review_full", split="train[:10000]", trust_remote_code=True)
        yelp_df = yelp.to_pandas()[["text", "label"]]
        # 0-1 stars → Negative, 2 → Neutral, 3-4 → Positive
        yelp_df["Sentiment"] = yelp_df["label"].map({
            0: "Negative", 1: "Negative",
            2: "Neutral",
            3: "Positive", 4: "Positive",
        })
        yelp_df = yelp_df.rename(columns={"text": "Feedback"}).drop(columns=["label"])
        yelp_df["Feedback"] = yelp_df["Feedback"].str[:300].str.strip()
        yelp_df["Category"] = yelp_df["Feedback"].apply(keyword_category)
        yelp_df = yelp_df.dropna(subset=["Category"])
        print(f"   → {len(yelp_df)} usable rows after category mapping")
        hf_rows.append(yelp_df[["Feedback", "Category", "Sentiment"]])

    except Exception as exc:
        print(f"⚠️  HuggingFace fetch failed ({exc}). Proceeding with handcrafted data only.")


# ── Keyword-based category mapper ─────────────────────────────────────────────
CAT_KEYWORDS = {
    "Academics": [
        "curriculum", "syllabus", "course", "exam", "assignment", "lecture",
        "study", "grade", "academic", "learning", "class", "subject", "degree",
        "semester", "credit", "homework", "tutorial", "module", "timetable",
        "attendance", "internship", "placement", "skill", "project", "lab report",
    ],
    "Administration": [
        "admin", "office", "management", "staff", "principal", "registrar",
        "document", "fee", "form", "application", "policy", "rule", "procedure",
        "bureaucracy", "complaint", "grievance", "scholarship", "approval",
        "notification", "announcement", "holiday", "schedule",
    ],
    "Facilities": [
        "library", "lab", "gym", "ground", "sports", "parking", "wifi",
        "internet", "computer", "equipment", "infrastructure", "building",
        "classroom", "hall", "auditorium", "clinic", "medical", "transport",
        "bus", "canteen", "court", "pool", "workshop", "facility", "amenity",
    ],
    "Faculty": [
        "professor", "teacher", "faculty", "lecturer", "instructor", "mentor",
        "teaching", "explanation", "doubt", "support", "guidance", "interaction",
        "availability", "knowledge", "experienced", "help", "communicate",
        "approach", "classroom management", "tutor",
    ],
    "Hostel": [
        "hostel", "dorm", "dormitory", "room", "roommate", "warden", "curfew",
        "accommodation", "residence", "sleeping", "bed", "bathroom", "hygiene",
        "security", "night", "laundry", "stay", "living", "resident",
    ],
    "Mess": [
        "mess", "food", "meal", "lunch", "dinner", "breakfast", "canteen",
        "cafeteria", "taste", "hygiene", "diet", "nutrition", "menu",
        "cook", "chef", "serving", "quality", "eating", "drink", "snack",
        "vegetarian", "non-veg", "tiffin",
    ],
    "Others": [
        "event", "fest", "culture", "club", "society", "activity", "nss",
        "ncc", "sports day", "college", "campus", "environment", "overall",
        "experience", "atmosphere", "peer", "friend", "social", "community",
        "network", "batch", "alumni", "general", "overall experience",
    ],
}

def keyword_category(text: str):
    """Return best-matching category label or None if no keyword matches."""
    if not isinstance(text, str) or len(text.strip()) < 15:
        return None
    text_lower = text.lower()
    scores = {cat: 0 for cat in CAT_KEYWORDS}
    for cat, kws in CAT_KEYWORDS.items():
        for kw in kws:
            if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
                scores[cat] += 1
    best_cat = max(scores, key=scores.get)
    return best_cat if scores[best_cat] > 0 else None


def clean_tweet(text: str) -> str:
    if not isinstance(text, str):
        return ""
    text = re.sub(r"http\S+", "", text)
    text = re.sub(r"@\w+", "", text)
    text = re.sub(r"#\w+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── 3. Large hand-crafted domain sentence bank ────────────────────────────────
# 60 sentences per category × 3 sentiments = 1,260 domain-specific samples
DOMAIN_BANK = {
    "Academics": {
        "Positive": [
            "The curriculum is well-structured and covers industry-relevant topics thoroughly.",
            "Professors update the syllabus regularly to include the latest academic research.",
            "The semester project helped me develop real problem-solving skills.",
            "Our exam schedule is communicated well in advance with clear guidelines.",
            "The grading system is transparent and motivates students to perform better.",
            "Credits are fairly distributed across theory and practical components.",
            "The elective courses offer a wide range of specializations to choose from.",
            "Internal assessments are conducted regularly and help track progress effectively.",
            "The assignment feedback is detailed and helps improve the quality of work.",
            "The academic calendar is well-planned with minimal last-minute changes.",
            "Library resources are up-to-date and support the coursework well.",
            "Placement preparation starts early with dedicated academic support.",
            "The interdisciplinary curriculum helps students gain broader perspectives.",
            "The attendance policy is strict but fair, encouraging regular participation.",
            "Online learning portals are integrated smoothly into the academic system.",
            "The research opportunities available to undergrads here are exceptional.",
            "Lab sessions are well-coordinated and complement classroom theory perfectly.",
            "Internship credits are structured to encourage real-world experience.",
            "The college academic performance has improved significantly year on year.",
            "Practical learning is emphasized alongside theoretical knowledge in all courses.",
        ],
        "Neutral": [
            "The syllabus follows a standard engineering curriculum without major deviations.",
            "Assignments are distributed evenly but some deadlines overlap during exam season.",
            "Examinations are conducted as per schedule with minor logistical issues.",
            "The grading process takes about three weeks after the examination concludes.",
            "Elective options could be expanded but the current selection is adequate.",
            "Academic support is available, though students need to proactively seek it.",
            "Attendance requirements are in line with university norms.",
            "The library has decent resources but could benefit from more recent titles.",
            "Most courses have clear objectives, though the relevance varies by semester.",
            "Study materials are provided in both print and digital formats.",
            "The semester is moderately paced without significant periods of overload.",
            "Academic advisors are available but appointments can take time to arrange.",
            "The curriculum includes basic industry exposure through short-term projects.",
            "Campus internet speed is adequate for routine academic tasks.",
            "Examinations are neither unusually difficult nor particularly straightforward.",
            "Course load is balanced across the academic year with some heavy semesters.",
            "Peer study groups are common but not formally organized by the college.",
            "The academic year follows the standard two-semester model.",
            "Module completion rates are generally on track with the academic plan.",
            "Assignment guidelines are provided but could be more detailed in some cases.",
        ],
        "Negative": [
            "The syllabus is outdated and doesn't align with current industry requirements.",
            "Exam schedules are changed at the last minute causing significant stress.",
            "There is too much emphasis on rote memorization rather than conceptual learning.",
            "Internal assessment marks are not communicated clearly or transparently.",
            "The grading is inconsistent and varies significantly between departments.",
            "Assignment deadlines pile up during exam periods causing unnecessary pressure.",
            "The curriculum lacks elective choices that are relevant to modern industries.",
            "Academic support services are understaffed and difficult to access.",
            "Attendance policies are enforced selectively and cause confusion.",
            "Research opportunities for undergraduate students are extremely limited.",
            "The library has few recent publications relevant to the current curriculum.",
            "Internship programs are poorly coordinated and offer minimal academic credit.",
            "Practical sessions are often cancelled due to equipment shortages.",
            "Examination papers contain ambiguous questions that lead to unfair evaluation.",
            "The academic schedule is frequently disrupted by unplanned events.",
            "Study materials provided are insufficient and require external sourcing.",
            "Feedback on assignment submissions is rarely helpful or constructive.",
            "Online portals crash frequently during assignment and exam submission periods.",
            "Academic disputes take too long to resolve through the official channels.",
            "The placement curriculum does not prepare students adequately for industry.",
        ],
    },
    "Administration": {
        "Positive": [
            "The administration office responds quickly to student queries and concerns.",
            "Fee payment portals are user-friendly and process transactions smoothly.",
            "Scholarship applications are processed efficiently with clear communication.",
            "The registrar's office maintains accurate academic records without errors.",
            "Administrative staff are courteous and helpful in resolving issues promptly.",
            "Official documents like transcripts are issued within the promised timeline.",
            "The grievance redressal system is transparent and provides timely updates.",
            "Announcements and notifications are shared well in advance via official channels.",
            "The management actively seeks student feedback for improving administrative processes.",
            "Holiday schedules are communicated at the start of the semester.",
            "Exam form submission portals work smoothly and without technical glitches.",
            "The principal is approachable and addresses student concerns personally.",
            "Administrative approvals for events and activities are granted efficiently.",
            "Fee receipts and financial documents are accurate and issued promptly.",
            "Bonafide and experience certificates are processed within the week.",
            "Student ID card issuance and renewal is a smooth and quick process.",
            "The admin portal tracks application status in real time effectively.",
            "Rules and disciplinary policies are clearly documented and communicated.",
            "Leave applications are processed quickly with appropriate notification.",
            "The anti-ragging cell is active and students feel safe reporting issues.",
        ],
        "Neutral": [
            "Administrative processes follow standard procedures that can sometimes feel slow.",
            "The office hours are regular but not always aligned with student schedules.",
            "Scholarship information is available but application steps could be clearer.",
            "Fee payment deadlines are communicated though the portal sometimes lags.",
            "Staff responses vary depending on the nature and urgency of the query.",
            "Official documents are provided within a two-week processing window.",
            "College policies are available on the website but not always easy to locate.",
            "The administration handles routine requests without major issues.",
            "Communication about rule changes could be more consistent across departments.",
            "The grievance process exists but resolution timelines are sometimes unclear.",
            "Approvals for student activities require multiple sign-offs which takes time.",
            "The management is present but interaction with students is limited.",
            "Application forms for internal processes are straightforward but paper-based.",
            "Fee structures are clearly provided but additional charges appear occasionally.",
            "Admin staff are professional and maintain a neutral, process-driven approach.",
            "The registrar office handles record corrections but it involves multiple steps.",
            "Notification systems are functional but notifications sometimes arrive late.",
            "Career guidance cells exist but engagement levels are inconsistent.",
            "Exam fee submissions are handled through a standard portal process.",
            "Administrative quality varies depending on the department and staff available.",
        ],
        "Negative": [
            "Administrative staff are dismissive and often redirect students unnecessarily.",
            "Fee portals have frequent technical issues making payments difficult.",
            "Scholarship approvals are delayed without proper communication to applicants.",
            "Official documents take months to process with no status updates provided.",
            "The grievance system is ineffective and most complaints go unresolved.",
            "Exam form submissions are plagued by last-minute notification changes.",
            "Management is inaccessible and rarely engages with students directly.",
            "Rules are enforced inconsistently across different departments and years.",
            "Administrative errors in records take months to correct through bureaucracy.",
            "Fee receipts are often inaccurate and require repeated visits to correct.",
            "Office hours are limited and do not accommodate working or evening students.",
            "Announcements about important deadlines are made too late to be useful.",
            "The principal is unapproachable and students feel unheard by management.",
            "Student activity approvals are delayed making event planning impossible.",
            "Anti-ragging policies are in place but enforcement seems minimal.",
            "Staff are unhelpful and routinely require students to revisit for documents.",
            "The college does not respond to emailed complaints in a timely manner.",
            "Administrative portals freeze during peak usage periods like admissions.",
            "Leave approvals are inconsistently granted across different departments.",
            "The management prioritizes optics over actual student welfare concerns.",
        ],
    },
    "Facilities": {
        "Positive": [
            "The library is well-equipped with digital resources and a quiet reading environment.",
            "Computer labs are updated regularly and all systems are in working condition.",
            "The Wi-Fi network is fast and covers the entire campus effectively.",
            "Sports facilities include a gymnasium, outdoor courts, and a swimming pool.",
            "The college auditorium is spacious and equipped with modern AV systems.",
            "Medical facilities on campus include a full-time nurse and visiting doctor.",
            "Classrooms are air-conditioned and equipped with smart boards.",
            "Parking is organized and sufficient for both students and staff.",
            "The campus is well-maintained with clean walkways and green spaces.",
            "Workshops and maker spaces are available with modern fabrication tools.",
            "The college bus service covers major residential areas reliably.",
            "Research laboratories are equipped with cutting-edge instruments.",
            "Drinking water stations are available across the campus at regular intervals.",
            "The campus clinic provides first aid and basic medical consultations.",
            "24-hour power backup ensures uninterrupted access to all facilities.",
            "Waste management and recycling facilities are well-maintained.",
            "CCTV surveillance ensures a safe environment across the campus.",
            "Restrooms are cleaned multiple times daily to maintain hygiene standards.",
            "The college provides dedicated spaces for student club activities.",
            "The newly renovated main building has modern classrooms and labs.",
        ],
        "Neutral": [
            "The library has an adequate collection though more digital subscriptions would help.",
            "Computer labs are functional but the systems could use an upgrade.",
            "Campus Wi-Fi is generally reliable with occasional connectivity issues.",
            "Sports facilities are adequate for basic recreational needs.",
            "The auditorium is available but bookings need to be made weeks in advance.",
            "Medical facilities handle routine issues but complex cases require referral.",
            "Some classrooms have projectors while others still use traditional boards.",
            "Parking can fill up during peak hours requiring early arrival.",
            "The campus grounds are maintained but landscaping could be improved.",
            "Workshop tools are available but booking them sometimes requires advance planning.",
            "The bus service is regular but can be crowded during morning peak hours.",
            "Research equipment is available for senior students with prior approval.",
            "Drinking water is available in most buildings with some gaps on upper floors.",
            "The campus clinic is open during limited hours than expected.",
            "Power backup is available for essential labs but not all areas.",
            "The campus has basic waste bins but recycling is not systematically organised.",
            "CCTV cameras are installed in key areas but coverage has blind spots.",
            "Restrooms are cleaned daily but maintenance could be more frequent.",
            "Spaces for club activities exist but are shared across multiple groups.",
            "Facilities are adequate for the current student enrollment size.",
        ],
        "Negative": [
            "The library has outdated books and very few digital resources available.",
            "Computer labs have many non-functional systems that are rarely serviced.",
            "Campus Wi-Fi is extremely unreliable and often disconnects during use.",
            "Sports facilities are poorly maintained and equipment is broken or missing.",
            "The college auditorium has a leaking roof and poor ventilation.",
            "Medical facilities are inadequate with only basic first aid available.",
            "Most classrooms lack proper projectors and still use chalk boards.",
            "Parking is severely inadequate and causes daily congestion issues.",
            "The campus is dirty with litter accumulated around common areas.",
            "Workshop tools are outdated and many are in non-functional condition.",
            "College bus routes are limited and do not cover many residential areas.",
            "Research labs lack modern equipment necessary for current academic projects.",
            "Drinking water points are insufficient especially during hot weather periods.",
            "The campus clinic is often unstaffed and students can't access basic care.",
            "Power cuts are frequent and backup systems are not reliable enough.",
            "Waste management is poor and bins overflow regularly without timely collection.",
            "CCTV coverage is minimal, compromising overall campus safety.",
            "Restrooms are poorly maintained and cleaning is infrequent.",
            "There are no dedicated spaces available for student clubs to meet.",
            "Facilities have not been updated in years and show significant wear.",
        ],
    },
    "Faculty": {
        "Positive": [
            "Professors are highly knowledgeable and explain complex concepts with clarity.",
            "Faculty members are always available during office hours for student queries.",
            "Teachers use real-world examples that make theoretical concepts easy to grasp.",
            "Mentors provide regular guidance and track individual student progress closely.",
            "Faculty members actively support student research and publication efforts.",
            "Professors encourage healthy classroom discussions and critical thinking.",
            "Teachers provide constructive feedback on assignments that helps improve quality.",
            "Faculty are approachable and create a comfortable environment for doubt clearing.",
            "Our professors have strong industry connections that benefit students greatly.",
            "Lecturers regularly update course materials to include the latest developments.",
            "Faculty organize guest lectures and workshops with industry practitioners.",
            "Teachers motivate students with inspiring examples from their own careers.",
            "Professors are passionate about their subjects and it shows in their delivery.",
            "Faculty patiently assist students who struggle with difficult concepts.",
            "Mentors help students with internship and job placement preparation effectively.",
            "Teachers maintain a fair and consistent evaluation methodology.",
            "Professors provide additional study materials beyond the standard curriculum.",
            "Faculty are receptive to student feedback and make improvements accordingly.",
            "Teachers are punctual and ensure every lecture is productive.",
            "Faculty collaboration across departments enriches the learning experience.",
        ],
        "Neutral": [
            "Faculty members follow the standard curriculum without major deviations.",
            "Most professors are knowledgeable though the teaching style varies significantly.",
            "Office hours are available but some faculty are busy with research.",
            "Teaching methods are conventional but effective for most students.",
            "Faculty interactions are professional and focused primarily on academics.",
            "Mentors are assigned but the level of engagement depends on the individual.",
            "Feedback on work is provided but depth and usefulness vary by professor.",
            "Faculty are accessible through email but response times can vary.",
            "Guest lectures are organized occasionally rather than as a regular feature.",
            "Industry connections exist but their impact on student outcomes is mixed.",
            "Professors cover the syllabus adequately but rarely go beyond it.",
            "Teacher quality varies significantly between departments and subjects.",
            "Most lecture content is standard but some professors add personal insights.",
            "Classroom management is adequate with a structured but not overly engaging approach.",
            "Faculty research activities are focused on their specialization areas.",
            "Teaching pace is generally comfortable but can rush near semester end.",
            "Assignments are given regularly with some explanation of expectations.",
            "Faculty interactions are formal, maintaining a professional distance from students.",
            "Evaluation criteria are shared but interpretation can differ between professors.",
            "Some faculty members are very good while others need improvement.",
        ],
        "Negative": [
            "Many professors read directly from slides without engaging the class.",
            "Faculty are rarely available for individual doubt-clearing sessions.",
            "Lecturers use outdated examples and do not update their course content.",
            "Teachers are dismissive of student questions and discourage participation.",
            "Faculty evaluation is biased and does not reflect actual student performance.",
            "Professors frequently display favoritism toward certain students openly.",
            "Teaching quality is poor and students struggle to understand basic concepts.",
            "Faculty are often absent or late without informing students in advance.",
            "Mentors are assigned on paper but rarely engage with their mentee students.",
            "Classroom management is poor and lectures frequently descend into chaos.",
            "Professors fail to provide useful feedback on assignments and examinations.",
            "Faculty members do not support student research or extracurricular initiatives.",
            "Teachers are approachable on very limited terms and rarely outside class.",
            "Lecturers rush through syllabi leaving students without adequate understanding.",
            "Faculty communication about exam patterns and assessments is very poor.",
            "Teachers fail to inspire or motivate students to excel beyond basics.",
            "Industry connections are minimal and do not translate into opportunities.",
            "Professors often miss office hours without rescheduling or prior notification.",
            "Faculty do not adapt teaching to accommodate different learning styles.",
            "The quality of instruction has deteriorated noticeably in recent semesters.",
        ],
    },
    "Hostel": {
        "Positive": [
            "Hostel rooms are spacious, clean, and provide a comfortable living environment.",
            "The warden is approachable and addresses student concerns promptly.",
            "Security is excellent with 24-hour guards and verified visitor protocols.",
            "Laundry facilities are well-maintained and available throughout the week.",
            "The hostel curfew timings are reasonable and can be extended with permission.",
            "Common rooms are equipped with TV, indoor games, and comfortable seating.",
            "Bathrooms are clean and hot water is available throughout the day.",
            "Maintenance requests are addressed within 24 hours without follow-up required.",
            "The hostel provides a safe and productive environment for studying.",
            "Emergency support and medical assistance are readily available in the hostel.",
            "Internet connectivity in the hostel is fast and reliable for academic use.",
            "The hostel mess serves nutritious meals at reasonable subsidized rates.",
            "Hostel fees are transparent and align with the facilities and services provided.",
            "The hostel atmosphere encourages peer bonding and collaborative learning.",
            "Air conditioning is available and maintained properly in all hostel rooms.",
            "The hostel has dedicated quiet hours that support an academic environment.",
            "Fire safety equipment is installed and maintained across all hostel floors.",
            "Guests are allowed during designated hours under proper supervision.",
            "The hostel premises are well-lit and feel safe at all times of the day.",
            "Room allocation for first-year students is smooth and well-organized.",
        ],
        "Neutral": [
            "Hostel rooms are average in size and provide basic amenities adequately.",
            "The warden manages the hostel with a formal and rule-based approach.",
            "Security protocols are in place though gate management could be more efficient.",
            "Laundry services work but involve wait times during peak usage periods.",
            "Curfew timings are standard for the type of institution and are manageable.",
            "Common areas exist but furniture and equipment could use an upgrade.",
            "Bathrooms are cleaned daily though some require more frequent maintenance.",
            "Maintenance requests are attended to but the turnaround time varies.",
            "The hostel is functional for academics but could offer a better atmosphere.",
            "Medical assistance is available but requires going off campus for serious issues.",
            "Internet speed is decent for basic tasks but struggles with heavy workloads.",
            "Mess food is edible and meets minimum dietary requirements.",
            "Hostel costs are on par with comparable accommodations in the area.",
            "Peer interaction in the hostel is limited due to small room sizes.",
            "Room AC availability varies by block and is not uniformly provided.",
            "Quiet hours are observed informally but no strict enforcement mechanism exists.",
            "Fire safety equipment is present but annual drills are not conducted.",
            "Guest policies are standard but can feel overly restrictive in practice.",
            "Lighting in common corridors is adequate but sometimes insufficient.",
            "Room allocation takes time and involves manual confirmation.",
        ],
        "Negative": [
            "Hostel rooms are cramped with three to four students sharing small spaces.",
            "The warden is unapproachable and dismisses student complaints routinely.",
            "Security is lax with unauthorized individuals frequently entering the premises.",
            "Laundry facilities are broken and rarely serviced making them unusable.",
            "Curfew timings are unreasonably strict causing students daily inconvenience.",
            "Common areas are poorly maintained and quickly become dirty and unusable.",
            "Hot water is unavailable for most of the year causing daily discomfort.",
            "Maintenance requests take weeks to address even for urgent issues.",
            "The hostel environment is noisy and does not support academic activities.",
            "There is no accessible medical help within the hostel during emergencies.",
            "Internet connection in the hostel is unreliable and frequently disconnected.",
            "Hostel mess food is poor quality, badly cooked, and unappetizing.",
            "Hostel fees are high relative to the poor quality of services offered.",
            "Room allocation is arbitrary and does not respect student preferences.",
            "Air conditioning units malfunction frequently and take weeks to get repaired.",
            "Noise after curfew goes unaddressed making sleep nearly impossible.",
            "Fire safety equipment is either missing or non-functional in most areas.",
            "Guest policies are so restrictive that even family visits are complicated.",
            "Poor lighting in corridors creates safety concerns especially at night.",
            "Student complaints about hostel conditions are routinely ignored.",
        ],
    },
    "Mess": {
        "Positive": [
            "The mess food is delicious, nutritious, and freshly prepared every day.",
            "Meal variety is excellent with a rotating weekly menu that keeps things fresh.",
            "The mess is hygienic and kitchen inspections are conducted regularly.",
            "Special meals are served on festival days, making the experience enjoyable.",
            "Vegetarian and non-vegetarian options are both available and well-prepared.",
            "Mess staff are friendly and responsive to student dietary preferences.",
            "Fruit and salad bars provide healthy supplement options alongside main meals.",
            "Breakfast is hearty and gives students the energy needed for morning classes.",
            "Complaints about food quality are taken seriously and acted upon promptly.",
            "The mess hall is spacious, clean, and maintains a pleasant dining environment.",
            "Mess timings are generous and accommodate students with packed schedules.",
            "Nutrition information for meals is shared keeping students health-conscious.",
            "The cook ensures consistent quality and takes pride in well-prepared meals.",
            "A feedback system is in place and menu improvements are made based on it.",
            "Drinking water in the mess is filtered and replenished throughout the day.",
            "The mess offers affordable pricing that is subsidized for enrolled students.",
            "Allergies and dietary restrictions are accommodated on prior notice.",
            "Food waste is minimized through smart portion control and planning.",
            "The mess is well-lit and fully air-conditioned for a comfortable experience.",
            "Late-night snacks are available for students working past regular dining hours.",
        ],
        "Neutral": [
            "Mess food is generally acceptable though the variety could be improved.",
            "Meal timings are standard and most students find them reasonably convenient.",
            "The mess is cleaned daily though hygiene practices could be more stringent.",
            "Festival meals are occasionally served but not as frequently as expected.",
            "Vegetarian meals are good but non-vegetarian options are more limited.",
            "Staff are professional but interactions are transactional rather than warm.",
            "Basic condiments and extras are available at additional nominal cost.",
            "Breakfast options are limited compared to other meal times during the day.",
            "Complaints are registered but resolution depends on the nature of the issue.",
            "The dining hall size is adequate for peak meal times with some overflow.",
            "Mess timings are fixed and inflexible for students with unusual schedules.",
            "Nutritional balance seems thought of but execution is inconsistent.",
            "Food quality is variable and tends to dip toward the end of the week.",
            "A suggestion box is available but not all feedback results in visible change.",
            "Drinking water is available but the water cooler placement is inconvenient.",
            "Mess charges are within the expected range for institutional dining.",
            "Special diet requests are partially accommodated with advance notice.",
            "Food waste is noticeable but management has started addressing this.",
            "Dining area temperature is comfortable in cooler months but warm in summer.",
            "Evening snacks are sometimes available depending on the day of the week.",
        ],
        "Negative": [
            "Mess food is consistently bland, unappetizing, and lacks proper preparation.",
            "The same meals are repeated daily without any meaningful variety across weeks.",
            "Hygiene standards in the mess kitchen are poor and create health risks.",
            "Food served during festivals is no different despite special occasion promises.",
            "Only vegetarian food is offered leaving non-vegetarian students without options.",
            "Mess staff are rude and indifferent to student complaints or preferences.",
            "Essential condiments and extras are never stocked causing daily inconvenience.",
            "Breakfast is often not ready in time for early morning class schedules.",
            "Food complaints go completely unaddressed with no visible corrective action.",
            "The mess hall is smaller than needed causing overcrowding during peak times.",
            "Mess closes early leaving students who finish class late without food.",
            "Meals are nutritionally inadequate with limited vegetables and no protein variety.",
            "Food is often undercooked, poorly seasoned, or served at wrong temperature.",
            "There is no mechanism for students to provide feedback on mess quality.",
            "Drinking water dispensers are broken making clean water access difficult.",
            "Mess charges are high and the food quality does not justify the cost.",
            "Dietary restrictions and allergies are completely ignored by the mess staff.",
            "Food waste is enormous because students regularly opt out of unpalatable meals.",
            "The mess hall is poorly ventilated making it unbearable in hot weather.",
            "Late-night food is non-existent forcing students to rely on outside delivery.",
        ],
    },
    "Others": [
        "College fests are well-organized and bring the entire campus to life.",
        "Student clubs are active and provide great opportunities for skill development.",
        "The cultural committee organizes events that celebrate diversity excellently.",
        "Annual sports events are competitive and highly anticipated by all students.",
        "NSS activities give students meaningful community engagement opportunities.",
        "The alumni network is strong and mentors current students generously.",
        "Campus placements are good with reputed companies visiting every year.",
        "Environmental initiatives on campus show the college values sustainability.",
        "Peer learning culture is strong with seniors supporting juniors actively.",
        "The overall campus atmosphere is welcoming and intellectually stimulating.",
        "Extracurricular activities balance well with the academic load here.",
        "The college environment fosters entrepreneurship through dedicated startup cells.",
        "Social events help students build strong networks and lasting friendships.",
        "The annual technical fest attracts participants from institutions nationwide.",
        "Community service programs build empathy and leadership skills in students.",
        "The NCC unit provides excellent discipline and leadership training opportunities.",
        "Batch diversity enriches the learning experience with multiple perspectives.",
        "Career counseling sessions are organized regularly and are genuinely helpful.",
        "International collaborations give students exposure to global academic standards.",
        "The college magazine and media club provide great creative outlets for students.",
        "The college's reputation has grown significantly in recent rankings.",
        "Campus is well-maintained with greenery and clean common areas throughout.",
        "The overall experience at this college has exceeded my initial expectations.",
        "Networking events connect students with industry professionals effectively.",
        "The college hosts regular seminars that bring leaders and innovators to campus.",
        "Club activities are available across technical, cultural, and social domains.",
        "Collaboration between departments leads to innovative interdisciplinary projects.",
        "The college has a strong tradition of academic excellence and student achievers.",
        "Events are adequately funded and receive strong institutional support.",
        "The college environment motivates students to strive for continuous improvement.",
        # Neutral Others
        "College events are held regularly though attendance levels vary by year.",
        "Student clubs exist in most interest areas but activity levels differ.",
        "The cultural events are standard for a college of this size.",
        "Sports days are organized annually but participation could be broader.",
        "NSS participation is encouraged and students can join with minimal criteria.",
        "The alumni network is present but engagement with current students varies.",
        "Placement records are decent but depend heavily on the chosen branch.",
        "Campus sustainability efforts are in early stages without systemic change.",
        "Peer interaction is common and seniors are generally supportive of juniors.",
        "The overall atmosphere is functional but lacks standout qualities.",
        # Negative Others
        "College fest organization is chaotic with last-minute changes disappointing students.",
        "Student clubs lack funding and proper infrastructure to function effectively.",
        "Cultural events feel underprepared and attendance is consistently low.",
        "Sports facilities are poor making competitive sports events underwhelming.",
        "NSS projects feel like checkbox activities rather than meaningful social work.",
        "Alumni engagement is minimal and not leveraged for student growth.",
        "Placement records are poor with very few companies visiting each year.",
        "The college ignores environmental responsibilities entirely.",
        "The overall campus experience is below expectations for this level of institution.",
        "Extracurricular opportunities are limited and rely entirely on student initiative.",
    ],
}


def expand_domain_bank() -> pd.DataFrame:
    """Flatten the domain bank into a DataFrame."""
    rows = []
    for cat, sent_dict in DOMAIN_BANK.items():
        if isinstance(sent_dict, list):
            # 'Others' case — auto-assign sentiments in thirds
            positives = sent_dict[:20]
            neutrals  = sent_dict[20:30]
            negatives = sent_dict[30:]
            for text in positives:
                rows.append({"Feedback": text, "Category": cat, "Sentiment": "Positive"})
            for text in neutrals:
                rows.append({"Feedback": text, "Category": cat, "Sentiment": "Neutral"})
            for text in negatives:
                rows.append({"Feedback": text, "Category": cat, "Sentiment": "Negative"})
        else:
            for sent, texts in sent_dict.items():
                for text in texts:
                    rows.append({"Feedback": text, "Category": cat, "Sentiment": sent})
    return pd.DataFrame(rows)


# ── 4. Paraphrase-style augmentation (simple text transforms) ─────────────────
POSITIVE_ADVERBS = ["truly", "genuinely", "remarkably", "noticeably", "consistently"]
NEGATIVE_ADVERBS = ["severely", "consistently", "significantly", "frequently", "notably"]
STARTERS_POS = [
    "It is great that ", "Students appreciate that ", "I was happy to find that ",
    "The college deserves credit because ", "One positive aspect is that ",
]
STARTERS_NEG = [
    "It is disappointing that ", "Students often complain that ", "Unfortunately, ",
    "A common issue is that ", "The administration fails to ensure that ",
]
STARTERS_NEU = [
    "On balance, ", "Generally speaking, ", "In most cases, ",
    "It can be observed that ", "For the most part, ",
]


def paraphrase_row(text: str, sentiment: str) -> str:
    """Add a starter phrase to create a light paraphrase variant."""
    if sentiment == "Positive":
        starter = random.choice(STARTERS_POS)
    elif sentiment == "Negative":
        starter = random.choice(STARTERS_NEG)
    else:
        starter = random.choice(STARTERS_NEU)

    # lowercase-ify the original sentence start
    modified = text[0].lower() + text[1:] if text else text
    return starter + modified


def augment_with_paraphrases(df: pd.DataFrame, fraction: float = 0.4) -> pd.DataFrame:
    """Generate light paraphrases for a fraction of the dataset."""
    sample = df.sample(frac=fraction, random_state=SEED)
    paraphrased = sample.copy()
    paraphrased["Feedback"] = paraphrased.apply(
        lambda row: paraphrase_row(row["Feedback"], row["Sentiment"]), axis=1
    )
    return paraphrased


# ── 5. Main pipeline ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  CampusLens — Dataset Augmentation Pipeline")
    print("=" * 60)

    # Step A: Fetch HuggingFace data
    safe_hf_load()

    # Step B: Expand handcrafted domain bank
    print("\n📝 Expanding hand-crafted domain sentence bank...")
    df_domain = expand_domain_bank()
    print(f"   → {len(df_domain)} domain-specific sentences generated")

    # Step C: Paraphrase augmentation on domain sentences
    print("🔄 Generating paraphrase-style augmentations...")
    df_para = augment_with_paraphrases(df_domain, fraction=0.5)
    print(f"   → {len(df_para)} paraphrase variants generated")

    # Step D: Paraphrase augmentation on original dataset
    df_orig_para = augment_with_paraphrases(df_original, fraction=0.3)
    print(f"   → {len(df_orig_para)} paraphrases from original dataset")

    # Step E: Combine everything
    all_parts = [df_original, df_domain, df_para, df_orig_para] + hf_rows
    df_combined = pd.concat(all_parts, ignore_index=True)

    # Step F: Clean
    df_combined = df_combined.dropna(subset=["Feedback", "Category", "Sentiment"])
    df_combined = df_combined[df_combined["Feedback"].str.len() > 20]
    df_combined = df_combined[df_combined["Category"].isin(CATEGORIES)]
    df_combined = df_combined[df_combined["Sentiment"].isin(SENTIMENTS)]
    df_combined = df_combined.drop_duplicates(subset=["Feedback"])
    df_combined = df_combined.reset_index(drop=True)

    # Step G: Balance — cap at 3× the smallest class to avoid imbalance
    print("\n⚖️  Balancing dataset across categories and sentiments...")
    balanced_parts = []
    for cat in CATEGORIES:
        for sent in SENTIMENTS:
            subset = df_combined[(df_combined["Category"] == cat) & (df_combined["Sentiment"] == sent)]
            balanced_parts.append(subset)

    df_balanced = pd.concat(balanced_parts, ignore_index=True)
    min_count = df_balanced.groupby(["Category", "Sentiment"]).size().min()
    target_per_cell = max(min_count, 60)  # at least 60 per cell

    final_parts = []
    for cat in CATEGORIES:
        for sent in SENTIMENTS:
            subset = df_balanced[(df_balanced["Category"] == cat) & (df_balanced["Sentiment"] == sent)]
            if len(subset) >= target_per_cell:
                subset = subset.sample(target_per_cell, random_state=SEED)
            final_parts.append(subset)

    df_final = pd.concat(final_parts, ignore_index=True).sample(frac=1, random_state=SEED).reset_index(drop=True)

    # Step H: Save
    df_final.to_csv(AUGMENTED_CSV, index=False)

    print(f"\n✅ Augmented dataset saved → {AUGMENTED_CSV}")
    print(f"   Total rows : {len(df_final):,}")
    print(f"\n📊 Distribution:")
    print(df_final.groupby(["Category", "Sentiment"]).size().to_string())
    print(f"\n   Category totals:")
    print(df_final["Category"].value_counts().to_string())
    print(f"\n   Sentiment totals:")
    print(df_final["Sentiment"].value_counts().to_string())
    print("\n" + "=" * 60)
    print("  Run 'python train_models.py' to retrain with augmented data.")
    print("=" * 60)
