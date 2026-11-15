# 20 Multi-Track & Cross-Pollinated Agentic Ideas
## Engineered for Gen AI Summit Hackathon 2026 (PC + Android Phone Hardware Setup)

This document contains **20 high-scoring agentic concepts** combining multiple tracks (**Biotech & AI**, **Voice & Enterprise**, **Content & Digital Art**, and **Open Track with Hardware Bonus**). Each idea uses only a **PC and Android phone**, fulfills the "one user, one job end-to-end, one wow moment" rule, and multi-dips sponsor prizes (**Oumi Iris**, **fal**, **boxd**, **treg**, **Google AI**, **Wonderful**).

---

## Summary Index by Track Intersection

| # | Name | Track Combination | Hardware (PC + Phone) Role | Primary Sponsors Stack |
|---|---|---|---|---|
| **1** | [CryoVoice](#1-cryovoice--hands-free--80circ-textc-freezer-navigator) | Biotech + Voice + Hardware | Android camera/mic barcode scanner at $-80^\circ\text{C}$ freezer | Wonderful, Gemini, Iris, boxd |
| **2** | [DoseGuard](#2-doseguard--bedside-pediatric-dosing-voice-auditor) | Biotech + Voice + Enterprise | Phone camera on ampoule/pump + haptic alarm override | Wonderful, Iris, Gemini |
| **3** | [BioProcure](#3-bioprocure--reagent-expiration-tracker--one-click-voice-replenishment) | Biotech + Enterprise Ops | Mobile shelf scanner + automated supplier PO generation | boxd, treg, Gemini, Iris |
| **4** | [ProtocolVoice](#4-protocolvoice--spoken-scientific-protocol-runner-with-live-timer-alarms) | Biotech + Voice | Hands-free voice timer & protocol deviation detector | Wonderful, Iris |
| **5** | [PathoStory](#5-pathostory--biopsy-to-visual-patient-explainer) | Biotech + fal (Art) | Ingests dense pathology PDF $\rightarrow$ visual patient comic on phone | fal, Gemini 2M context, Iris |
| **6** | [SOP-Graphic](#6-sop-graphic--dry-text-lab-protocol-to-ikea-style-visual-assembly-guide) | Biotech + fal (Art) | Ingests text SOP $\rightarrow$ IKEA-style visual protocol cards | fal, treg, boxd |
| **7** | [PreprintReel](#7-preprintreel--automated-3d-science-explainer-for-tech-transfer) | Biotech + fal (Art) | Preprint paper $\rightarrow$ 3D molecular video reel for investors | fal (video/image), Gemini |
| **8** | [PharmaPack](#8-pharmapack--regulatory-artwork--label-compliance-inspector) | Biotech + fal + Hardware | Phone scans medicine box $\rightarrow$ auto-regenerates compliant art | fal, Gemini Vision, Iris |
| **9** | [VoiceStudio](#9-voicestudio--real-time-voice-directed-campaign-studio) | Voice + fal (Art) | Voice brief on speakerphone $\rightarrow$ real-time `<3s` ad mockups | Wonderful, fal, Iris |
| **10** | [RoomRevive](#10-roomrevive--live-video-walkthrough--spatial-restyler) | Voice + fal + Hardware | Live phone video walkthrough $\rightarrow$ generative real-time staging | fal, Wonderful, Gemini |
| **11** | [ClaimSketch](#11-claimsketch--the-phone-call-insurance-accident-reconstructor) | Voice + fal + Enterprise | Caller describes crash $\rightarrow$ real-time 2D accident schematic | Wonderful, fal, Iris |
| **12** | [PodDirector](#12-poddirector--live-conversational-highlight--storyboard-clipper) | Voice + fal (Art) | Ambient listener $\rightarrow$ viral video clip with animated backdrops | Wonderful, fal |
| **13** | [WarRoom](#13-warroom--push-to-talk-devops-incident-commander) | Voice + DevOps (Quintessential) | Phone volume button as walkie-talkie $\rightarrow$ multi-VM fix | boxd, Wonderful, Iris |
| **14** | [ScamBuster](#14-scambuster--the-live-scam-interceptor-on-speakerphone) | Voice + Security (Open) | Phone takes spam call on speaker $\rightarrow$ extracts fraud IBAN | Wonderful, Iris, treg |
| **15** | [ReceiptChaser](#15-receiptchaser--desk-cam-accountant--mydata-auto-filer) | Hardware + Greek FinTech | Desk-mounted phone scans crumpled receipts $\rightarrow$ myDATA filing | boxd, Gemini Vision, Iris |
| **16** | [ContractAuditor](#16-contractauditor--physical-document-notary--land-registry-cross-checker) | Hardware + Enterprise (Legal) | Phone flips physical deed $\rightarrow$ checks Greek Land Registry | treg, Gemini Vision, Iris |
| **17** | [Grandma's Box](#17-grandmas-box--the-single-button-tangible-assistant) | Hardware + Voice + Bureaucracy | Single tactile button on phone $\rightarrow$ Greek voice helper/bill payer | Wonderful, Gemini, Iris |
| **18** | [MechanicAI](#18-mechanicai--acoustic--visual-car-engine-triage) | Hardware + Voice | Phone mic listens to engine knock + camera scans OBD2 code | Wonderful, treg, Gemini |
| **19** | [ShelfAudit](#19-shelfaudit--supermarket-price-tag-discrepancy-spotter) | Hardware + Enterprise Retail | Mobile phone scans shelf tags $\rightarrow$ verifies against POS ERP | boxd, Gemini Vision |
| **20** | [SignIntercom](#20-signintercom--real-time-greek-sign-language-gsl-to-voice-intercom) | Hardware + Voice + fal | Phone camera reads Greek Sign Language $\rightarrow$ speaks aloud to clerk | Wonderful, Gemini Vision, fal |

---

## Detailed Breakdowns by Cluster

### Cluster A: Biotech & AI $\times$ Voice & Enterprise (ALTP + Wonderful)

#### 1. "CryoVoice" — Hands-Free $-80^\circ\text{C}$ Freezer Navigator
* **The User & Job:** A researcher pulling frozen cell vials from a $-80^\circ\text{C}$ freezer with heavy cryogenic gloves (where touching pens or tablets is impossible).
* **The Wow Moment:** Researcher speaks into the Android phone: *"Find patient sample tumor biopsy B4 from October."* The PC screen shows a 3D grid highlight of the exact shelf, rack, and box. As the researcher pulls the vial, the phone camera reads the 2D matrix barcode on the tube, verifies it against the biobank inventory, and logs the thaw timestamp.
* **Hardware & Stack:** Android phone on chest harness/stand (camera + mic) $\leftrightarrow$ PC running `boxd` inventory VM.
* **Sponsors:** Wonderful Voice, Gemini Multimodal, Oumi Iris (sample viability check), boxd.

#### 2. "DoseGuard" — Bedside Pediatric Dosing Voice Auditor
* **The User & Job:** An oncology nurse administering high-risk chemotherapy/pediatric infusions where calculation errors are fatal.
* **The Wow Moment:** Nurse holds up the drug ampoule and infusion pump to the Android camera and speaks: *"Infusing doxorubicin for 14kg patient at 25 mg/m² over 60 mins."* The PC agent calculates the body surface area, parses the drug concentration from the ampoule via Gemini Vision, and cross-checks hospital guidelines. If the nurse set the pump rate wrong, the phone buzzes violently with a voice override: *"STOP. Pump displays 25 mL/hr; correct rate is 12.5 mL/hr."*
* **Hardware & Stack:** Android phone (camera + speaker + haptic alarm) $\leftrightarrow$ PC clinical dashboard.
* **Sponsors:** Wonderful Voice, Oumi Iris (critical dosing safety check: $1,750 prize), Google Gemini.

#### 3. "BioProcure" — Reagent Expiration Tracker & One-Click Voice Replenishment
* **The User & Job:** Lab manager struggling with expired reagents that ruin €10,000 research batches.
* **The Wow Moment:** Manager walks through the lab with the Android phone, pointing the camera at chemical shelf bottles. The phone highlights expired bottles in red AR. When the manager says: *"Order fresh Taq polymerase and buffer,"* the PC agent checks Greek supplier prices via `treg.to`, finds the cheapest stock, and uses `boxd run gmail` to draft the purchase order.
* **Hardware & Stack:** Android phone (mobile scanning) $\leftrightarrow$ PC (ERP/procurement).
* **Sponsors:** `boxd` (SaaS email/doc integrations), `treg.to` (supplier scraping), Gemini Vision.

#### 4. "ProtocolVoice" — Spoken Scientific Protocol Runner with Live Timer Alarms
* **The User & Job:** A lab technician executing a 47-step RNA extraction protocol across 6 hours.
* **The Wow Moment:** The technician speaks: *"Protocol step 12 complete."* The phone calculates incubation timing, sets automated stage timers, and announces: *"Centrifuge at 12,000 RPM for 3 minutes now."* If the technician forgets a step, the agent interrupts: *"Wait, you didn't add ethanol wash buffer."*
* **Hardware & Stack:** Android phone (voice station + timer) $\leftrightarrow$ PC (protocol documentation).
* **Sponsors:** Wonderful Voice, Oumi Iris (protocol deviation guardrail).

---

### Cluster B: Biotech & AI $\times$ Content & Digital Art (ALTP + fal)

#### 5. "PathoStory" — Biopsy-to-Visual Patient Explainer
* **The User & Job:** A clinical pathologist communicating scary, complex biopsy lab results to anxious patients who don't understand histology jargon.
* **The Wow Moment:** Drop a dense 8-page pathology biopsy report (PDF) onto the PC. The agent parses the cancer staging and tumor margins, and triggers **`fal.ai`** to generate a clear, empathetic 4-frame visual comic strip / anatomical diagram explaining what was removed, what was healthy, and what the next treatment step is.
* **Hardware & Stack:** PC (PDF ingestion & pipeline) $\rightarrow$ Android phone (patient companion app receiving the visual story).
* **Sponsors:** `fal` ($1,500 prize), Google Gemini long-context, Oumi Iris.

#### 6. "SOP-Graphic" — Dry Text Lab Protocol to IKEA-Style Visual Assembly Guide
* **The User & Job:** Lab safety officers onboarding junior biotech interns who make mistakes reading 30-page text SOPs.
* **The Wow Moment:** Ingest a dry SOP document (e.g. *"Biosafety Cabinet Decontamination Procedure"*). **`fal`** dynamically renders a visual, color-coded step-by-step graphic card for each step, with illustrated red warning badges for common contamination pitfalls.
* **Hardware & Stack:** PC (generation pipeline) $\rightarrow$ Android phone (mounted on bench showing the visual card deck).
* **Sponsors:** `fal.ai`, `treg.to` (safety regulation ingestion).

#### 7. "PreprintReel" — Automated 3D Science Explainer for Tech Transfer
* **The User & Job:** LifeTech Park commercialization managers marketing patents and published papers to venture capital investors.
* **The Wow Moment:** Paste a bioRxiv preprint URL. The agent extracts the novel mechanism of action, writes a 30-second narration script, and uses **`fal`** to generate high-fidelity molecular 3D visual clips and audio narration, outputting an investor-ready video reel.
* **Hardware & Stack:** PC (video generation engine) $\rightarrow$ Android phone (mobile reel preview).
* **Sponsors:** `fal.ai` (video & image models), Google Gemini.

#### 8. "PharmaPack" — Regulatory Artwork & Label Compliance Inspector
* **The User & Job:** Pharmaceutical packaging compliance officer ensuring multilingual medicine boxes meet strict Greek EOF / EMA regulations.
* **The Wow Moment:** Point the Android phone camera at a real medicine box. The vision model extracts typography, warnings, and Braille spacing. If the Greek text omits mandatory warning symbols, **`fal`** regenerates the corrected packaging artwork live on the PC screen.
* **Hardware & Stack:** Android phone (physical packaging scanner) $\leftrightarrow$ PC (compliance canvas).
* **Sponsors:** `fal.ai`, Gemini Flash Vision, Oumi Iris (regulatory compliance check).

---

### Cluster C: Voice & Enterprise $\times$ Content & Digital Art (Wonderful + fal)

#### 9. "VoiceStudio" — Real-Time Voice-Directed Campaign Studio
* **The User & Job:** A creative director brainstorming an advertising campaign in their car or on the move.
* **The Wow Moment:** The director talks over speakerphone: *"Create a dark, cinematic billboard campaign for an Athenian coffee brand, tagline 'Awake since 1890'."* The agent speaks back with copy options, while the PC projector simultaneously renders 4 ultra-fast **`fal`** visual mockups in under 3 seconds. The director says: *"Darker, add rain,"* and the image mutates live.
* **Hardware & Stack:** Android phone (voice microphone) $\leftrightarrow$ PC (live `fal` generative canvas).
* **Sponsors:** Wonderful Voice, `fal.ai`, Oumi Iris (brand safety critic).

#### 10. "RoomRevive" — Live Video Walkthrough & Spatial Restyler
* **The User & Job:** A Greek real estate agent showing an empty, decrepit apartment to a prospective buyer over video call.
* **The Wow Moment:** The agent walks through the apartment with the Android phone streaming live video. The buyer over voice says: *"What would this living room look like with Scandinavian furniture and oak flooring?"* **`fal`** inpaints the video frame in near real-time, streaming the furnished room back to the phone screen.
* **Hardware & Stack:** Android phone (camera stream) $\leftrightarrow$ PC (fast diffusion pipeline).
* **Sponsors:** `fal.ai`, Wonderful Voice.

#### 11. "ClaimSketch" — The Phone-Call Insurance Accident Reconstructor
* **The User & Job:** An auto insurance claims adjuster taking a driver's accident report over the phone.
* **The Wow Moment:** The customer calls the insurance voice agent on speakerphone describing the crash: *"I was turning left onto Kifisias Avenue when a white van ran the red light and clipped my rear bumper."* As the caller speaks, **`fal`** draws a bird's-eye 2D accident diagram on the adjuster's PC screen, highlighting vehicle impact zones and traffic signal states.
* **Hardware & Stack:** Android phone (driver calling in) $\leftrightarrow$ PC (real-time diagram canvas).
* **Sponsors:** Wonderful Voice, `fal.ai`, Oumi Iris (fraud risk score).

#### 12. "PodDirector" — Live Conversational Highlight & Storyboard Clipper
* **The User & Job:** A solo podcaster / live streamer who needs viral visual clips without spending 5 hours editing.
* **The Wow Moment:** Two people talk live on stage. The agent listens via ambient mic, detects the emotional climax of the conversation, writes video subtitles, and uses **`fal`** to generate animated illustration backdrops matched to the spoken topic.
* **Hardware & Stack:** Android phone (audio listener) $\leftrightarrow$ PC (video compositor).
* **Sponsors:** Wonderful, `fal.ai`.

---

### Cluster D: Voice & Enterprise $\times$ Open / Hardware / DevOps (Wonderful + Quintessential)

#### 13. "WarRoom" — Push-to-Talk DevOps Incident Commander
* **The User & Job:** On-call engineer woken up at 3:00 AM by a multi-service Kubernetes crash.
* **The Wow Moment:** Engineer picks up the Android phone and presses the physical volume button (walkie-talkie mode): *"What broke?"* Phone speaks: *"Postgres connection pool exhausted on worker-03."* The engineer says: *"Scale replica pool to 50 and purge redis cache."* On the PC, a `boxd` microVM executes the CLI commands live, verifies health metrics, and sends a Slack incident summary via `boxd run slack`.
* **Hardware & Stack:** Android phone (tactile volume rocker + voice) $\leftrightarrow$ PC (`boxd` infrastructure VM).
* **Sponsors:** `boxd` (SaaS / CLI), Wonderful Voice, Oumi Iris (production blast-radius guardrail).

#### 14. "ScamBuster / GPTCHA" — The Live Scam Interceptor on Speakerphone
* **The User & Job:** Elderly people or small businesses targeted by aggressive phone fraudsters (bank impersonators, fake tech support).
* **The Wow Moment:** A scammer calls the Android phone on stage. The user hits a hardware shortcut and hands the call to the agent. The agent adopts a clueless persona, keeps the scammer on hold, extracts the scammer's bank IBAN and phone origin, and displays the fraud dossier live on the PC monitor.
* **Hardware & Stack:** Android phone (incoming cellular call on speaker) $\leftrightarrow$ PC (real-time extraction dashboard).
* **Sponsors:** Wonderful Voice, Oumi Iris (scam intent detection), `treg.to` (reverse phone number OSINT lookup).

#### 15. "ReceiptChaser" — Desk-Cam Accountant & myDATA Auto-Filer
* **The User & Job:** Greek freelancer or restaurant owner dreading the monthly task of typing 200 crumpled paper receipts into the AADE myDATA tax portal.
* **The Wow Moment:** Slap physical crumpled Greek receipts one by one under the desk-mounted Android camera. The agent extracts AFM, VAT rate (13% vs 24%), and total amount. A `boxd` microVM logs into the accounting portal and pushes the invoice entries, matching them against bank transactions in real time.
* **Hardware & Stack:** Android phone (desk camera) $\leftrightarrow$ PC (accounting automation microVM).
* **Sponsors:** `boxd` (browser/API automation), Gemini Multimodal Vision, Oumi Iris (tax audit compliance check).

#### 16. "ContractAuditor" — Physical Document Notary & Land Registry Cross-Checker
* **The User & Job:** Greek lawyer or notary verifying a physical property contract against the Hellenic Cadastre (Ktimatologio).
* **The Wow Moment:** Flip pages of a physical Greek property contract under the Android phone. The agent extracts property coordinates (KAEK) and cadastral maps, queries the land registry via `treg.to`, and flags on the PC screen: *"WARNING: Encroachment dispute registered on plot 14 in 2024."*
* **Hardware & Stack:** Android phone (document camera) $\leftrightarrow$ PC (legal intelligence canvas).
* **Sponsors:** `treg.to` (registry scraping), Gemini Vision, Oumi Iris.

---

### Cluster E: Physical World / Everyday AI (Open Track Hardware Bonus)

#### 17. "Grandma's Box" — The Single-Button Tangible Assistant
* **The User & Job:** An 80-year-old grandmother in an Athenian suburb who cannot use smartphones or navigate modern digital services.
* **The Wow Moment:** The Android phone sits in a cardboard or 3D stand with only the screen showing a giant red circle (or triggered by the physical power button). She holds up a Greek prescription or a utility bill to the camera and taps the button. The phone speaks in friendly Greek: *"Γιαγιά, αυτό είναι ο λογαριασμός της ΔΕΗ. Είναι 65 ευρώ και λήγει την Παρασκευή. Θέλεις να τον πληρώσω από τον λογαριασμό σου;"* (Grandma, this is your power bill. It is €65, due Friday. Shall I pay it?). She says *"Ναι"* (Yes), and the PC agent pays it.
* **Hardware & Stack:** Android phone (tangible UI + Greek voice) $\leftrightarrow$ PC (banking sandbox).
* **Sponsors:** Wonderful Voice, Gemini Multimodal, Oumi Iris.

#### 18. "MechanicAI" — Acoustic & Visual Car Engine Triage
* **The User & Job:** A stranded driver whose car is making a terrifying knocking sound and showing a check-engine light.
* **The Wow Moment:** Hold the Android phone under the hood of a running engine. The mic streams the audio acoustic frequency (detecting alternator bearing failure vs valve tap), while the camera scans the OBD2 dashboard code. The agent explains the severity, finds the 3 nearest open auto repair shops in Spata/Athens via `treg.to`, and calls the mechanic to book a slot.
* **Hardware & Stack:** Android phone (acoustic microphone + flashlight camera) $\leftrightarrow$ PC (repair agent).
* **Sponsors:** Wonderful Voice, `treg.to`, Gemini Audio/Vision.

#### 19. "ShelfAudit" — Supermarket Price-Tag Discrepancy Spotter
* **The User & Job:** Supermarket store clerk verifying that physical shelf price labels match the digital POS register (a major source of consumer fines in Greece).
* **The Wow Moment:** Walk past a grocery shelf with the Android phone camera scanning. The agent reads the printed shelf tag (*"Feta cheese €9.80/kg"*) and queries the internal ERP via `boxd`. If the POS says €11.20/kg, the phone flashes red and prints a replacement price sticker automatically.
* **Hardware & Stack:** Android phone (fast mobile scanner) $\leftrightarrow$ PC (store ERP backend).
* **Sponsors:** `boxd` microVMs, Gemini Vision.

#### 20. "SignIntercom" — Real-Time Greek Sign Language (GSL) to Voice Intercom
* **The User & Job:** A deaf citizen attempting to communicate at a Greek KEP or hospital reception desk without a human interpreter.
* **The Wow Moment:** The citizen signs Greek Sign Language in front of the Android phone camera. Gemini Vision translates the hand signs into natural spoken Greek through the phone speaker for the clerk. The clerk speaks back naturally, and the phone translates the voice back into live animated visual sign-language cards on the screen.
* **Hardware & Stack:** Android phone (two-way counter intercom) $\leftrightarrow$ PC (vision translation pipeline).
* **Sponsors:** Wonderful Voice, Gemini Multimodal Vision, `fal.ai` (visual card rendering).
