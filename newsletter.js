// topsecret.fm newsletter signup — posts to the Supabase "newsletter" edge function.
(function () {
  var FN_URL = "https://lukybmzjfyluowlawbyq.supabase.co/functions/v1/newsletter";
  window.TOPSECRET_NEWSLETTER_URL = FN_URL;

  function init() {
    document.querySelectorAll(".js-signup").forEach(function (form) {
      var input = form.querySelector('input[type="email"]');
      var hp = form.querySelector('input[name="website"]');
      var btn = form.querySelector("button");
      var msg = form.querySelector(".signup-msg");

      function say(text, kind) {
        msg.textContent = text;
        msg.className = "signup-msg" + (kind ? " is-" + kind : "");
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = (input.value || "").trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          say("That doesn't look like an email address.", "err");
          input.focus();
          return;
        }
        btn.disabled = true;
        say("Filing your details…");
        fetch(FN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "subscribe", email: email, website: hp ? hp.value : "", source: form.dataset.source || "website" }),
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.d.error || "Something went wrong");
            if (res.d.status === "already") say("You're already on the list — we'll be in touch.", "ok");
            else say("You're on the list. We'll tell you when new shows go on air.", "ok");
            input.value = "";
          })
          .catch(function (err) {
            say(err.message && err.message.length < 120 ? err.message : "Couldn't sign you up just now — try again in a minute.", "err");
          })
          .finally(function () { btn.disabled = false; });
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
