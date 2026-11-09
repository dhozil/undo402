// Wallet connect — plain script, no imports. Works even if chain modules fail.
(function () {
  function toast(msg, kind) {
    var box = document.getElementById("toasts");
    if (!box) return;
    var t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.innerHTML = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 9000);
  }
  async function connect() {
    var btn = document.getElementById("connectBtn");
    try {
      if (!window.ethereum) throw new Error("No wallet extension found. Install MetaMask, or continue with the relay demo account — reads work without a wallet.");
      btn.disabled = true;
      btn.textContent = "Connecting…";
      var addr = await window.ethereum.request({ method: "eth_requestAccounts" });
      var account = addr[0];
      btn.textContent = account.slice(0, 6) + "…" + account.slice(-4);
      toast("Wallet connected: <code>" + account + "</code>", "success");
    } catch (e) {
      btn.textContent = "Connect wallet";
      toast("<strong>Connection failed:</strong> " + e.message, "error");
    } finally {
      btn.disabled = false;
    }
  }
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("connectBtn");
    if (btn) btn.addEventListener("click", connect);
  });
})();
