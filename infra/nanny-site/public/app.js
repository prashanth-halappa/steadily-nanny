(function () {
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var body = document.body;

  // Role is fixed on the spoke pages (data-role on <body>) and chosen on the hub.
  function role() { return body.dataset.role === 'nanny' ? 'nanny' : 'parent'; }

  document.querySelectorAll('.rolepick button').forEach(function (b) {
    b.addEventListener('click', function () {
      body.dataset.role = b.dataset.role;
      document.querySelectorAll('.rolepick button').forEach(function (o) {
        o.setAttribute('aria-pressed', String(o.dataset.role === b.dataset.role));
      });
    });
  });

  var nav = document.querySelector('.navbar');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('stuck', window.scrollY > 120); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  document.querySelectorAll('[data-waitlist]').forEach(function (box) {
    var form = box.querySelector('form');
    var input = box.querySelector('input[type=email]');
    var btn = box.querySelector('button[type=submit]');
    var err = box.querySelector('.wl-error');

    function fail(msg) { err.textContent = msg; err.hidden = false; }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = input.value.trim();
      err.hidden = true;
      if (!value) { return fail('Please enter your email address.'); }
      if (value.length > 255 || !EMAIL.test(value)) {
        return fail('That doesn’t look like a valid email address.');
      }
      btn.disabled = true; btn.textContent = 'Joining…';
      fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, role: role() })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) {
          if (!r.ok || !d || !d.ok) {
            throw new Error((d && d.error) || 'Something went wrong. Please try again.');
          }
          box.innerHTML = '<p class="wl-success" role="status">You’re on the list. We’ll be in touch when Steadily Nanny is ready.</p>';
        });
      }).catch(function (ex) {
        btn.disabled = false; btn.textContent = 'Join the waitlist';
        fail(ex && ex.message ? ex.message : 'We couldn’t reach the server. Please try again.');
      });
    });
  });
})();
