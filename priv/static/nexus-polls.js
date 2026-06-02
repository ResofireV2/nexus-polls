(function () {
  "use strict";

  var NE   = window.NexusExtensions;
  var R    = window.React;
  var SLUG = "nexus-polls";

  var useState   = R.useState;
  var useEffect  = R.useEffect;
  var useRef     = R.useRef;
  var ce         = R.createElement;

  // ---------------------------------------------------------------------------
  // Module-level cache
  //
  // Populated by the post_footer component when it fetches poll data.
  // Keys: post_id (integer). Values: { vote_count, permissions }.
  //
  // The registerPostAction visible() function reads this cache synchronously,
  // so it must be populated before the post menu opens. The footer component
  // fetches on mount and always has the data by the time the user interacts.
  // ---------------------------------------------------------------------------
  var _pollCache = {};

  function setCacheEntry(post_id, data) {
    _pollCache[post_id] = data;
  }

  function getCacheEntry(post_id) {
    return _pollCache[post_id] || null;
  }

  // ---------------------------------------------------------------------------
  // Pending poll state (compose flow)
  //
  // Tracks the poll attachment currently queued in the composer.
  // Set by ComposeAttachmentsPreview when a polls_poll attachment is present;
  // cleared when the user removes it via the × button.
  //
  // The toolbar onClick reads _pendingPoll.data to pre-fill the modal when
  // the user re-opens it. onAttach calls _pendingPoll.remove() before calling
  // attach() so a second attach replaces the first rather than stacking.
  // ---------------------------------------------------------------------------
  var _pendingPoll = null; // { data, remove }

  // ---------------------------------------------------------------------------
  // Auth helper — reads JWT from localStorage, same pattern as other extensions
  // ---------------------------------------------------------------------------
  function authHeaders() {
    var token = localStorage.getItem("nexus_token");
    return token ? { "authorization": "Bearer " + token } : {};
  }

  function apiGet(path) {
    return fetch("/ext/" + SLUG + path, {
      headers: Object.assign({ "accept": "application/json" }, authHeaders())
    }).then(function (r) { return r.json(); });
  }

  function apiPost(path, body) {
    return fetch("/ext/" + SLUG + path, {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function apiPatch(path, body) {
    return fetch("/ext/" + SLUG + path, {
      method: "PATCH",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function apiDelete(path) {
    return fetch("/ext/" + SLUG + path, {
      method: "DELETE",
      headers: Object.assign({ "accept": "application/json" }, authHeaders())
    }).then(function (r) { return r.json(); });
  }

  // ---------------------------------------------------------------------------
  // Time helpers
  // ---------------------------------------------------------------------------
  function daysLeft(closes_at) {
    if (!closes_at) return null;
    var diff = new Date(closes_at) - Date.now();
    if (diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function metaLine(poll) {
    var total = poll.total_votes;
    var vStr  = total + (total === 1 ? " vote" : " votes");
    if (poll.closed) return vStr;
    if (!poll.closes_at) return vStr + " · No expiry";
    var days = daysLeft(poll.closes_at);
    if (days === 0) return vStr + " · Closes today";
    if (days === 1) return vStr + " · 1 day left";
    return vStr + " · " + days + " days left";
  }

  // ---------------------------------------------------------------------------
  // Small shared components
  // ---------------------------------------------------------------------------

  // Radio bullet
  function RadioDot(props) {
    return ce("div", {
      style: {
        width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
        border: props.selected ? "1.5px solid var(--ac)" : "1.5px solid var(--b2)",
        background: props.selected ? "var(--ac)" : "transparent",
        position: "relative"
      }
    }, props.selected && ce("div", {
      style: {
        position: "absolute", top: 2.5, left: 2.5,
        width: 5, height: 5, borderRadius: "50%", background: "var(--ac-on)"
      }
    }));
  }

  // Checkbox bullet
  function CheckBox(props) {
    return ce("div", {
      style: {
        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
        border: props.selected ? "1.5px solid var(--ac)" : "1.5px solid var(--b2)",
        background: props.selected ? "var(--ac)" : "transparent",
        position: "relative"
      }
    }, props.selected && ce("div", {
      style: {
        position: "absolute", top: 1, left: 3,
        width: 5, height: 8,
        border: "2px solid var(--ac-on)",
        borderTop: "none", borderLeft: "none",
        transform: "rotate(40deg)"
      }
    }));
  }

  // Closed badge — red inline pill
  function ClosedBadge() {
    return ce("span", {
      style: {
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 11, padding: "2px 8px", borderRadius: 99,
        background: "rgba(248,113,113,0.12)",
        color: "var(--red)",
        border: "0.5px solid rgba(248,113,113,0.3)"
      }
    },
      ce("i", { className: "fa-solid fa-lock", style: { fontSize: 10 } }),
      "Poll closed"
    );
  }

  // ---------------------------------------------------------------------------
  // VoterList — inline expansion showing who voted for an option
  // ---------------------------------------------------------------------------
  function VoterList(props) {
    // props: { option_id, post_id }
    var _ref = useState(null); var voters = _ref[0]; var setVoters = _ref[1];
    var _ref2 = useState(0);   var total  = _ref2[0]; var setTotal  = _ref2[1];

    useEffect(function () {
      apiGet("/api/polls/" + props.post_id + "/voters/" + props.option_id)
        .then(function (d) {
          if (d.voters) { setVoters(d.voters); setTotal(d.total); }
        })
        .catch(function () { setVoters([]); });
    }, [props.option_id]);

    if (!voters) {
      return ce("div", { style: { padding: "6px 10px", fontSize: 12, color: "var(--t4)" } }, "Loading…");
    }

    var Av = window.NexusComponents && window.NexusComponents.Av;

    return ce("div", {
      style: {
        padding: "8px 10px", borderRadius: 8,
        background: "var(--s2)", marginTop: 2
      }
    },
      voters.length === 0
        ? ce("span", { style: { fontSize: 12, color: "var(--t4)" } }, "No member votes yet")
        : ce("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" } },
            voters.map(function (v) {
              return ce("div", {
                key: v.id,
                style: { display: "flex", alignItems: "center", gap: 4 }
              },
                Av ? ce(Av, { user: v, size: 20 }) : null,
                ce("span", { style: { fontSize: 12, color: "var(--t2)" } }, v.username)
              );
            }),
            total > voters.length && ce("span", {
              style: { fontSize: 11, color: "var(--t4)" }
            }, "+ " + (total - voters.length) + " more")
          )
    );
  }

  // ---------------------------------------------------------------------------
  // ResultRow — one option in results view
  // ---------------------------------------------------------------------------
  function ResultRow(props) {
    // props: { opt, total, voted, isVoted, canViewVoters, publicVotes, post_id, expanded, onToggle }
    var opt      = props.opt;
    var pct      = props.total > 0 ? Math.round(opt.vote_count / props.total * 100) : 0;
    var isVoted  = props.isVoted;

    return ce("div", null,
      ce("div", {
        style: {
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 10px", borderRadius: 8,
          border: isVoted ? "0.5px solid var(--ac)" : "0.5px solid var(--b1)",
          background: "var(--bg)",
          position: "relative", overflow: "hidden",
          marginBottom: 4, cursor: (props.canViewVoters && props.publicVotes) ? "pointer" : "default"
        },
        onClick: (props.canViewVoters && props.publicVotes) ? props.onToggle : undefined
      },
        // background fill
        ce("div", {
          style: {
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: pct + "%",
            background: isVoted ? "var(--ac)" : "var(--b1)",
            opacity: isVoted ? 0.12 : 0.4,
            pointerEvents: "none"
          }
        }),
        // check mark if voted
        isVoted && ce("i", {
          className: "fa-solid fa-check",
          style: { fontSize: 12, color: "var(--ac)", zIndex: 1, flexShrink: 0 }
        }),
        // label
        ce("span", {
          style: {
            flex: 1, fontSize: 13,
            color: isVoted ? "var(--ac-text)" : "var(--t1)",
            position: "relative", zIndex: 1
          }
        }, opt.text),
        // count + pct
        ce("div", {
          style: {
            display: "flex", alignItems: "center", gap: 8,
            position: "relative", zIndex: 1
          }
        },
          ce("span", { style: { fontSize: 11, color: "var(--t4)" } }, opt.vote_count),
          ce("span", {
            style: {
              fontSize: 12, fontWeight: 500, minWidth: 32, textAlign: "right",
              color: isVoted ? "var(--ac-text)" : "var(--t3)"
            }
          }, pct + "%"),
          (props.canViewVoters && props.publicVotes) && ce("i", {
            className: "fa-solid fa-chevron-" + (props.expanded ? "up" : "down"),
            style: { fontSize: 10, color: "var(--t4)" }
          })
        )
      ),
      props.expanded && ce(VoterList, { option_id: opt.id, post_id: props.post_id })
    );
  }

  // ---------------------------------------------------------------------------
  // PollFooter — the post_footer slot component
  // ---------------------------------------------------------------------------
  function PollFooter(props) {
    // Props from slot contract: { post_id }
    var post_id = props.post_id;

    var _s  = useState("loading");  var state    = _s[0];  var setState    = _s[1];
    var _p  = useState(null);       var poll     = _p[0];  var setPoll     = _p[1];
    var _o  = useState([]);         var options  = _o[0];  var setOptions  = _o[1];
    var _uv = useState([]);         var userVotes= _uv[0]; var setUserVotes= _uv[1];
    var _pe = useState(null);       var perms    = _pe[0]; var setPerms    = _pe[1];
    var _se = useState([]);         var selected = _se[0]; var setSelected = _se[1];
    var _sb = useState(false);      var submitting= _sb[0];var setSubmitting= _sb[1];
    var _err= useState(null);       var error    = _err[0];var setError    = _err[1];
    var _sv = useState(false);      var showBallot= _sv[0];var setShowBallot= _sv[1];
    var _ex = useState(null);       var expanded  = _ex[0];var setExpanded  = _ex[1];
    // Incremented by the nexus-polls:updated CustomEvent to trigger a re-fetch
    var _ft = useState(0);          var fetchTick = _ft[0]; var setFetchTick = _ft[1];

    // Listen for edit-save events from the post action modal
    useEffect(function () {
      function onUpdated(e) {
        if (e.detail && e.detail.post_id === post_id) {
          setFetchTick(function (n) { return n + 1; });
        }
      }
      document.addEventListener("nexus-polls:updated", onUpdated);
      return function () { document.removeEventListener("nexus-polls:updated", onUpdated); };
    }, [post_id]);

    useEffect(function () {
      if (!post_id) return;
      apiGet("/api/polls/" + post_id)
        .then(function (data) {
          if (!data.poll) {
            setState("no_poll");
            return;
          }

          var p = data.poll;
          var o = data.options || [];
          var uv = data.user_vote_ids || [];
          var pm = data.permissions || {};

          // Update module-level cache for registerPostAction visibility
          setCacheEntry(post_id, {
            vote_count:   p.total_votes,
            permissions:  pm
          });

          setPoll(p);
          setOptions(o);
          setUserVotes(uv);
          setPerms(pm);

          if (p.closed) { setState("closed"); return; }
          if (uv.length > 0) { setState("results"); return; }
          if (!pm.can_vote) {
            // logged-out or no permission
            if (p.show_before_vote) { setState("results"); return; }
            setState("ballot"); return;
          }
          if (p.show_before_vote) { setState("results"); setShowBallot(false); return; }
          setState("ballot");
        })
        .catch(function () { setState("no_poll"); });
    }, [post_id, fetchTick]);

    if (state === "loading") {
      return ce("div", {
        style: {
          margin: "12px 0", padding: "14px 20px",
          background: "var(--s1)", borderRadius: 12,
          height: 80, animation: "pulse 1.5s infinite"
        }
      });
    }

    if (state === "no_poll") return null;
    if (!poll) return null;

    function toggleSelected(id) {
      if (poll.allow_multiple) {
        setSelected(function (prev) {
          return prev.includes(id) ? prev.filter(function (x) { return x !== id; }) : prev.concat([id]);
        });
      } else {
        setSelected([id]);
      }
    }

    function submitVote() {
      if (selected.length === 0) return;
      setSubmitting(true);
      setError(null);
      apiPost("/api/polls/" + post_id + "/vote", { option_ids: selected })
        .then(function (data) {
          setSubmitting(false);
          if (data.poll) {
            setPoll(data.poll);
            setOptions(data.options || []);
            setUserVotes(data.user_vote_ids || []);
            setSelected([]);
            setCacheEntry(post_id, { vote_count: data.poll.total_votes, permissions: perms });
            setState("results");
          } else {
            setError(data.error || "Could not record vote.");
          }
        })
        .catch(function () {
          setSubmitting(false);
          setError("Something went wrong. Please try again.");
        });
    }

    // Inner card
    var card = ce("div", {
      style: {
        background: "var(--s1)", borderRadius: 12,
        padding: "14px 16px"
      }
    },

      // Header row: question + optional "Vote" toggle for show_before_vote
      ce("div", {
        style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }
      },
        ce("div", {
          style: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 500, color: "var(--t1)" }
        },
          ce("i", { className: "fa-solid fa-chart-bar", style: { fontSize: 14, color: "var(--ac)" } }),
          poll.question
        ),
        (state === "results" && userVotes.length === 0 && !poll.closed && perms && perms.can_vote) &&
          ce("span", {
            style: { fontSize: 12, color: "var(--ac)", cursor: "pointer", flexShrink: 0, marginLeft: 8 },
            onClick: function () { setShowBallot(true); setState("ballot"); }
          }, "Vote")
      ),

      // ── Ballot state ──────────────────────────────────────────────────────
      (state === "ballot") && ce("div", null,
        options.map(function (opt) {
          var sel = selected.includes(opt.id);
          return ce("div", {
            key: opt.id,
            onClick: perms && perms.can_vote ? function () { toggleSelected(opt.id); } : undefined,
            style: {
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: 8, marginBottom: 4,
              border: sel ? "0.5px solid var(--ac)" : "0.5px solid var(--b1)",
              background: sel ? "var(--ac-bg)" : "var(--bg)",
              cursor: perms && perms.can_vote ? "pointer" : "not-allowed",
              opacity: perms && perms.can_vote ? 1 : 0.5
            }
          },
            poll.allow_multiple
              ? ce(CheckBox, { selected: sel })
              : ce(RadioDot, { selected: sel }),
            ce("span", { style: { fontSize: 13, color: sel ? "var(--ac-text)" : "var(--t1)" } }, opt.text)
          );
        }),

        // Login prompt if can_vote is false
        !(perms && perms.can_vote) && ce("div", {
          style: {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 12px", borderRadius: 8, marginTop: 4,
            background: "var(--bg)", border: "0.5px solid var(--b1)"
          }
        },
          ce("span", { style: { fontSize: 13, color: "var(--t3)" } }, "Members only — log in to vote"),
          ce("span", {
            style: { fontSize: 13, color: "var(--ac)", fontWeight: 500, cursor: "pointer" },
            onClick: function () { window.NexusExtensions.navigate("/login"); }
          }, "Log in ", ce("i", { className: "fa-solid fa-arrow-right", style: { fontSize: 11 } }))
        ),

        error && ce("div", { style: { fontSize: 12, color: "var(--red)", marginTop: 6 } }, error),

        (perms && perms.can_vote) && ce("div", {
          style: { display: "flex", alignItems: "center", gap: 10, marginTop: 12 }
        },
          ce("button", {
            className: "btn-primary",
            style: { fontSize: 13, padding: "7px 18px" },
            disabled: selected.length === 0 || submitting,
            onClick: submitVote
          }, submitting ? "Voting…" : "Vote"),
          ce("span", { style: { fontSize: 12, color: "var(--t4)", marginLeft: "auto" } }, metaLine(poll))
        )
      ),

      // ── Results state ─────────────────────────────────────────────────────
      (state === "results" || state === "closed") && (perms && perms.can_view_results)
        ? ce("div", null,
            options.map(function (opt) {
              var isVoted = userVotes.includes(opt.id);
              var isExpanded = expanded === opt.id;
              return ce(ResultRow, {
                key: opt.id,
                opt: opt,
                total: poll.total_votes,
                isVoted: isVoted,
                canViewVoters: perms && perms.can_view_voters,
                publicVotes: poll.public_votes,
                post_id: post_id,
                expanded: isExpanded,
                onToggle: function () { setExpanded(isExpanded ? null : opt.id); }
              });
            }),
            ce("div", {
              style: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, color: "var(--t4)" }
            },
              ce("i", { className: "fa-solid fa-users", style: { fontSize: 12 } }),
              ce("span", null, metaLine(poll)),
              state === "closed" && ce("span", null, " · "),
              state === "closed" && ce(ClosedBadge),
              state === "results" && userVotes.length > 0 && !poll.closed &&
                ce("span", null,
                  ce("span", { style: { color: "var(--b2)" } }, " · "),
                  ce("span", {
                    style: { color: "var(--ac)", cursor: "pointer" },
                    onClick: function () {
                      setSelected(userVotes.slice());
                      setShowBallot(false);
                      setState("ballot");
                    }
                  }, "Change vote")
                )
            )
          )
        : (state === "results" || state === "closed") && ce("div", {
            style: { fontSize: 13, color: "var(--t3)", padding: "8px 0" }
          }, "Your vote was recorded.")
    );

    return ce("div", { style: { padding: "0 0 4px 0" } }, card);
  }

  // ---------------------------------------------------------------------------
  // ComposeAttachmentsPreview — the compose_attachments slot component
  //
  // Shows a summary card when a poll is attached, with an × to remove it.
  // ---------------------------------------------------------------------------
  function ComposeAttachmentsPreview(props) {
    // Props from slot contract: { attachments, setAttachments }
    var attachments    = props.attachments    || [];
    var setAttachments = props.setAttachments || function () {};

    var pollAttachment = attachments.find(function (a) { return a.kind === "polls_poll"; });

    // Keep _pendingPoll in sync with the live attachments array.
    // When a poll is present, register it with a remove function so the
    // toolbar onClick can replace it cleanly. When absent, clear the ref.
    if (pollAttachment) {
      _pendingPoll = {
        data: pollAttachment.data || {},
        remove: function () {
          setAttachments(function (prev) {
            return prev.filter(function (a) { return a.kind !== "polls_poll"; });
          });
        }
      };
    } else {
      _pendingPoll = null;
    }

    if (!pollAttachment) return null;

    var data = pollAttachment.data || {};

    function removePoll() {
      _pendingPoll = null;
      setAttachments(function (prev) {
        return prev.filter(function (a) { return a.kind !== "polls_poll"; });
      });
    }

    return ce("div", {
      style: {
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", marginBottom: 8,
        background: "var(--s1)", borderRadius: 10,
        border: "0.5px solid var(--b1)"
      }
    },
      ce("i", { className: "fa-solid fa-chart-bar", style: { fontSize: 14, color: "var(--ac)", flexShrink: 0 } }),
      ce("div", { style: { flex: 1, minWidth: 0 } },
        ce("div", { style: { fontSize: 13, fontWeight: 500, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
          data.question || "Poll attached"
        ),
        ce("div", { style: { fontSize: 11, color: "var(--t4)", marginTop: 1 } },
          (data.options || []).length + " options" +
          (data.duration_days && data.duration_days !== "never"
            ? " · " + data.duration_days + " day" + (data.duration_days === 1 ? "" : "s")
            : " · No expiry")
        )
      ),
      ce("button", {
        style: {
          background: "none", border: "none", cursor: "pointer",
          color: "var(--t4)", fontSize: 16, padding: "0 2px", flexShrink: 0
        },
        onClick: removePoll,
        title: "Remove poll"
      }, ce("i", { className: "fa-solid fa-xmark" }))
    );
  }

  // ---------------------------------------------------------------------------
  // PollModal — creates a poll or edits an existing one
  //
  // Mounted via a React portal to document.body.
  // Two modes:
  //   "create"  — called from toolbar onClick with { attach, currentUser }
  //   "edit"    — called from registerPostAction onClick with { post_id }
  // ---------------------------------------------------------------------------
  function PollModal(props) {
    // props: { mode, initialData, onClose, onAttach, onSaved, isMod }
    var initialData = props.initialData || {};

    var _q  = useState(initialData.question || "");
    var question    = _q[0]; var setQuestion = _q[1];

    var _opts = useState(
      initialData.options && initialData.options.length >= 2
        ? initialData.options.map(function (o, i) { return { id: o.id || null, text: o.text || o, pos: i }; })
        : [{ id: null, text: "", pos: 0 }, { id: null, text: "", pos: 1 }]
    );
    var opts = _opts[0]; var setOpts = _opts[1];

    var _am = useState(initialData.allow_multiple   || false);
    var allowMultiple   = _am[0]; var setAllowMultiple   = _am[1];

    var _sb = useState(initialData.show_before_vote || false);
    var showBefore      = _sb[0]; var setShowBefore      = _sb[1];

    var _pv = useState(initialData.public_votes     || false);
    var publicVotes     = _pv[0]; var setPublicVotes     = _pv[1];

    var _dur = useState(initialData.duration_days != null ? initialData.duration_days : 7);
    var duration        = _dur[0]; var setDuration        = _dur[1];

    var _sub = useState(false); var submitting = _sub[0]; var setSubmitting = _sub[1];
    var _err = useState(null);  var error      = _err[0]; var setError      = _err[1];

    var inputRefs = useRef([]);

    var Toggle = window.NexusComponents && window.NexusComponents.Toggle;
    var Select = window.NexusComponents && window.NexusComponents.Select;

    // Validation: question non-empty + at least 2 non-empty options
    var validOpts = opts.filter(function (o) { return o.text.trim() !== ""; });
    var canSubmit = question.trim().length > 0 && validOpts.length >= 2 && !submitting;

    function addOpt() {
      if (opts.length >= 8) return;
      setOpts(function (prev) {
        return prev.concat([{ id: null, text: "", pos: prev.length }]);
      });
    }

    function removeOpt(idx) {
      if (opts.length <= 2) return;
      setOpts(function (prev) { return prev.filter(function (_, i) { return i !== idx; }); });
    }

    function updateOpt(idx, val) {
      setOpts(function (prev) {
        return prev.map(function (o, i) { return i === idx ? { id: o.id, text: val, pos: o.pos } : o; });
      });
    }

    function handleOptKeyDown(idx, e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (idx === opts.length - 1 && opts.length < 8) {
          addOpt();
          // focus will be set via useEffect after rerender
        } else if (idx < opts.length - 1) {
          var next = inputRefs.current[idx + 1];
          if (next) next.focus();
        }
      }
    }

    // Focus newly added option
    useEffect(function () {
      var last = inputRefs.current[opts.length - 1];
      // Only auto-focus if the last input is empty (just added)
      if (last && last.value === "") last.focus();
    }, [opts.length]);

    // Drag-to-reorder state
    var dragIdx = useRef(null);

    function onDragStart(idx) { dragIdx.current = idx; }
    function onDragOver(e, idx) {
      e.preventDefault();
      if (dragIdx.current === null || dragIdx.current === idx) return;
      var from = dragIdx.current;
      dragIdx.current = idx;
      setOpts(function (prev) {
        var next = prev.slice();
        var moved = next.splice(from, 1)[0];
        next.splice(idx, 0, moved);
        return next;
      });
    }
    function onDragEnd() { dragIdx.current = null; }

    function handleSubmit() {
      setSubmitting(true);
      setError(null);
      var data = {
        question:         question.trim(),
        options:          validOpts.map(function (o) { return o.text.trim(); }),
        allow_multiple:   allowMultiple,
        show_before_vote: showBefore,
        public_votes:     publicVotes,
        duration_days:    duration
      };

      if (props.mode === "create") {
        props.onAttach(data);
        setSubmitting(false);
        props.onClose();

      } else {
        // Edit mode — PATCH the poll
        var editData = {
          question:         data.question,
          allow_multiple:   data.allow_multiple,
          show_before_vote: data.show_before_vote,
          public_votes:     data.public_votes,
          duration_days:    data.duration_days,
          options: opts.map(function (o, idx) {
            return { id: o.id || undefined, text: o.text.trim() };
          }).filter(function (o) { return o.text !== ""; })
        };
        apiPatch("/api/polls/" + props.post_id, editData)
          .then(function (d) {
            setSubmitting(false);
            if (d.poll) {
              if (props.onSaved) props.onSaved(d);
              props.onClose();
            } else {
              setError(d.error || "Could not save poll.");
            }
          })
          .catch(function () {
            setSubmitting(false);
            setError("Something went wrong. Please try again.");
          });
      }
    }

    function handleClose() {
      if (!submitting) props.onClose();
    }

    function closePoll() {
      if (!confirm("Close this poll now? Voting will be disabled immediately.")) return;
      apiDelete("/api/polls/" + props.post_id + "/close")
        .then(function (d) {
          if (d.poll) {
            if (props.onSaved) props.onSaved(d);
            props.onClose();
          } else {
            setError(d.error || "Could not close poll.");
          }
        })
        .catch(function () { setError("Something went wrong."); });
    }

    var durationOptions = [
      { value: 1,       label: "1 day" },
      { value: 3,       label: "3 days" },
      { value: 7,       label: "7 days" },
      { value: 14,      label: "14 days" },
      { value: 30,      label: "30 days" },
      { value: "never", label: "Never" }
    ];

    var isEdit  = props.mode === "edit";
    var btnLabel = isEdit
      ? (submitting ? "Saving…" : "Save changes")
      : (submitting ? "Attaching…" : "Attach poll");

    // Modal overlay
    return window.ReactDOM.createPortal(
      ce("div", {
        style: {
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center"
        },
        onClick: handleClose
      },
        ce("div", {
          style: {
            background: "var(--s2)", borderRadius: 14,
            border: "0.5px solid var(--b2)",
            width: "100%", maxWidth: 480,
            maxHeight: "90vh", overflowY: "auto",
            padding: "20px 24px"
          },
          onClick: function (e) { e.stopPropagation(); }
        },

          // Header
          ce("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 } },
            ce("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 500, color: "var(--t1)" } },
              ce("i", { className: "fa-solid fa-chart-bar", style: { color: "var(--ac)" } }),
              isEdit ? "Edit poll" : "Create a poll"
            ),
            ce("button", {
              style: { background: "none", border: "none", cursor: "pointer", color: "var(--t3)", fontSize: 18, padding: "0 2px" },
              onClick: handleClose
            }, ce("i", { className: "fa-solid fa-xmark" }))
          ),

          // Question
          ce("div", { style: { marginBottom: 16 } },
            ce("label", { style: { display: "block", fontSize: 12, fontWeight: 500, color: "var(--t3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" } }, "Question"),
            ce("input", {
              type: "text",
              maxLength: 200,
              value: question,
              onChange: function (e) { setQuestion(e.target.value); },
              placeholder: "Ask your question…",
              style: {
                width: "100%", boxSizing: "border-box",
                background: "var(--s1)", border: "0.5px solid var(--b2)",
                borderRadius: 8, padding: "9px 12px",
                fontSize: 14, color: "var(--t1)", fontFamily: "inherit"
              }
            })
          ),

          // Options
          ce("div", { style: { marginBottom: 4 } },
            ce("label", { style: { display: "block", fontSize: 12, fontWeight: 500, color: "var(--t3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" } }, "Options")
          ),
          opts.map(function (opt, idx) {
            return ce("div", {
              key: idx,
              draggable: true,
              onDragStart: function () { onDragStart(idx); },
              onDragOver:  function (e) { onDragOver(e, idx); },
              onDragEnd:   onDragEnd,
              style: {
                display: "flex", alignItems: "center", gap: 8,
                marginBottom: 6
              }
            },
              // drag handle
              ce("i", {
                className: "fa-solid fa-grip-vertical",
                style: { fontSize: 12, color: "var(--t4)", cursor: "grab", flexShrink: 0 }
              }),
              ce("input", {
                ref: function (el) { inputRefs.current[idx] = el; },
                type: "text",
                maxLength: 200,
                value: opt.text,
                onChange: function (e) { updateOpt(idx, e.target.value); },
                onKeyDown: function (e) { handleOptKeyDown(idx, e); },
                placeholder: "Option " + (idx + 1),
                style: {
                  flex: 1,
                  background: "var(--s1)", border: "0.5px solid var(--b2)",
                  borderRadius: 8, padding: "8px 10px",
                  fontSize: 13, color: "var(--t1)", fontFamily: "inherit"
                }
              }),
              opts.length > 2 && ce("button", {
                onClick: function () { removeOpt(idx); },
                style: { background: "none", border: "none", cursor: "pointer", color: "var(--t4)", fontSize: 14, padding: "0 2px", flexShrink: 0 }
              }, ce("i", { className: "fa-solid fa-trash" }))
            );
          }),

          // Add option
          opts.length < 8 && ce("div", { style: { marginBottom: 16 } },
            ce("button", {
              onClick: addOpt,
              style: {
                background: "none", border: "none", cursor: "pointer",
                color: "var(--ac)", fontSize: 13, padding: "4px 0", fontFamily: "inherit"
              }
            },
              ce("i", { className: "fa-solid fa-plus", style: { marginRight: 5, fontSize: 11 } }),
              "Add option"
            ),
            ce("span", { style: { fontSize: 11, color: "var(--t4)", marginLeft: 8 } }, "(2 min · 8 max)")
          ),

          // Divider
          ce("div", { style: { height: 1, background: "var(--b1)", margin: "8px 0 16px" } }),

          // Toggles
          Toggle && ce("div", { style: { marginBottom: 12 } },
            ce(Toggle, { value: allowMultiple, onChange: setAllowMultiple, label: "Allow multiple votes" })
          ),
          Toggle && ce("div", { style: { marginBottom: 12 } },
            ce(Toggle, { value: showBefore,    onChange: setShowBefore,    label: "Show results before voting" })
          ),
          Toggle && ce("div", { style: { marginBottom: 16 } },
            ce(Toggle, { value: publicVotes,   onChange: setPublicVotes,   label: "Show who voted" })
          ),

          // Duration
          ce("div", { style: { marginBottom: 20 } },
            ce("label", { style: { display: "block", fontSize: 12, fontWeight: 500, color: "var(--t3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" } }, "Duration"),
            Select
              ? ce(Select, {
                  value: duration,
                  onChange: function (v) { setDuration(v === "never" ? "never" : Number(v)); },
                  options: durationOptions,
                  style: { width: "100%" }
                })
              : ce("select", {
                  value: duration,
                  onChange: function (e) {
                    var v = e.target.value;
                    setDuration(v === "never" ? "never" : Number(v));
                  },
                  style: {
                    width: "100%",
                    background: "var(--s1)", border: "0.5px solid var(--b2)",
                    borderRadius: 8, padding: "8px 10px",
                    fontSize: 13, color: "var(--t1)", fontFamily: "inherit"
                  }
                },
                  durationOptions.map(function (o) {
                    return ce("option", { key: o.value, value: o.value }, o.label);
                  })
                )
          ),

          // Error
          error && ce("div", {
            style: {
              fontSize: 12, color: "var(--red)", padding: "8px 12px",
              background: "rgba(248,113,113,0.08)", borderRadius: 8,
              border: "0.5px solid rgba(248,113,113,0.2)", marginBottom: 12
            }
          }, error),

          // Divider
          ce("div", { style: { height: 1, background: "var(--b1)", margin: "0 0 16px" } }),

          // Footer buttons
          ce("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            // Close early — mods/admins only in edit mode, only if poll is open
            (isEdit && props.isMod) && ce("button", {
              className: "btn-ghost",
              style: { fontSize: 12 },
              onClick: closePoll
            }, ce("i", { className: "fa-solid fa-lock", style: { marginRight: 5, fontSize: 11 } }), "Close poll now"),
            ce("div", { style: { flex: 1 } }),
            ce("button", {
              className: "btn-ghost",
              onClick: handleClose,
              disabled: submitting
            }, "Cancel"),
            ce("button", {
              className: "btn-primary",
              style: { fontSize: 13, padding: "7px 18px" },
              disabled: !canSubmit,
              onClick: handleSubmit
            }, btnLabel)
          )
        )
      ),
      document.body
    );
  }

  // ---------------------------------------------------------------------------
  // PollsIndexPage — the explore route
  // ---------------------------------------------------------------------------
  function PollsIndexPage() {
    return ce("div", { style: { padding: "32px 0" } },
      ce("h2", { style: { fontSize: 20, fontWeight: 500, color: "var(--t1)", marginBottom: 8 } }, "Polls"),
      ce("p", { style: { fontSize: 14, color: "var(--t3)" } },
        "Polls are attached to individual posts. Browse the forum to find and participate in active polls."
      )
    );
  }

  // ---------------------------------------------------------------------------
  // AdminPanel — settings panel using SimpleSettingsPanel with no fields
  // (permissions are configured on the Permissions page; no settings_schema)
  // ---------------------------------------------------------------------------
  function PollsAdminPanel() {
    return ce("div", { style: { padding: "8px 0" } },
      ce("p", { style: { fontSize: 14, color: "var(--t3)", lineHeight: 1.6 } },
        "Poll permissions are configured on the ",
        ce("strong", null, "Permissions"),
        " page under the Polls section. You can control who can create polls, who can vote, who can view results, and who can see voter identities."
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Register: post_footer slot
  // ---------------------------------------------------------------------------
  NE.registerSlot({
    slug:      SLUG,
    slot:      "post_footer",
    component: PollFooter,
    priority:  50
  });

  // ---------------------------------------------------------------------------
  // Register: compose_attachments slot
  // ---------------------------------------------------------------------------
  NE.registerSlot({
    slug:      SLUG,
    slot:      "compose_attachments",
    component: ComposeAttachmentsPreview,
    priority:  50
  });

  // ---------------------------------------------------------------------------
  // Register: toolbar button
  //
  // The modal is mounted synchronously inside onClick by creating a container
  // div and rendering into it via ReactDOM.createRoot (or ReactDOM.render for
  // older React). The attach() closure is passed into the modal as a prop.
  // When the user clicks "Attach poll", the modal calls onAttach(data) which
  // calls attach() and unmounts. Re-opening pre-fills from the existing
  // attachment in the composer (if any).
  // ---------------------------------------------------------------------------
  NE.registerToolbarButton({
    slug:  SLUG,
    id:    "add-poll",
    icon:  "fa-solid fa-chart-bar",
    tip:   "Attach a poll",
    scope: "posts",
    onClick: function (ctx) {
      var attach      = ctx.attach;
      var currentUser = ctx.currentUser;

      if (!currentUser) return;

      // If a poll is already attached, pre-fill the modal with its data.
      // _pendingPoll is kept in sync by ComposeAttachmentsPreview.
      var existingData = _pendingPoll ? _pendingPoll.data : {};

      var container = document.createElement("div");
      document.body.appendChild(container);

      function unmount() {
        if (window._nexusPollsModalRoot) {
          window._nexusPollsModalRoot.unmount();
          window._nexusPollsModalRoot = null;
        } else if (window.ReactDOM) {
          window.ReactDOM.unmountComponentAtNode(container);
        }
        if (container.parentNode) container.parentNode.removeChild(container);
      }

      var modal = ce(PollModal, {
        mode:        "create",
        initialData: existingData,
        onClose:     unmount,
        onAttach:    function (data) {
          // Remove any existing poll attachment before adding the new one,
          // so re-opening the modal and saving replaces rather than stacks.
          if (_pendingPoll) {
            _pendingPoll.remove();
            _pendingPoll = null;
          }
          attach({ kind: "polls_poll", data: data });
        }
      });

      if (window.ReactDOM && window.ReactDOM.createRoot) {
        var root = window.ReactDOM.createRoot(container);
        window._nexusPollsModalRoot = root;
        root.render(modal);
      } else if (window.ReactDOM) {
        window.ReactDOM.render(modal, container);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Register: post action (edit poll)
  //
  // Visible to:
  //   - mods/admins always (when a poll exists on the post)
  //   - post author if vote_count === 0 (read from module-level cache)
  // ---------------------------------------------------------------------------
  NE.registerPostAction({
    id:    "nexus-polls-edit",
    label: "Edit poll",
    icon:  "fa-chart-bar",
    visible: function (ctx) {
      var post        = ctx.post;
      var currentUser = ctx.currentUser;
      if (!currentUser || !post) return false;

      var isMod = currentUser.role === "moderator" || currentUser.role === "admin";

      // Check cache — if no entry yet, hide conservatively (footer hasn't loaded)
      var cache = getCacheEntry(post.id);
      if (!cache) return false;
      if (!cache.permissions) return false;

      // Only show if there is actually a poll on this post
      // (cache is only populated when a poll exists)
      if (isMod) return true;

      var isAuthor = post.user && post.user.id === currentUser.id;
      return isAuthor && cache.vote_count === 0;
    },
    onClick: function (ctx) {
      var post        = ctx.post;
      var currentUser = ctx.currentUser;
      var closeMenu   = ctx.closeMenu;

      closeMenu();

      // Fetch the current poll data to pre-fill the modal
      var isMod = currentUser.role === "moderator" || currentUser.role === "admin";

      apiGet("/api/polls/" + post.id)
        .then(function (data) {
          if (!data.poll) {
            window.NexusComponents && window.NexusComponents.toast("No poll found on this post.", "err");
            return;
          }

          var initialData = {
            question:         data.poll.question,
            options:          data.options,
            allow_multiple:   data.poll.allow_multiple,
            show_before_vote: data.poll.show_before_vote,
            public_votes:     data.poll.public_votes,
            // When no closes_at, use "never". When there is a closes_at,
            // default the picker to 7 — the admin can adjust as needed.
            duration_days:    data.poll.closes_at ? 7 : "never"
          };

          var container = document.createElement("div");
          document.body.appendChild(container);

          function unmount() {
            if (window._nexusPollsEditRoot) {
              window._nexusPollsEditRoot.unmount();
              window._nexusPollsEditRoot = null;
            } else if (window.ReactDOM) {
              window.ReactDOM.unmountComponentAtNode(container);
            }
            if (container.parentNode) container.parentNode.removeChild(container);
          }

          var modal = ce(PollModal, {
            mode:        "edit",
            post_id:     post.id,
            initialData: initialData,
            isMod:       isMod,
            onClose:     unmount,
            onSaved:     function (updated) {
              // Update module-level cache
              if (updated.poll) {
                var existing = getCacheEntry(post.id);
                setCacheEntry(post.id, {
                  vote_count:  updated.poll.total_votes,
                  permissions: existing ? existing.permissions : null
                });
              }
              // Dispatch a CustomEvent so the mounted PollFooter component
              // re-fetches and shows the updated poll immediately.
              document.dispatchEvent(new CustomEvent("nexus-polls:updated", {
                detail: { post_id: post.id }
              }));
              window.NexusComponents && window.NexusComponents.toast("Poll updated.");
            }
          });

          if (window.ReactDOM && window.ReactDOM.createRoot) {
            var root = window.ReactDOM.createRoot(container);
            window._nexusPollsEditRoot = root;
            root.render(modal);
          } else if (window.ReactDOM) {
            window.ReactDOM.render(modal, container);
          }
        })
        .catch(function () {
          window.NexusComponents && window.NexusComponents.toast("Could not load poll data.", "err");
        });
    }
  });

  // ---------------------------------------------------------------------------
  // Register: explore item + route
  // ---------------------------------------------------------------------------
  NE.registerRoute(SLUG, "/", PollsIndexPage, { title: "Polls" });

  NE.registerExploreItem({
    slug:     SLUG,
    path:     "/",
    label:    "Polls",
    icon:     "fa-chart-bar",
    priority: 50
  });

  // ---------------------------------------------------------------------------
  // Register: admin panel
  // ---------------------------------------------------------------------------
  NE.registerAdminPanel(SLUG, {
    label:     "Polls",
    icon:      "fa-chart-bar",
    component: PollsAdminPanel
  });

})();
