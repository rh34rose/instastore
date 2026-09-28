// Progressive enhancement for the storefront. Everything works without it.
(function () {
  // Product gallery: clicking a thumbnail swaps the main image instead of navigating.
  var main = document.querySelector('.gallery-main');
  var thumbs = document.querySelectorAll('.thumb[data-image]');
  if (main && main.tagName === 'IMG' && thumbs.length) {
    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function (event) {
        event.preventDefault();
        main.src = thumb.getAttribute('data-image');
        thumbs.forEach(function (t) { t.classList.remove('active'); });
        thumb.classList.add('active');
      });
    });
  }

  // Cart: submit quantity changes as soon as they are made.
  document.querySelectorAll('.cart-line input[name="qty"]').forEach(function (input) {
    input.addEventListener('change', function () {
      if (input.form) input.form.requestSubmit ? input.form.requestSubmit() : input.form.submit();
    });
  });
})();
