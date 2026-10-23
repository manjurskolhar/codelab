# CodeLab — ICD-10 Coding Practicum website

A website where Health Information Management students complete practical ICD-10 coding assignments. It works the same way as ChartLab: one installation serves **many colleges**, each with its own address, look, people, records and subscription plan.

- **Owner** (you, the provider) creates colleges, sets each college's student limit and subscription end date, and can pause or renew them. The owner sees each college's numbers but never its students or their work.
- **College admin** sets the college's logo and colours and creates faculty and guest accounts.
- **Faculty** create student accounts (one at a time or by importing a class list), assign activities from the library, edit the EHR records, download submissions and grade.
- **Students** sign in, download the Word activity document, open the assignment's EHR in a new tab, look up and verify codes in the built-in **ICD-10-CM code book**, enter their final codes in the EHR's **Coding** activity, and upload their completed document.

**Front page and sign-in.** The site address (`/`) shows a public front page that explains CodeLab (features, how it works, roles, the activity library) with a sign-in form. Each college's address (`/c/your-college`) shows a branded sign-in page with the college's name, logo and colours and a step-by-step description of the process for students, faculty and admins.

**The EHR.** Each record opens in a hospital-style EHR workstation: a patient storyboard (MRN, allergies, code status, encounter, length of stay, payer), activities for Summary, Chart Review (encounters, notes, labs, imaging, procedures, meds, orders, immunizations, with a preview pane), Results Review and Flowsheets (values over time), MAR, Problem List, Allergies, Notes, Demographics, **Coding** and **Code Book**. In **Coding** the student enters ICD-10-CM and ICD-10-PCS codes in sequence, with POA indicators for inpatients and a case label for multi-case practice sets. Automatic edits flag invalid or non-billable codes, missing 7th characters, codes that can never be first-listed, "Code first" order problems, Excludes1 conflicts, duplicates and missing POA, and show "Use additional code" reminders. The codes save to the student's assignment; faculty see them, with the edit results, on the grading page and the number of codes per student on the submissions list. Opened from the library (faculty, guests), Coding works in practice mode and is not saved.

Included on first start:

- **30 library activities**, each with a Word activity document and a faculty answer key: 2 orientation sessions, 4 ICD-10-CM foundations, 13 chapter-specific activities (diabetes, hypertension with heart failure and CKD, sepsis, COPD and respiratory failure, MI with PCI, neoplasms and chemotherapy, fractures, poisoning/adverse effect/underdosing, obstetrics, newborn, substance use, Z codes and SDOH, HIV), 4 inpatient activities (principal diagnosis, secondary diagnoses and POA, CDI and provider queries, a stroke capstone), 2 ICD-10-PCS activities, 2 quality activities (coding validation audit, outpatient practice set) and **3 billing group activities** (team revenue cycle with an inpatient UB-04 claim, team professional billing with CMS-1500 claims, team denial management with an appeal letter).
- **30 EHR records**: 20 fictional patient charts and 10 practice data sets (diagnostic statements, ED drug cases, principal diagnosis scenarios, PCS procedure statements, an audit sample, office visits, draft CMS-1500 claims, a payer remittance with denials). The UB-04 record includes the draft claim and itemized charges under Reports & Forms.
- **The ICD-10-CM code book**: the complete Tabular List (CDC/NCHS, April 1, 2026 release, FY2026) with Includes, inclusion terms, Excludes1, Excludes2, Code first, Use additional code, Code also and 7th-character notes. It opens beside any EHR record (the **Code book** button), on its own page in the menu, or in its own tab at `/codes` (for example `/codes/E11.621`). Students can search by words or by code, see whether a code is billable, and follow links between codes.

All built-in dates of service are in **September 2026**, so the FY2026 code set in the code book matches the records and answer keys. Start with the two **Orientation sessions** (the coding record and the code book; the coding process from Index to Tabular) before the graded activities.

**What the code book is not:** it is the Tabular List only. Students still need the ICD-10-CM **Alphabetic Index**, Table of Drugs and Chemicals and Neoplasm Table (printed code book or encoder), and the ICD-10-PCS tables for the PCS activities. The activities teach Index-first coding and use the code book to verify.

**Guides:** the `guides` folder has a **Student quick guide**, a **Faculty and admin quick guide** and an **Owner guide** (Word). Post the student guide on your learning platform before the first session.

---

## 1. Requirements

- **Node.js 22.13 or newer** (uses the built-in SQLite database). Check with `node -v`.
- No other software, no `npm install`, no external database.
- About 50 MB of disk to start; uploads are stored in the `data/` folder.

## 2. Run it

```bash
cd codelab
node server.js
```

On Windows you can instead double-click **start-codelab.bat**. (Always type `node server.js`, not just `server.js`, or Windows will ask which app should open the file.)

Open **http://localhost:8080**. The first visit shows **Set up CodeLab**: create the **owner** account (name, email, password). Then:

1. **Colleges → Add a college:** enter the college name, its web address (for example `kfu`, giving `https://your-site/c/kfu`), the college admin's name and email, an optional student limit and an optional subscription end date.
2. CodeLab shows the college's sign-in address and the admin's temporary password. Send them to the college.
3. The college admin signs in at their address, chooses a password, sets the college's look under **Appearance**, and adds faculty and students.

Each college's sign-in page shows that college's name, logo and colours.

Change the port with `PORT=3000 node server.js`.

**Try it with demo accounts:** run `node server.js --demo` once (it creates a "Demo College" at `/c/demo` and prints the accounts), then `node server.js`:

| Role | Email (username) | Password |
|---|---|---|
| Owner | owner@codelab.local | Owner@2026 |
| Admin | admin@codelab.local | Admin@2026 |
| Faculty | faculty@codelab.local | Faculty@2026 |
| Student | student@codelab.local | Student@2026 |
| Online program admin (`/c/online`) | program@codelab.local | Program@2026 |
| Online learner, awaiting payment (`/c/online`) | learner@codelab.local | Learner@2026 |

It also creates **CodeLab Online Academy** (`/c/online`), an open online certificate program: anyone can register at `/register` (see section 3b).

Change these passwords (My account) or remove the accounts before real use. Running `--demo` again resets them to these passwords.

## 3. Colleges, plans and subscriptions (owner)

| Setting | What it does |
|---|---|
| **Student limit** | The college cannot have more active students than this. Deactivated students do not count. Leave empty for no limit. |
| **Subscription end date** | Admins see a reminder 30 days before. After the date the college is **read-only**: everyone can sign in and view, but nothing can be added or changed until you extend it (**+1 month**, **+12 months**, or a new date). |
| **Pause college** | Signs everyone at the college out and blocks sign-in until you resume. Nothing is deleted. |
| **Delete college** | Only for paused colleges; you type the college's address to confirm. Deletes all its people, records and uploads permanently. |
| **College admins** | Add more admins or reset an admin's password. |
| **Update all colleges** | Appears when an update brings new or corrected built-in EHR records and activities. |

Billing itself (invoices, payments) is done outside CodeLab; record the billing contact and invoice notes on each college's page.

## 3a. Adding people

| Who | Done by | Where |
|---|---|---|
| Faculty | Admin | **Faculty** page → enter name and email → **Create faculty account** |
| Students | Faculty (or admin) | **Students** page → add one, or **Import a class list** (CSV: `Name, Email, Section`) |

CodeLab shows a **temporary password** for each new account (and lets you download them as a CSV). Share the sign-in address and temporary password privately. At first sign-in each person must choose their own password.

### Students create their own accounts (class codes)

Faculty or the admin can let students sign up themselves instead of creating every account. On the **Students** page, under **Class codes**, choose a section, how long the code works (7, 14, 30 or 90 days, or no end date) and an optional maximum number of students, then click **Create class code**. Share the code (for example `K4DL-GJRF`), the link (**Copy link**, e.g. `https://your-site/join/K4DL-GJRF`) or a printed sheet (**Print**).

Students open **Join a class** on the front page (or the link), enter the code, their name, college email and a password of their choice, and go straight to **My assignments**, placed in the code's section. Self sign-ups count toward the college's student limit, show "Signed up with code …" in the roster, and can be deactivated like any other student. Turn a code off when the class has joined.

### Teams for group activities

Group activities (the three Billing activities, or any activity where faculty tick **Group activity**) are done in teams. On the **Students** page, give each student a team name, include a fourth **Team** column in the class-list CSV (`Name, Email, Section, Team`), or use **Make teams** to split a section into teams of 2-6. For a group activity, one member uploads the team's document and it appears as submitted for every member; codes entered in the EHR Coding activity are shared the same way. On the grading page, **Give this grade and feedback to all of Team X** grades every member at once. Students without a team can still submit on their own.

## 3b. Online certificate program (independent learners, paid registration)

A college can run an **online certificate program** that anyone can join without a college: learners register themselves, pay a fee (default **10 USD**), complete the course practicals and receive a certificate. Payments and certificates are confirmed **by hand** by the program staff. The owner creates such a college by ticking **Run an online certificate program** in **Add a college** (the demo creates one at `/c/online`). Only one college should have registration open; the front page then shows a **Get certified** button and a program section.

| Step | Learner | Program staff (admin or faculty) |
|---|---|---|
| 1. Register | Front page → **Get certified** (or `/register`): name as it should appear on the certificate, email, phone, country, password | |
| 2. Pay | **Registration & payment**: reads the payment instructions (and online payment link, if set), pays, uploads the receipt (PDF/PNG/JPG) with the transaction reference | **Registrations** → **Receipts to check**: download the receipt, check it against the bank/payment account, then **Approve** or **Reject** (with a note the learner sees). A rejected learner can upload a new receipt. |
| 3. Practicals | Only after approval, **My practicals** appears: download the sheet, work in the EHR and Coding activity, **upload the completed sheet** | Grades as usual (**Assigned work → Review**). Every activity assigned to *All students* is a course practical; the due date is optional. |
| 4. Pass | Each practical needs the pass mark (default 70%). Below it, the practical shows **Not passed: resubmit** and the learner can correct and submit again (the earlier attempt is kept in the history). | Grades the new attempt. |
| 5. Certificate | **Progress & certificate** shows every practical and, once issued, **Download certificate** | **Certificates**: learners who passed every practical are **Eligible**. **Print template** makes a ready-made certificate (save it as PDF), **Upload PDF**, check the number, then **Issue** (or **Withdraw**). |

The admin sets the title, fee, currency, pass mark, payment instructions, payment link (must start with `https://`), and certificate note in **Program settings**, and can close registration there. Learners waiting for approval see nothing but their registration page: no practicals, EHR records or answer keys.

### Guest accounts for clients or visitors

The admin can give someone outside the program time-limited, read-only access, for example a client evaluating CodeLab.

1. Sign in as admin → **Guests** → enter name, email, organization (optional) and **Access lasts** (1, 3, 7, 14 or 30 days; 7 is the default) → **Create guest account**.
2. Share the sign-in address and temporary password. The guest chooses their own password at first sign-in.
3. The guest sees the **Activity library** (and can download activity documents) and the **EHR patient charts**. They cannot see students, submissions, grades or answer keys, and cannot change anything. A banner shows when their access ends.
4. Access stops automatically at the end time, even if the guest is signed in. On the **Guests** page you can **Extend 7 days**, **End now**, **Reset password** or **Delete**.

**Forgotten password:** faculty reset student passwords; the college admin resets faculty passwords; the owner resets college admin passwords (**Reset password** buttons). If the owner forgets their own password, run on the server:

```bash
node server.js --reset-password admin@your-university.edu
```

### Editing EHR records

Admin and faculty can edit any EHR record (students can only view them): **EHR patient charts → Edit**, or **Edit EHR** on a library activity. Each section (allergies, problems, vitals, labs, orders, medications, prevention, encounters, insurance, and report tables) is a spreadsheet-style grid: type in a cell, **+ Add row**, **×** to delete a row, Enter to move down. You can copy a block of cells in Excel and paste it into any cell. Report tables also let you rename, add and remove columns. Click **Save chart** when done.

Charts used by library activities match their answer keys; if you change their data, update the key too, or make a new chart for your own version.

## 4. Appearance (each college)

**Appearance** in the college admin's menu changes the look for everyone at that college, including its sign-in page. The owner's **Platform appearance** sets the look of the owner console and the general sign-in page.

- **Themes:** Clinical Navy (default), EHR Classic (charcoal and red), Care Teal, Evergreen, Plum Clinic and Night Shift (dark).
- **Fine-tune colors:** top bar, side menu, buttons/highlights and the EHR chart menu, to match your institution's colors. Text colors adjust automatically for readability.
- **Name:** site name and institution/program shown in the top bar and on the sign-in page.
- **Logo and top bar:** upload your institution's logo (PNG, JPG, WebP or SVG; resized automatically), choose whether it sits on a white background and whether the site name shows beside it, and set the top bar height (48–96 px) and the accent line thickness (0–8 px).

Changes preview immediately and apply to everyone when you click **Save for everyone**.


## 4a. The ICD-10-CM code book and yearly updates

The code book is the file `public/icd10cm.json`, built from the official ICD-10-CM Tabular List XML that CDC/NCHS publishes every year (public domain). The server compresses it (about 0.7 MB over the network) and browsers cache it for a day.

When a new fiscal year starts (1 October) or an April update is released:

1. Download the ICD-10-CM Tabular List XML for that release from the CDC (NCHS) ICD-10-CM files page and unzip it.
2. Run `python3 tools/build-codebook.py icd10cm_tabular_2027.xml "ICD-10-CM Tabular List, FY2027 (October 1, 2026)"` (Python 3, no extra packages).
3. Restart the server.
4. Review the activities: the built-in records use September 2026 dates of service with FY2026 codes. If you move the dates into a new fiscal year, check every answer key for new, expanded or deleted codes.

## 5. Put it on your university server (production)

Run CodeLab behind your web server with HTTPS, and keep it running as a service.

**a) Service (Linux, systemd)** — copy the folder to `/opt/codelab`, then save as `/etc/systemd/system/codelab.service`:

```ini
[Unit]
Description=CodeLab ICD-10 Coding Practicum
After=network.target

[Service]
WorkingDirectory=/opt/codelab
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Environment=COOKIE_SECURE=1
Restart=always
User=codelab

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin codelab
sudo chown -R codelab /opt/codelab
sudo systemctl enable --now codelab
```

**b) HTTPS with nginx** (example for `codelab.your-university.edu`):

```nginx
server {
  listen 443 ssl;
  server_name codelab.your-university.edu;
  ssl_certificate     /etc/ssl/certs/codelab.crt;
  ssl_certificate_key /etc/ssl/private/codelab.key;
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

Set `COOKIE_SECURE=1` whenever the site is served over HTTPS.

**c) Docker (optional):**

```bash
docker build -t codelab .
docker run -d -p 8080:8080 -v codelab-data:/app/data --name codelab codelab
```

## Updating CodeLab

1. Stop the server.
2. Replace the program files with the new version. **Keep the `data` folder.**
3. Start the server. New built-in activities are added automatically.
4. Sign in as admin and open **Overview → Built-in content**. If it says records or documents differ, click **Update built-in content** to bring the built-in EHR records, activities and documents up to date. Accounts, assignments, submissions, grades and anything you created are not changed.

## 6. Backups

Everything lives in the `data/` folder:

- `data/codelab.db` — accounts, activities, EHR records, submissions, grades
- `data/files/` — uploaded documents

Back up the whole `data/` folder daily (for example with your university's backup tool, or `tar czf codelab-$(date +%F).tgz data`). To move servers, copy the program folder and `data/`.

## 7. Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port the server listens on |
| `COOKIE_SECURE` | off | Set to `1` when served over HTTPS |
| `CODELAB_DATA` | `./data` | Folder for the database and uploads |

## 8. Security notes

- Passwords are stored as salted scrypt hashes; sessions use HttpOnly cookies that expire after 7 days.
- Permissions are checked on the server: every request is limited to the user's own college; students cannot see answer keys, the library, or other students' work; faculty cannot create faculty or guest accounts; guests are read-only and their access ends at the set time; the owner cannot open students' work.
- Sign-in is limited to 10 attempts per 15 minutes per email and address.
- Uploads are limited to 20 MB and to document and image types.
- All patient records are fictional training data. Do not enter real patient information.

## 9. Before using the content with students

Every ICD-10-CM code in the answer keys was checked against the FY2026 (April 1, 2026) code files: each one exists and is complete (billable) where a billable code is expected. Guideline citations, ICD-10-PCS codes, MS-DRG CC/MCC statements and Coding Clinic references should still be reviewed by a credentialed coder against the current official books before grading, and the keys accept well-reasoned alternatives where coding practice varies. Each key says this at the top.
