# Biotech & AI track explained

Source: hackathon Prep page (track list), Athens LifeTech Park site and event listings. General background below is common knowledge, not from the organisers.

## What the track is
- One of four tracks: **Biotech & AI, with the hosts, Athens LifeTech Park**. The hackathon takes place at the park in Spata, Attica.
- Athens LifeTech Park is described as the first biotech park in Greece / SE Europe: a not-for-profit with a biotech incubator and accelerator, a preclinical contract research organisation (CRO) and a translational research hub.
- Challenges are announced at kickoff (Sat 12:30). There may be a specific brief; ask.

## Plain-language biotech primer
- **Drug discovery pipeline:** find a target -> find candidate molecules -> test in the lab and in animals (preclinical) -> test in people (clinical trials, phases 1-3) -> regulatory approval. Each stage is slow, costly and document-heavy.
- **Preclinical CRO:** a contract lab that runs studies for biotech companies. Output: protocols, raw data, reports.
- **Translational research:** moving a finding from the lab bench toward a treatment for patients.
- **Incubator/accelerator:** gives young biotech startups lab space and support.
- **Where it hurts (and agents help):** literature review, protocol writing, lab-notebook and data entry, instrument data checks, regulatory and trial paperwork, matching patients to trials.

## What judges here will likely care about
(Inference from the host's profile.)
- **Scientific credibility:** claims backed by quoted sources; no invented citations.
- **Safety and privacy:** synthetic or consented data only; no medical advice.
- **A real user:** a scientist, lab manager, clinician or trial coordinator, not "biotech" in general.
- **Reproducibility:** same input, same traceable output.

## Ideas that fit (see ./ideas/)
- **#5 Trial matcher:** patient summary in, eligible trials out, quoting the eligibility line.
- **#12 Fifty papers before lunch:** reads literature, finds where papers disagree, proposes the experiment that settles it.
- **The lab notebook that listens** (kickoff deck): talk at the bench, get a structured protocol, results table and reagent order.
- **Instrument whisperer** (kickoff deck): watches raw instrument output, flags odd runs, drafts the report.
- **Agent-first twists:** a CRO-report agent that turns raw study data into the client report; a protocol-checker that reviews a lab protocol for missing controls.

## How to win this track (suggested)
1. Pick one named user, for example "a lab manager at a preclinical CRO who writes weekly study reports".
2. Use real or realistic open data (public papers, public trial registries, synthetic patients).
3. Show every claim with a quoted source and reject anything not found in the source text.
4. Demo one ugly case (conflicting papers, an exclusion criterion hidden in a footnote).
5. State the limits: decision support, not medical advice.

## Credits relevant here
Google inference for everyone; Oumi Iris early access if you want a decision-model gate (eligibility, QC pass/fail); boxd for isolated compute.

## Questions to ask at kickoff
Is there a specific biotech challenge brief? Is there park data or a mentor from the lab side? Any data we may or may not use?
