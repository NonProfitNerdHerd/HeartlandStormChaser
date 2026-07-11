(function () {
  var userEl = document.getElementById("site-footer-auth-user");
  var signInEl = document.getElementById("site-footer-sign-in");
  var signOutEl = document.getElementById("site-footer-sign-out");

  if (!signInEl || !signOutEl) {
    return;
  }

  function setSignedOut() {
    if (userEl) {
      userEl.hidden = true;
      userEl.textContent = "";
    }
    var next = window.location.pathname + window.location.search;
    signInEl.href = "/login.html?next=" + encodeURIComponent(next);
    signInEl.hidden = false;
    signOutEl.hidden = true;
  }

  function setSignedIn(username) {
    if (userEl) {
      userEl.textContent = "Signed in as " + username;
      userEl.hidden = false;
    }
    signInEl.hidden = true;
    signOutEl.hidden = false;
  }

  async function refreshAuthFooter() {
    try {
      var response = await fetch("/api/auth/me");
      var data = await response.json();
      if (data.ok && data.authenticated && data.user) {
        setSignedIn(data.user.username);
        return;
      }
    } catch (error) {
      /* show sign in */
    }

    setSignedOut();
  }

  signOutEl.addEventListener("click", async function () {
    signOutEl.disabled = true;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      /* still redirect to login */
    }
    window.location.href = "/login.html";
  });

  refreshAuthFooter();
})();
