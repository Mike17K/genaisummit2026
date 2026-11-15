"""Unit tests for the streaming clause splitter, playback cursor, and danger cut/explain/resume state machine."""
import asyncio
import sys
import time
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import alerts, config, info_pipeline, speak  # noqa: E402
from server.state import ActiveSpeech, State  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(("PASS" if cond else "FAIL"), name, "" if cond else detail)


def run():
    # 1. Clause splitting
    c1, rem1 = info_pipeline.split_next_clause("Ahead at twelve o'clock, there is a wooden desk with a laptop.", is_first=True)
    check("eager first clause splits at comma (>=4 words)", c1 == "Ahead at twelve o'clock," and rem1.startswith("there is"), (c1, rem1))

    c2, rem2 = info_pipeline.split_next_clause(rem1, is_first=False)
    check("incomplete sentence without trailing space waits for more tokens", c2 is None)

    c3, rem3 = info_pipeline.split_next_clause(rem1 + " Next to it is a chair. ", is_first=False)
    check("splits cleanly on sentence boundary", c3 == "there is a wooden desk with a laptop." and rem3.startswith("Next"), (c3, rem3))

    # 2. Exact playback cursor on danger cut
    st = State(socket=None)
    st.active_speech = ActiveSpeech(
        kind="answer",
        user_question="What is in this room?",
        generated_text="Ahead is a desk. On the left is a sofa. Behind it is a window.",
        clause_timeline=[
            [100.0, 101.5, "Ahead is a desk."],          # completely played before 102.0
            [101.5, 103.5, "On the left is a sofa."],    # 25% played at 102.0 (0.5s / 2.0s)
            [103.5, 105.5, "Behind it is a window."],    # 0% played (still queued in WebAudio)
        ],
    )
    st.audible_until = 105.5

    was_speaking, intr = info_pipeline.cancel_for_danger(st, now=102.0)
    check("cancel_for_danger detects active speech", was_speaking is True)
    check("preserves user question", intr is not None and intr.user_question == "What is in this room?")
    check(
        "computes heard words accurately and excludes unplayed queued clauses",
        intr is not None and "Ahead is a desk." in intr.spoken_so_far and "window" not in intr.spoken_so_far,
        intr.spoken_so_far if intr else None,
    )
    check("resets audible_until after danger cut", st.audible_until == 0.0 and st.active_speech is None)

    # 3. Double danger cut during explain_resume keeps original interrupted question
    st.active_speech = ActiveSpeech(
        kind="explain_resume",
        user_question=intr.user_question,
        generated_text="Concrete pillar ahead. Continuing, on the left is a sofa.",
        clause_timeline=[[104.0, 105.5, "Concrete pillar ahead."]],
    )
    _, intr2 = info_pipeline.cancel_for_danger(st, now=105.6)
    check(
        "second danger cut preserves original user question",
        intr2 is not None and intr2.user_question == "What is in this room?" and "Concrete pillar ahead." in intr2.spoken_so_far,
    )

    # 4. User barge-in clears interrupted state completely
    async def dummy():
        await asyncio.sleep(10)

    async def test_barge_in():
        st.info_task = asyncio.create_task(dummy())
        cut = info_pipeline.cancel_for_user(st)
        await asyncio.sleep(0)
        check("user barge-in cancels info_task and clears interrupted_speech", cut is True and st.interrupted_speech is None)

    asyncio.run(test_barge_in())

    # 5. Explanation lock + 0.5 s post-explanation window blocks re-triggering
    class DummySocket:
        def __init__(self):
            self.json_msgs = []
            self.byte_msgs = []

        async def send_json(self, p):
            self.json_msgs.append(p)

        async def send_bytes(self, b):
            self.byte_msgs.append(b)

    async def test_explain_lock():
        sock = DummySocket()
        s = State(socket=sock)
        s.frames.append((10.0, b"\xff\xd8frame1"))
        s.frames.append((10.6, b"\xff\xd8frame2"))

        # While explaining_alert is True, alert_locked is True and watch_once skips without calling judge
        s.explaining_alert = True
        check("alert_locked True while generating explanation", s.alert_locked(10.7) is True)
        ran = await alerts.watch_once(s, 10.7)
        check("watch_once skips while explaining_alert is True", ran is False and s.last_judged_frame == 0.0)

        # Simulate streaming a "why" sentence followed by a resumed answer sentence
        orig_stream_tts = speak.stream_tts

        async def fake_stream_tts(text: str):
            # 48,000 bytes = 1.00 s of 24 kHz mono PCM16
            yield b"\x00" * 48000

        speak.stream_tts = fake_stream_tts
        try:
            async def fake_tokens():
                for part_txt in [
                    "Chair ahead at twelve o'clock, ",
                    "one step away. ",
                    "Continuing what I was saying, on the left is a sofa. ",
                ]:
                    yield SimpleNamespace(
                        candidates=[
                            SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(text=part_txt, function_call=None)]))
                        ]
                    )

            t_start = time.time()
            s.audible_until = 0.0
            s.explain_lock_until = 0.0
            s.explaining_alert = True
            act = ActiveSpeech(kind="explain_resume", user_question="Describe the room")
            await info_pipeline._stream_clauses_and_speak(
                s,
                fake_tokens(),
                act,
                parse_heard_header=False,
                lock_why_mode="first_sentence",
                t0=t_start,
            )
            why_clauses = [e for e in act.clause_timeline if "Chair" in e[2] or "step away." in e[2]]
            why_end = why_clauses[-1][1]
            total_end = s.audible_until
            check("explaining_alert cleared once resumed sentence starts", s.explaining_alert is False)
            check(
                "explain_lock_until equals why_sentence_end + 0.5s (not resumed answer end)",
                abs(s.explain_lock_until - (why_end + config.EXPLAIN_POST_WINDOW_S)) < 0.05 and total_end > why_end + 0.9,
                (s.explain_lock_until, why_end, total_end),
            )
            check("locked during why playback", s.alert_locked(why_end - 0.1) is True)
            check("locked during +0.5s post-why window", s.alert_locked(why_end + 0.49) is True)
            check("unlocked right after +0.5s post-why window", s.alert_locked(why_end + 0.51) is False)
        finally:
            speak.stream_tts = orig_stream_tts

    asyncio.run(test_explain_lock())

    # 6. Strict English/Greek language guardrails & heading sensor note
    check("English heard text accepted", info_pipeline.is_valid_en_el_heard("What is ahead of me?") is True)
    check("Greek heard text accepted", info_pipeline.is_valid_en_el_heard("Τι υπάρχει μπροστά μου;") is True)
    check("Foreign script hallucination rejected", info_pipeline.is_valid_en_el_heard("Что это впереди") is False)
    check("Arabic script hallucination rejected", info_pipeline.is_valid_en_el_heard("ما هذا") is False)
    check("normalize_lang clamps unknown languages to English", info_pipeline.normalize_lang("Spanish") == "English")
    check("normalize_lang preserves Greek", info_pipeline.normalize_lang("Greek") == "Greek")

    from server import attention, phrases
    s_txt = attention.sensors_text({"walking": True, "turnDir": "turning left", "angularSpeed": 22})
    check("sensors_text includes turnDir heading", "turning left" in s_txt and "user walking" in s_txt, s_txt)

    # 7. Standard bracketed codes ([SLIDE_RIGHT], [TURN_LEFT], etc.) expand to standard words even across chunk splits
    check("expand_codes English", phrases.expand_codes("Chair at 12. [SLIDE_RIGHT]").strip() == "Chair at 12.  Slide right.")
    check("expand_codes Greek", "Κάνε λίγο αριστερά." in phrases.expand_codes("Καρέκλα μπροστά. [SLIDE_LEFT]", "Greek"))

    async def test_split_code_stream():
        sock = DummySocket()
        s = State(socket=sock, lang="Greek")
        orig_stream_tts = speak.stream_tts
        spoken_clauses = []

        async def fake_tts(text: str):
            spoken_clauses.append(text)
            yield b"\x00" * 24000  # 0.5 s

        speak.stream_tts = fake_tts
        try:
            async def split_tokens():
                for part_txt in [
                    "Καρέκλα στις 12, ένα βήμα. [SLIDE_",
                    "RIGHT] Συνεχίζοντας, δεξιά υπάρχει γραφείο. ",
                ]:
                    yield SimpleNamespace(
                        candidates=[
                            SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(text=part_txt, function_call=None)]))
                        ]
                    )

            act = ActiveSpeech(kind="explain_resume", user_question="Τι βλέπεις;")
            s.explaining_alert = True
            _, full_txt = await info_pipeline._stream_clauses_and_speak(
                s,
                split_tokens(),
                act,
                parse_heard_header=False,
                lock_why_mode="until_continue",
                t0=time.time(),
            )
            check(
                "split [SLIDE_ + RIGHT] expands cleanly into standard Greek words without leaking brackets",
                "[" not in full_txt and "Κάνε λίγο δεξιά." in full_txt and any("Κάνε λίγο δεξιά." in c for c in spoken_clauses),
                (full_txt, spoken_clauses),
            )
        finally:
            speak.stream_tts = orig_stream_tts

    asyncio.run(test_split_code_stream())

    # 8. Persisted language across conversations (only English and Greek supported)
    import tempfile
    with tempfile.TemporaryDirectory() as tmpd:
        lang_file = Path(tmpd) / ".last_lang"
        check("default persisted lang is English", phrases.get_last_lang(lang_file) == "English")
        phrases.save_last_lang("Greek", lang_file)
        check("persists Greek across conversations", phrases.get_last_lang(lang_file) == "Greek")
        phrases.save_last_lang("French", lang_file)
        check("unsupported language clamps to English", phrases.get_last_lang(lang_file) == "English")

    check("is_supported_lang accepts English and Greek only", phrases.is_supported_lang("Greek") and phrases.is_supported_lang("English") and not phrases.is_supported_lang("Spanish"))
    check("detect_text_lang keeps Greek when user says short 'OK'", info_pipeline.detect_text_lang("OK", "Greek") == "Greek")
    check("detect_text_lang switches to Greek on Greek speech", info_pipeline.detect_text_lang("Πού να πάω;", "English") == "Greek")
    check("detect_text_lang switches to English on English speech", info_pipeline.detect_text_lang("Where is the door?", "Greek") == "English")

    # 9. Approach 1 Web PDAF sensor note + Hold > 1s Depth Identification Mode gating
    from server import live, watch
    s_txt = watch.sensors_text({"walking": True, "angularSpeed": 12, "focusDistM": 0.85})
    check("sensors_text includes Web PDAF focus distance when reported", "pdaf focus 0.85m" in s_txt, s_txt)

    async def test_depth_mode_gating():
        class _DummySock:
            async def send_json(self, _p):
                pass

        st = State(socket=_DummySock())
        st.frames.append((100.0, b"f1"))
        st.frames.append((100.6, b"f2"))
        await live._handle_json_message(st, {"type": "depth_mode", "active": True, "pdaf": True}, 2)
        check("depth_mode JSON message activates state.depth_mode_active", st.depth_mode_active is True)
        ran = await alerts.watch_once(st, 100.7)
        check("watcher does not fire spoken alerts while Hold > 1s depth mode is active", ran is False)
        await live._handle_json_message(st, {"type": "depth_mode", "active": False}, 2)
        check("releasing button deactivates state.depth_mode_active", st.depth_mode_active is False)

    asyncio.run(test_depth_mode_gating())

    # 10. Minimal explicit user memory & context propagation across agents
    from server import memory as mem_mod
    um = mem_mod.UserMemory()
    check("routine question MEMORY: NONE leaves memory empty", um.apply_directive("NONE", "What is in front of me?") is False and um.is_empty())
    check("single-word 'OK' cannot accidentally write a goal", um.apply_directive("GOAL: something", "OK") is False and um.is_empty())
    check("explicit goal is saved", um.apply_directive("GOAL: find the kitchen", "I am trying to find the kitchen") is True and um.goal == "find the kitchen")
    check("new explicit goal replaces previous goal cleanly", um.apply_directive("GOAL: reach the exit", "Now help me reach the exit") is True and um.goal == "reach the exit")
    check("explicit note worth remembering is stored", um.apply_directive("NOTE: avoid stairs", "Please remember I want to avoid stairs") is True and um.notes == ["avoid stairs"])
    check("duplicate note is ignored", um.apply_directive("NOTE: Avoid stairs", "Remember avoid stairs") is False and len(um.notes) == 1)
    for idx in range(5):
        um.apply_directive(f"NOTE: item {idx}", f"Remember item {idx}")
    check("notes stay minimal and bounded to MAX_NOTES (4)", len(um.notes) == mem_mod.MAX_NOTES)
    ctx_str = um.context_text({"front door": "handle on right"})
    check("context_text formats goal + remembered notes concisely", "trying to=reach the exit" in ctx_str and "front door: handle on right" in ctx_str, ctx_str)
    w_contents = watch.build_contents([(100.0, b"a"), (100.5, b"b")], [], "English", sensors="user walking", sheet=b"sheet", user_context=ctx_str)
    w_prompt = w_contents[0].parts[-1].text
    check("watcher build_contents receives User context", "User context: trying to=reach the exit" in w_prompt, w_prompt)
    check("CLEAR_GOAL drops finished goal while keeping notes", um.apply_directive("CLEAR_GOAL", "I found the exit") is True and um.goal == "" and len(um.notes) == mem_mod.MAX_NOTES)
    check("CLEAR wipes all memory", um.apply_directive("CLEAR", "Forget everything") is True and um.is_empty())

    with tempfile.TemporaryDirectory() as tmpd:
        mfile = Path(tmpd) / ".user_memory.json"
        m1 = mem_mod.UserMemory()
        m1.set_goal("find pharmacy", now=1000.0)
        m1.add_note("bag on blue chair")
        mem_mod.save_persisted(m1, mfile)
        loaded_fresh = mem_mod.load_persisted(mfile, now=1500.0)
        check("persisted memory reloads active goal and note", loaded_fresh.goal == "find pharmacy" and loaded_fresh.notes == ["bag on blue chair"])
        loaded_stale = mem_mod.load_persisted(mfile, now=1000.0 + mem_mod.GOAL_TTL_S + 10.0)
        check("expired goal (>2h) drops automatically while explicit note stays", loaded_stale.goal == "" and loaded_stale.notes == ["bag on blue chair"])

        async def test_stream_header_memory():
            orig_mfile = mem_mod.MEMORY_FILE
            orig_tts = speak.stream_tts
            mem_mod.MEMORY_FILE = mfile

            async def silent_tts(_t):
                yield b"\x00" * 4800

            speak.stream_tts = silent_tts
            sent_events = []

            class _MemSock:
                async def send_json(self, p):
                    sent_events.append(p)

                async def send_bytes(self, _b):
                    pass

            try:
                st_m = State(socket=_MemSock())

                async def tok_goal():
                    yield SimpleNamespace(
                        candidates=[
                            SimpleNamespace(
                                content=SimpleNamespace(
                                    parts=[
                                        SimpleNamespace(
                                            text="HEARD: Ψάχνω τα κλειδιά μου.\nMEMORY: GOAL: εύρεση κλειδιών\nREPLY: Εντάξει, ας κοιτάξουμε στο τραπέζι.",
                                            function_call=None,
                                        )
                                    ]
                                )
                            )
                        ]
                    )

                act_m = ActiveSpeech(kind="answer")
                heard_m, rep_m = await info_pipeline._stream_clauses_and_speak(
                    st_m, tok_goal(), act_m, parse_heard_header=True, t0=time.time()
                )
                check(
                    "streaming HEARD+MEMORY+REPLY saves explicit Greek goal and speaks only REPLY",
                    heard_m == "Ψάχνω τα κλειδιά μου."
                    and st_m.memory.goal == "εύρεση κλειδιών"
                    and "MEMORY" not in rep_m
                    and any(ev.get("type") == "memory" and ev.get("goal") == "εύρεση κλειδιών" for ev in sent_events),
                    (heard_m, st_m.memory.to_dict(), rep_m, sent_events),
                )
            finally:
                mem_mod.MEMORY_FILE = orig_mfile
                speak.stream_tts = orig_tts

        asyncio.run(test_stream_header_memory())

    print(f"\n{sum(results)}/{len(results)} passed")
    return all(results)


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
