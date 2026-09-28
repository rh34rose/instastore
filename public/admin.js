// Admin panel enhancements. The panel works without this file; it just gets nicer.
(function () {
  // Confirm destructive forms.
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
    });
  });

  // Settings with a catch ask before they can be switched on; cancelling leaves them off.
  document.querySelectorAll('input[type="checkbox"][data-confirm]').forEach(function (box) {
    box.addEventListener('change', function () {
      if (box.checked && !window.confirm(box.getAttribute('data-confirm'))) box.checked = false;
    });
  });

  // Shrink photos in the browser before upload so phone camera shots (4–8 MB)
  // fit comfortably under the server's 1.5 MB limit and load fast in the store.
  var canResize = typeof HTMLCanvasElement !== 'undefined' && typeof DataTransfer !== 'undefined' && window.createImageBitmap;
  if (!canResize) return;

  function resizeImage(file, maxSide) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 400 * 1024) { bitmap.close(); return file; }
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      var type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          var name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg');
          resolve(new File([blob], name, { type: type, lastModified: Date.now() }));
        }, type, 0.85);
      });
    }).catch(function () { return file; });
  }

  document.querySelectorAll('input[type="file"][data-resize]').forEach(function (input) {
    var maxSide = parseInt(input.getAttribute('data-resize'), 10) || 1600;
    var status = document.createElement('small');
    status.className = 'muted block';
    input.insertAdjacentElement('afterend', status);

    input.addEventListener('change', function () {
      var originals = Array.prototype.slice.call(input.files || []);
      if (!originals.length) { status.textContent = ''; return; }
      status.textContent = 'Preparing ' + originals.length + ' photo(s)…';
      input.disabled = true;
      Promise.all(originals.map(function (f) { return resizeImage(f, maxSide); })).then(function (resized) {
        var transfer = new DataTransfer();
        var total = 0;
        resized.forEach(function (f) { transfer.items.add(f); total += f.size; });
        input.files = transfer.files;
        var tooBig = resized.filter(function (f) { return f.size > 1.5 * 1024 * 1024; });
        status.textContent = resized.length + ' photo(s) ready, ' + Math.round(total / 1024) + ' KB total' +
          (tooBig.length ? ' — ' + tooBig.length + ' still over 1.5 MB and will be rejected' : '');
      }).finally(function () { input.disabled = false; });
    });
  });
})();
