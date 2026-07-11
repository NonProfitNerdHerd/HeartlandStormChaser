(function () {
  var form = document.getElementById("login-form");
  var usernameInput = document.getElementById("login-username");
  var passwordInput = document.getElementById("login-password");
  var messageEl = document.getElementById("login-message");
  var submitBtn = document.getElementById("login-submit-btn");

  var params = new URLSearchParams(window.location.search);
  var nextPath = params.get("next") || "/";

  function setMessage(text, isError) {
    if (!messageEl) return;
    messageEl.hidden = !text;
    messageEl.textContent = text || "";
    messageEl.className = "login-form__message" + (isError ? " login-form__message--error" : "");
  }

  function safeNextPath(value) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) {
      return "/";
    }
    if (value.startsWith("/login.html")) {
      return "/";
    }
    return value;
  }

  async function checkExistingSession() {
    try {
      var response = await fetch("/api/auth/me");
      var data = await response.json();
      if (data.ok && data.authenticated) {
        window.location.replace(safeNextPath(nextPath));
      }
    } catch (error) {
      /* ignore */
    }
  }

  if (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      setMessage("");

      var username = usernameInput ? usernameInput.value.trim() : "";
      var password = passwordInput ? passwordInput.value : "";
      if (!username || !password) {
        setMessage("Enter your username and password.", true);
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Signing in…";
      }

      try {
        var response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username, password: password }),
        });
        var data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Sign in failed");
        }

        window.location.replace(safeNextPath(nextPath));
      } catch (error) {
        setMessage(error.message || "Sign in failed", true);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign in";
        }
      }
    });
  }

  checkExistingSession();
})();
