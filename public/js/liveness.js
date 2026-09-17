'use strict';

const Liveness = (() => {
  function skinMask(data) {
    let minX = 1e9, maxX = 0, minY = 1e9, maxY = 0, sumX = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const cr = r - y;
      const cb = b - y;
      const skin = r > 80 && g > 30 && b > 15 && r > g && r > b && cr > 10 && cb < 40 && y > 40 && y < 230;
      if (!skin) continue;
      const px = (i / 4) % 160;
      const py = Math.floor(i / 4 / 160);
      count++;
      sumX += px;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (count < 80) return null;
    return {
      cx: sumX / count,
      w: maxX - minX,
      h: maxY - minY,
      count
    };
  }

  function estimateGender(blob) {
    if (!blob || blob.h < 8) return 'unknown';
    const ratio = blob.w / blob.h;
    if (ratio < 0.72) return 'female';
    if (ratio > 0.92) return 'male';
    return 'unknown';
  }

  async function run({ video, onHint }) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let baseline = null;
    let seenLeft = false;
    let seenRight = false;
    let lastGender = 'unknown';
    const start = Date.now();

    return await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (Date.now() - start > 45000) {
          cleanup();
          reject(new Error(typeof I18n !== 'undefined' ? I18n.t('liveTimeout') : 'Scan timed out. Try brighter light and turn slowly.'));
          return;
        }
        ctx.save();
        ctx.translate(160, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, 160, 160);
        ctx.restore();
        const blob = skinMask(ctx.getImageData(0, 0, 160, 160).data);
        if (!blob) {
          onHint((typeof I18n !== 'undefined' ? I18n.t('liveCenter') : 'Center your face in the glow.'));
          return;
        }
        lastGender = estimateGender(blob);
        if (!baseline) baseline = blob.cx;
        const delta = blob.cx - baseline;
        if (delta < -12) seenLeft = true;
        if (delta > 12) seenRight = true;
        if (!seenLeft) onHint((typeof I18n !== 'undefined' ? I18n.t('liveLeft') : 'Gently turn your head left →'));
        else if (!seenRight) onHint((typeof I18n !== 'undefined' ? I18n.t('liveRight') : 'Nice. Now turn your head right ←'));
        else {
          cleanup();
          resolve({ left: true, right: true, estimatedGender: lastGender });
        }
      }, 120);

      function cleanup() {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      }
    });
  }

  return { run, estimateGender };
})();
